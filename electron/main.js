const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const APP_PORT = 3005;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

let mainWindow = null;
let serverProcess = null;

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

    serverProcess = spawn(process.execPath, [nextBin, 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
      cwd: appRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    // Dev: spawn `npm start` from the project root
    const projectRoot = path.join(__dirname, '..');
    serverProcess = spawn('npm', ['start'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
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

  mainWindow.on('closed', () => {
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
  killServer();
});

process.on('exit', killServer);
