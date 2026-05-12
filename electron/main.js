const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');
const ptyManager = require('./pty-manager');
const keychainServer = require('./keychain-server');

// Process-level safety nets.
//
// `keytar.node` (the macOS keychain binding) can throw a NAPI C++ exception
// that escapes the JavaScript try/catch in keychain-server.js — the throw
// happens synchronously inside the NAPI callback BEFORE `await` converts it
// to a promise rejection. libc++abi then calls std::terminate() and the
// whole Electron main process abort()s.
//
// Confirmed in v0.9.16 crash report — keytar.node frames terminating with
// __cxa_throw → _objc_terminate → abort. Likely triggered when the
// macOS keychain prompt is dismissed/timed-out or the requested item is in
// an unexpected state (e.g. wrong ACL after a code-signing-hash change on
// upgrade).
//
// We can't fix the upstream keytar bug here, but we can prevent the abort:
// route every uncaught exception and unhandled rejection through a logger
// so the app stays alive. Any individual keychain operation that triggered
// the throw still fails (the affected request returns 500 from
// keychain-server), but the user can retry.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException — preventing abort:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason && (reason.stack || reason.message || reason));
});

const APP_PORT = 3005;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

// Random per-launch token gating /api/_internal/* routes (e.g. spawn-plan)
// AND the in-process keychain delegation server. Generated here, passed to
// Next.js via env, never sent to the renderer.
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');

// Set when the keychain server has booted. Passed to the Next.js child via
// env so server-side code can delegate keytar calls to the main process —
// macOS attributes the keychain access dialog to "SSH Manager" (the bundle)
// rather than "next-server" (the Node process title in the child).
let KEYCHAIN_URL = '';

let mainWindow = null;
let serverProcess = null;
let keychainServerHandle = null;

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(APP_URL, (res) => {
      resolve(res.statusCode < 500);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Probe /api/internal/health with the current launch's INTERNAL_TOKEN. The
 * server listening on APP_PORT belongs to THIS launch only if it returns
 * 200 from that endpoint.
 *
 * Returns 'ours' if a 200 came back, 'stranger' for literally anything else
 * (older versions of our own server that pre-date the health endpoint
 * return 404; an orphan with a stale token returns 403; an unrelated
 * service returns whatever). In packaged mode we treat 'stranger' as
 * "reclaim the port" — the only thing that should ever own 3005 in a
 * packaged install is us.
 */
function probeServerOwnership() {
  return new Promise((resolve) => {
    const req = http.get(`${APP_URL}/api/internal/health`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN },
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? 'ours' : 'stranger');
    });
    req.on('error', () => resolve('stranger'));
    req.setTimeout(1500, () => { req.destroy(); resolve('stranger'); });
  });
}

/**
 * Best-effort kill of any process listening on APP_PORT. macOS/Linux uses
 * `lsof`; Windows uses `netstat`. We send SIGKILL because we already know it
 * isn't ours and we need the port free before our new server can bind.
 *
 * Returns true if at least one process was successfully signalled.
 */
function killProcessesOnPort(port) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') {
      execFile('netstat', ['-ano', '-p', 'TCP'], (err, stdout) => {
        if (err) return resolve(false);
        const pids = new Set();
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = line.match(/:\s*(\d+)\s+.*\s+LISTENING\s+(\d+)\s*$/);
          if (m && Number(m[1]) === port) pids.add(Number(m[2]));
        }
        if (pids.size === 0) return resolve(false);
        for (const pid of pids) {
          try { process.kill(pid); } catch { /* ignore */ }
        }
        resolve(true);
      });
    } else {
      execFile('lsof', ['-ti', `tcp:${port}`], (err, stdout) => {
        if (err) return resolve(false);
        const pids = String(stdout).split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
        if (pids.length === 0) return resolve(false);
        for (const pid of pids) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
        }
        resolve(true);
      });
    }
  });
}

