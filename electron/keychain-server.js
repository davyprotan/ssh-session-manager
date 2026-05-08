// In-process HTTP server that runs INSIDE the Electron main process and
// exposes a tiny REST surface for keychain operations. The Next.js server
// (a child process) delegates all keytar calls here so that macOS sees
// "SSH Manager" — the actual app bundle — as the requesting application,
// not "next-server (vX.Y.Z)" which is what process.title reports inside
// the bundled Next child.
//
// SECURITY:
//   - Bound to 127.0.0.1 only, OS-assigned ephemeral port (no fixed port)
//   - Every request must carry x-internal-token matching SSH_MANAGER_INTERNAL_TOKEN
//     (per-launch random, never leaves main + the immediate child)
//   - The renderer can never reach this — it doesn't have the token, and the
//     port isn't advertised anywhere a renderer-compromise could read
//   - Constant-time-ish token compare to avoid leaking whether tokens shared
//     a prefix
//
// Endpoints (profileId is a positive integer):
//   GET  /available                 → { available: boolean }
//   GET  /keychain/:profileId       → { password: string | null }
//   POST /keychain/:profileId       (body: { password }) → { ok: true }
//   DELETE /keychain/:profileId     → { ok: true }

const http = require('http');

const SERVICE_NAME = 'SSH Manager';

let _keytar = null;
let _available = true;
function loadKeytar() {
  if (_keytar) return _keytar;
  if (!_available) return null;
  try {
    const mod = require('keytar');
    _keytar = mod.default || mod;
    return _keytar;
  } catch (e) {
    console.warn('[keychain-server] keytar unavailable:', e?.message || e);
    _available = false;
    return null;
  }
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error(`invalid json: ${e?.message || e}`)); }
    });
    req.on('error', reject);
  });
}

function reply(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/**
 * Start the keychain delegation server.
 * Returns { url: string, close: () => Promise<void> }.
 */
function start(internalToken) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Auth gate.
      if (!timingSafeStringEqual(req.headers['x-internal-token'] || '', internalToken)) {
        return reply(res, 403, { error: 'forbidden' });
      }

      let url;
      try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
      catch { return reply(res, 400, { error: 'bad url' }); }

      const k = loadKeytar();

      // /available — caller checks whether keytar loaded
      if (req.method === 'GET' && url.pathname === '/available') {
        return reply(res, 200, { available: !!k });
      }

      const m = url.pathname.match(/^\/keychain\/(\d+)$/);
      if (!m) return reply(res, 404, { error: 'not found' });
      const profileId = parseInt(m[1], 10);
      if (!Number.isInteger(profileId) || profileId <= 0) {
        return reply(res, 400, { error: 'invalid profile id' });
      }

      if (!k) return reply(res, 503, { error: 'keytar unavailable' });

      const account = `profile-${profileId}`;
      try {
        if (req.method === 'GET') {
          const password = await k.getPassword(SERVICE_NAME, account);
          return reply(res, 200, { password: password ?? null });
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (typeof body.password !== 'string') {
            return reply(res, 400, { error: 'password required' });
          }
          await k.setPassword(SERVICE_NAME, account, body.password);
          return reply(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          await k.deletePassword(SERVICE_NAME, account);
          return reply(res, 200, { ok: true });
        }
        return reply(res, 405, { error: 'method not allowed' });
      } catch (err) {
        console.error('[keychain-server] op failed:', err?.message || err);
        return reply(res, 500, { error: err?.message || 'op failed' });
      }
    });

    server.on('error', reject);
    // Listen on 127.0.0.1 with an OS-assigned port for isolation.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        close: () => new Promise((res) => server.close(() => res(undefined))),
      });
    });
  });
}

module.exports = { start };
