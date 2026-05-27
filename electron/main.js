const { app, BrowserWindow, shell, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');
const ptyManager = require('./pty-manager');
const keychainServer = require('./keychain-server');

// Process-level safety nets.
//
// Main does not load keytar anymore — credential storage now goes through
// Electron's safeStorage via electron/keychain-server.js, and the one-shot
// keytar→safeStorage migration runs inside a utilityProcess (see
// electron/keytar-helper.js) so a keytar abort kills only that helper.
// These handlers remain as a generic last-line-of-defence: any uncaught JS
// exception is logged instead of crashing the app. They will NOT catch
// native C++ exceptions from N-API addons (those bypass V8 entirely), but
// no main-process addon currently throws that way.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException — preventing abort:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason && (reason.stack || reason.message || reason));
});

const APP_PORT = 3005;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

// Enforce a single SSH Manager instance per user.
//
// Without this, two main processes can coexist — one from a normal Launchpad
// open, one from a developer running `./SSH Manager` directly, or one left
// over after a crashed quit. Each main has its OWN per-launch
// SSH_MANAGER_INTERNAL_TOKEN, but only ONE next-server can hold port 3005 at a
// time. Whichever main's renderer the user is interacting with sends API
// requests with ITS token; if the server was spawned by the OTHER main,
// `/api/internal/*` returns 403.
//
// The singleton lock pins instance-1 as the only legitimate main. Subsequent
// launches receive 'second-instance' and quit themselves after asking the
// existing instance to surface its window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// Random per-launch token gating /api/_internal/* routes (e.g. spawn-plan)
// AND the in-process keychain delegation server. Generated here, passed to
// Next.js via env, never sent to the renderer.
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');

// Set when the keychain server has booted. Passed to the Next.js child via
// env so server-side code can delegate safeStorage encrypt/decrypt calls to
// the main process — safeStorage only exists in main, not in the Next child.
let KEYCHAIN_URL = '';

let mainWindow = null;
let serverProcess = null;
let keychainServerHandle = null;

// Ring buffer for the bundled Next server's stdout/stderr. Held so that if
// the server crashes during boot we can show the last few lines in the
// failure dialog (and write them all to a crash log on disk). Capped to
// avoid unbounded memory growth during a long-running session.
const SERVER_LOG_MAX_LINES = 200;
const serverLogLines = [];

function captureServerLine(stream, raw) {
  for (const line of String(raw).split(/\r?\n/)) {
    const s = line.trimEnd();
    if (!s) continue;
    serverLogLines.push(`[${stream}] ${s}`);
    while (serverLogLines.length > SERVER_LOG_MAX_LINES) serverLogLines.shift();
  }
}