async function waitForServer(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Wait for the health endpoint to return 'ours'. Polls every 250ms.
 * Returns true once verified, false if exhausted.
 */
async function waitForOwnership(maxAttempts = 80) {
  for (let i = 0; i < maxAttempts; i++) {
    if ((await probeServerOwnership()) === 'ours') return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startServer() {
  // In dev: assume `npm run dev` is already running on the port
  // In packaged build: server files are bundled — start them
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    // Server resources live next to the app
    const appRoot = path.join(process.resourcesPath, 'app');
    const nextBin = path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

    // On macOS, use the Renderer Helper binary (which has LSUIElement: true) so the
    // child server process never gets its own Dock icon. Falls back to process.execPath
    // on other platforms or if the helper isn't found.
    let serverExecPath = process.execPath;
    if (process.platform === 'darwin') {
      const candidate = path.join(
        path.dirname(process.execPath), '..', 'Frameworks',
        'SSH Manager Helper (Renderer).app', 'Contents', 'MacOS',
        'SSH Manager Helper (Renderer)'
      );
      try {
        if (require('fs').existsSync(candidate)) serverExecPath = candidate;
      } catch {}
    }

    serverProcess = spawn(serverExecPath, [nextBin, 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        SSH_MANAGER_INTERNAL_TOKEN: INTERNAL_TOKEN,
        SSH_MANAGER_KEYCHAIN_URL: KEYCHAIN_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    // Dev: spawn `npm start` from the project root.
    // We avoid `shell: true` (which would route through /bin/sh and add an injection
    // surface for any future env-var or arg passed in). On Windows, `npm` is a .cmd
    // batch file, which spawn() can only resolve when given the full filename — so we
    // use `npm.cmd` there directly instead of relying on the shell.
    const projectRoot = path.join(__dirname, '..');
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    serverProcess = spawn(npmBin, ['start'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SSH_MANAGER_INTERNAL_TOKEN: INTERNAL_TOKEN,
        SSH_MANAGER_KEYCHAIN_URL: KEYCHAIN_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`));
  serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;
  });
}

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      // Kill the whole process group on Unix
      if (process.platform !== 'win32') {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } else {
        serverProcess.kill();
      }
    } catch (e) {
      try { serverProcess.kill(); } catch {}
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Pin the renderer to APP_URL — any in-page navigation to a foreign origin
  // would give that origin fetch access to the local API (its Origin would
  // match the loopback allowlist). Defense in depth against XSS / phishing
  // links rendered into the DOM.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // When this window closes, kill any ptys it owned so we don't leak ssh
  // children. ptyManager tracks ownership by BrowserWindow.id.
  const winId = mainWindow.id;
  mainWindow.on('closed', () => {
    try { ptyManager.killAllOwnedBy(winId); } catch { /* ignore */ }
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Standard macOS menu (Cmd+Q quits, etc.)
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }

  // Boot the in-process keychain delegation server FIRST so we can pass its
  // URL to the Next.js child. macOS attributes keychain access dialogs to
  // the process that calls keytar — running it from main means the dialog
  // says "SSH Manager", not "next-server".
  try {
    keychainServerHandle = await keychainServer.start(INTERNAL_TOKEN);
    KEYCHAIN_URL = keychainServerHandle.url;
    console.log(`[main] keychain server listening at ${KEYCHAIN_URL}`);
  } catch (err) {
    console.error('[main] keychain server failed to start, falling back to in-Next keytar:', err?.message || err);
    KEYCHAIN_URL = '';
  }

  // Register the SSH-pty IPC handlers BEFORE the window opens, so the
  // renderer can call open() during page load if it wants to.
  ptyManager.register({
    appUrl: APP_URL,
    internalToken: INTERNAL_TOKEN,
  });

  // Server boot sequence.
  //
  // Naive logic ("if port 3005 is in use, reuse it") would silently inherit a
  // stale next-server orphaned by a previous Electron launch. Each launch
  // generates a fresh SSH_MANAGER_INTERNAL_TOKEN — the orphan has the old one,
  // so every /api/internal/* call from this launch's pty-manager comes back
  // 403 "Forbidden". Quick Connect was broken in that state.
  //
  // In packaged mode we verify the running server is ours via a tiny
  // /api/internal/health probe (200 = ours; anything else = stranger). Older
  // versions of our own server that pre-date this endpoint also probe as
  // 'stranger' — that's fine, we want to reclaim the port from them too. The
  // only legitimate holder of 3005 in a packaged install is the current
  // launch.
  //
  // In dev mode we preserve the original behaviour: share whatever
  // `npm run dev` server is up, even though /api/internal/* won't work there.
  // Anyone running `npm run dev` separately is testing browser-side flows.
  if (app.isPackaged) {
    if (await isServerUp()) {
      const ownership = await probeServerOwnership();
      if (ownership !== 'ours') {
        console.warn(`[main] port ${APP_PORT} is held by another process; reclaiming`);
        const killed = await killProcessesOnPort(APP_PORT);
        if (!killed) {
          console.error('[main] failed to free port 3005 — kill returned no PIDs');
        }
        // Give the kernel a moment to release the port.
        await new Promise((r) => setTimeout(r, 400));
        startServer();
      }
      // ownership === 'ours' → leave the running server alone
    } else {
      startServer();
    }
  } else {
    if (!(await isServerUp())) startServer();
  }

  const ready = await waitForServer();
  if (!ready) {
    console.error('Server failed to become ready');
    app.quit();
    return;
  }

  // In packaged mode, confirm the server we just connected to is actually
  // ours. If `startServer()` lost a race against a foreign process binding
  // 3005 between `killProcessesOnPort` and `spawn`, we'd otherwise quietly
  // hand pty-manager a server that doesn't share our token.
  if (app.isPackaged) {
    const verified = await waitForOwnership();
    if (!verified) {
      console.error('[main] server is up but does not recognise our internal token');
      app.quit();
      return;
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { ptyManager.killAll(); } catch { /* ignore */ }
  try { keychainServerHandle?.close(); } catch { /* ignore */ }
  killServer();
});

process.on('exit', () => {
  try { ptyManager.killAll(); } catch { /* ignore */ }
  killServer();
});
