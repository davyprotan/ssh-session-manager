// In-process HTTP server that runs INSIDE the Electron main process and
// exposes a tiny REST surface for credential cryptography. The Next.js
// server (a child process) sends plaintext to /encrypt and stores the
// returned ciphertext in its own SQLite DB; to read a password back it
// sends the ciphertext to /decrypt.
//
// WHY this exists at all:
//   Electron's `safeStorage` API is main-process only — the Next child can't
//   call it directly. This server is the bridge.
//
// WHY safeStorage (not keytar):
//   keytar's NAPI wrapper can throw a C++ exception that bypasses JS
//   try/catch and aborts the host process. It killed the app in v0.9.37.
//   safeStorage is part of Electron itself, runs in main, and is the path
//   Electron now recommends for storing user secrets.
//
// SECURITY:
//   - Bound to 127.0.0.1 only, OS-assigned ephemeral port (no fixed port)
//   - Every request must carry x-internal-token matching the per-launch
//     SSH_MANAGER_INTERNAL_TOKEN (constant-time-ish compare to avoid leaking
//     whether tokens share a prefix)
//   - The renderer can never reach this — it doesn't have the token, and the
//     port isn't advertised anywhere a renderer-compromise could read
//   - Plaintext is never logged. /encrypt and /decrypt bodies are read,
//     used, and dropped.
//
// Endpoints:
//   GET  /available                 → { available: boolean }
//   POST /encrypt   { plaintext }   → { ciphertext: <base64> }
//   POST /decrypt   { ciphertext }  → { plaintext }
//   POST /legacy/extract { profileId }
//                                   → { ciphertext: <base64> | null }
//                                     Reads the legacy keytar entry via a
//                                     utilityProcess, re-encrypts with
//                                     safeStorage, returns. Used by the
//                                     keytar→safeStorage migration only.
//   POST /legacy/forget  { profileId }
//                                   → { ok: true }
//                                     Deletes the legacy keytar entry via the
//                                     utilityProcess. Used after a successful
//                                     migration write.

const http = require('http');
const path = require('path');
const { safeStorage, utilityProcess } = require('electron');

// ─── Legacy keytar helper (utilityProcess) ──────────────────────────────
//
// We spawn the helper lazily on the first /legacy/* call, keep it alive for
// the duration of the migration, and respawn on crash. Each operation gets
// a unique numeric id; the helper echoes the id in its reply so we can route
// responses to the right pending promise. If keytar aborts inside the helper
// the process exits — all pending promises get rejected and main keeps
// running.

const LEGACY_OP_TIMEOUT_MS = 5000;

let legacyProc = null;
let nextLegacyId = 1;
const legacyPending = new Map(); // id → { resolve, reject, timer }

