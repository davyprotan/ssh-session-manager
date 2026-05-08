const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');
const ptyManager = require('./pty-manager');
const keychainServer = require('./keychain-server');

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

async function waitForServer(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 500));
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
      sandbox: false,
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

  // Start server if not already running, then show window
  const alreadyUp = await isServerUp();
  if (!alreadyUp) startServer();

  const ready = await waitForServer();
  if (!ready) {
    console.error('Server failed to become ready');
    app.quit();
    return;
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