// Resolved when the server child exits. Used to short-circuit waitForServer:
// if the child dies (e.g. SWC binary missing), there's no point waiting the
// full 30 s polling for a port that will never bind.
let serverExitInfo = null;
let resolveServerExit = null;
const serverExitedPromise = new Promise((r) => { resolveServerExit = r; });

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

  serverProcess.stdout?.on('data', (d) => {
    captureServerLine('out', d);
    console.log(`[server] ${d}`);
  });
  serverProcess.stderr?.on('data', (d) => {
    captureServerLine('err', d);
    console.error(`[server] ${d}`);
  });
  serverProcess.on('exit', (code, signal) => {
    console.log(`Server exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
    serverExitInfo = { code, signal };
    serverProcess = null;
    resolveServerExit?.(serverExitInfo);
  });
}

// Where boot-crash logs land. Stored under the same data dir as
// sessions.db so users finding their data folder also find their logs.
const LOG_DIR = path.join(os.homedir(), '.ssh-session-manager', 'logs');

function writeBootCrashLog(reason) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(LOG_DIR, `boot-crash-${stamp}.log`);
    const body = [
      `SSH Manager boot failure`,
      `Time:           ${new Date().toISOString()}`,
      `App version:    ${app.getVersion()}`,
      `Electron:       ${process.versions.electron}`,
      `Node:           ${process.versions.node}`,
      `Platform:       ${process.platform} ${process.arch}`,
      `OS version:     ${process.getSystemVersion?.() || '(unknown)'}`,
      `Reason:         ${reason}`,
      `Server exit:    code=${serverExitInfo?.code ?? '(still running / timed out)'} signal=${serverExitInfo?.signal ?? '(none)'}`,
      ``,
      `--- captured server output (last ${serverLogLines.length} line${serverLogLines.length === 1 ? '' : 's'}) ---`,
      serverLogLines.length ? serverLogLines.join('\n') : '(no output captured)',
    ].join('\n');
    fs.writeFileSync(file, body);
    return { file, body };
  } catch (e) {
    console.error('[main] failed to write boot crash log:', e?.message || e);
    return { file: null, body: null };
  }
}

/**
 * Show a native dialog explaining that the bundled Next server didn't
 * start. Without this, a failed-boot just leaves Electron alive with no
 * window — symptomatically identical to "data is gone", which is what
 * scared us into the recovery thread in the first place.
 *
 * Returns the user's button choice; caller is expected to quit either way.
 */
async function showBootFailureDialog(reason) {
  const { file: logFile, body: logBody } = writeBootCrashLog(reason);
  const tail = serverLogLines.slice(-25).join('\n') || '(no output captured)';

  const detail = [
    `Your sessions and profiles are still safe on disk at:`,
    `  ~/.ssh-session-manager/sessions.db`,
    `Reinstalling or downgrading SSH Manager will not touch that file.`,
    ``,
    `Reason: ${reason}`,
    serverExitInfo
      ? `Server exit: code=${serverExitInfo.code} signal=${serverExitInfo.signal ?? 'none'}`
      : `Server status: did not become ready within the boot window.`,
    ``,
    `--- recent server output ---`,
    tail,
    ``,
    logFile ? `Full crash log: ${logFile}` : `(could not write crash log to disk)`,
  ].join('\n');

  const buttons = ['Copy details', 'Open log folder', 'Quit'];
  const result = await dialog.showMessageBox({
    type: 'error',
    title: 'SSH Manager — startup failed',
    message: 'SSH Manager could not start its bundled server.',
    detail,
    buttons,
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  });

  if (result.response === 0) {
    clipboard.writeText(logBody || detail);
  } else if (result.response === 1 && logFile) {
    try { shell.showItemInFolder(logFile); } catch { /* ignore */ }
  }
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

  // Boot the in-process credential bridge FIRST so we can pass its URL to
  // the Next.js child. safeStorage only exists in main; the child sends
  // plaintext to /encrypt and stores the returned ciphertext in the DB.
  try {
    keychainServerHandle = await keychainServer.start(INTERNAL_TOKEN);
    KEYCHAIN_URL = keychainServerHandle.url;
    console.log(`[main] keychain server listening at ${KEYCHAIN_URL}`);
  } catch (err) {
    console.error('[main] keychain server failed to start:', err?.message || err);
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

  // Race the standard boot wait against the server process exiting. The
  // bundled Next server can die early during boot — most famously when the
  // SWC native binary is missing (see v0.9.34) — and there's no value in
  // waiting the full 30 s polling for a port that will never bind.
  //
  // We only show the failure dialog in packaged mode. In dev, `npm run dev`
  // is expected to be managed by the developer; a flapping server there is
  // a normal part of debugging and a modal would just get in the way.
  const ready = await Promise.race([
    waitForServer().then((ok) => ({ kind: 'ready', ok })),
    serverExitedPromise.then(() => ({ kind: 'exited' })),
  ]);
  if (ready.kind === 'exited' || !ready.ok) {
    const reason = ready.kind === 'exited'
      ? `Bundled Next server exited before becoming ready.`
      : `Bundled Next server did not respond within ${30} seconds.`;
    console.error(`[main] ${reason}`);
    if (app.isPackaged) {
      await showBootFailureDialog(reason);
    }
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
      await showBootFailureDialog(
        `Server is reachable on port 3005 but does not recognise this launch's internal token. ` +
        `This usually means another process bound the port between checks.`,
      );
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