function rejectAllLegacyPending(reason) {
  for (const [, p] of legacyPending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  legacyPending.clear();
}

function ensureLegacyHelper() {
  if (legacyProc) return;
  const helperPath = path.join(__dirname, 'keytar-helper.js');
  legacyProc = utilityProcess.fork(helperPath, [], {
    serviceName: 'keytar-helper',
    stdio: 'ignore',
  });
  legacyProc.on('message', (msg) => handleLegacyMessage(msg));
  legacyProc.on('exit', (code) => {
    console.warn(`[keychain-server] legacy helper exited (code=${code})`);
    rejectAllLegacyPending(`legacy helper exited with code ${code}`);
    legacyProc = null;
  });
}

function handleLegacyMessage(msg) {
  if (!msg || typeof msg.id !== 'number') return;
  const pending = legacyPending.get(msg.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  legacyPending.delete(msg.id);
  if (msg.ok) {
    pending.resolve(msg);
  } else {
    pending.reject(new Error(msg.error || 'legacy op failed'));
  }
}

function callLegacy(op, profileId) {
  return new Promise((resolve, reject) => {
    try {
      ensureLegacyHelper();
    } catch (e) {
      reject(new Error(`could not start legacy helper: ${e?.message || e}`));
      return;
    }
    const id = nextLegacyId++;
    const timer = setTimeout(() => {
      legacyPending.delete(id);
      reject(new Error(`legacy ${op} timed out`));
    }, LEGACY_OP_TIMEOUT_MS);
    legacyPending.set(id, { resolve, reject, timer });
    try {
      legacyProc.postMessage({ id, op, profileId });
    } catch (e) {
      clearTimeout(timer);
      legacyPending.delete(id);
      reject(new Error(`postMessage failed: ${e?.message || e}`));
    }
  });
}

function stopLegacyHelper() {
  rejectAllLegacyPending('keychain server stopping');
  if (legacyProc) {
    try { legacyProc.kill(); } catch { /* ignore */ }
    legacyProc = null;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────

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

// ─── Server ─────────────────────────────────────────────────────────────

/**
 * Start the credential bridge server.
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

      // GET /available — is safeStorage usable on this host?
      if (req.method === 'GET' && url.pathname === '/available') {
        let available = false;
        try { available = safeStorage.isEncryptionAvailable(); } catch { /* false */ }
        return reply(res, 200, { available });
      }

      // POST /encrypt — { plaintext: string } → { ciphertext: base64 }
      if (req.method === 'POST' && url.pathname === '/encrypt') {
        let body;
        try { body = await readBody(req); }
        catch (e) { return reply(res, 400, { error: e?.message || 'bad body' }); }
        if (typeof body.plaintext !== 'string') {
          return reply(res, 400, { error: 'plaintext required' });
        }
        if (!safeStorage.isEncryptionAvailable()) {
          return reply(res, 503, { error: 'encryption unavailable' });
        }
        try {
          const buf = safeStorage.encryptString(body.plaintext);
          return reply(res, 200, { ciphertext: buf.toString('base64') });
        } catch (err) {
          return reply(res, 500, { error: err?.message || 'encrypt failed' });
        }
      }

      // POST /decrypt — { ciphertext: base64 } → { plaintext: string }
      if (req.method === 'POST' && url.pathname === '/decrypt') {
        let body;
        try { body = await readBody(req); }
        catch (e) { return reply(res, 400, { error: e?.message || 'bad body' }); }
        if (typeof body.ciphertext !== 'string') {
          return reply(res, 400, { error: 'ciphertext required' });
        }
        if (!safeStorage.isEncryptionAvailable()) {
          return reply(res, 503, { error: 'encryption unavailable' });
        }
        let buf;
        try { buf = Buffer.from(body.ciphertext, 'base64'); }
        catch { return reply(res, 400, { error: 'invalid base64' }); }
        try {
          const plaintext = safeStorage.decryptString(buf);
          return reply(res, 200, { plaintext });
        } catch (err) {
          return reply(res, 500, { error: err?.message || 'decrypt failed' });
        }
      }

      // POST /legacy/extract — { profileId } → { ciphertext: base64 | null }
      // Reads the legacy keytar entry via the utilityProcess, re-encrypts
      // with safeStorage, returns the ciphertext. Used only by migration.
      if (req.method === 'POST' && url.pathname === '/legacy/extract') {
        let body;
        try { body = await readBody(req); }
        catch (e) { return reply(res, 400, { error: e?.message || 'bad body' }); }
        const profileId = Number(body.profileId);
        if (!Number.isInteger(profileId) || profileId <= 0) {
          return reply(res, 400, { error: 'invalid profileId' });
        }
        if (!safeStorage.isEncryptionAvailable()) {
          return reply(res, 503, { error: 'encryption unavailable' });
        }
        try {
          const result = await callLegacy('extract', profileId);
          const password = result.password;
          if (typeof password !== 'string' || password.length === 0) {
            return reply(res, 200, { ciphertext: null });
          }
          const buf = safeStorage.encryptString(password);
          return reply(res, 200, { ciphertext: buf.toString('base64') });
        } catch (err) {
          return reply(res, 500, { error: err?.message || 'extract failed' });
        }
      }

      // POST /legacy/forget — { profileId } → { ok: true }
      if (req.method === 'POST' && url.pathname === '/legacy/forget') {
        let body;
        try { body = await readBody(req); }
        catch (e) { return reply(res, 400, { error: e?.message || 'bad body' }); }
        const profileId = Number(body.profileId);
        if (!Number.isInteger(profileId) || profileId <= 0) {
          return reply(res, 400, { error: 'invalid profileId' });
        }
        try {
          await callLegacy('forget', profileId);
          return reply(res, 200, { ok: true });
        } catch (err) {
          return reply(res, 500, { error: err?.message || 'forget failed' });
        }
      }

      return reply(res, 404, { error: 'not found' });
    });

    server.on('error', reject);
    // Listen on 127.0.0.1 with an OS-assigned port for isolation.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        close: () => new Promise((res) => {
          stopLegacyHelper();
          server.close(() => res(undefined));
        }),
      });
    });
  });
}

module.exports = { start };
