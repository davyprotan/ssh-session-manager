// Manages live ssh PTY sessions on the Electron main side.
//
// SECURITY MODEL (read this before changing anything):
//
//   1. The renderer never supplies command strings. It supplies a numeric
//      session_id. We GET /api/sessions/:id/spawn-plan over loopback (with
//      an internal token the renderer never has) and the Next.js side runs
//      the validated buildSshArgs. The argv we receive is then passed to
//      node-pty's spawn(file, args, opts) — no shell, no string concat.
//
//   2. PTY handles are server-issued opaque integers. The renderer only ever
//      possesses handles it received from open(). Every write/resize/close
//      is validated against an internal Map<handle, owner-window-id>. A
//      renderer can't ride another window's handle.
//
//   3. Output is forwarded as Buffer (becomes Uint8Array over IPC). xterm.js
//      handles UTF-8 decoding on the renderer side.
//
//   4. We bound output backlog (RING_BUFFER_BYTES) so a misbehaving server
//      can't OOM the main process.
//
//   5. On window-closed we kill all owned ptys synchronously to prevent
//      zombies.

const { ipcMain, BrowserWindow } = require('electron');
const http = require('http');
const { scanForPrompt } = require('./lib/prompt-detector');

let nodePty = null;
function loadPty() {
  if (nodePty) return nodePty;
  try {
    nodePty = require('node-pty');
    return nodePty;
  } catch (e) {
    console.error('[pty] failed to load node-pty:', e?.message || e);
    return null;
  }
}

const RING_BUFFER_BYTES = 64 * 1024;
const MAX_SESSIONS_PER_WINDOW = 16;
// Tail kept in memory for prompt detection. Small — passwords prompts always
// appear within a few hundred bytes of the connect handshake.
const PROMPT_TAIL_BYTES = 4 * 1024;

let _nextHandle = 1;
const sessions = new Map(); // handle -> { pty, ownerId, audit, ringBytes, autoFillState, promptTail }

let _config = {
  appUrl: 'http://127.0.0.1:3005',
  internalToken: '',
  onPtyData: null,
};

function internalGet(pathname) {
  return new Promise((resolve, reject) => {
    const url = `${_config.appUrl}${pathname}`;
    const req = http.get(url, {
      headers: { 'x-internal-token': _config.internalToken },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let err = body;
          try { err = JSON.parse(body)?.error || err; } catch { /* leave as raw */ }
          return reject(new Error(`${pathname} ${res.statusCode}: ${err}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`${pathname} parse failed: ${e?.message || e}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error(`${pathname} timeout`)); });
  });
}

function fetchSpawnPlan(sessionId) {
  return internalGet(`/api/sessions/${encodeURIComponent(sessionId)}/spawn-plan`);
}

function internalPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${_config.appUrl}${pathname}`);
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'x-internal-token': _config.internalToken,
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    }, (res) => {
      let respBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { respBody += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let err = respBody;
          try { err = JSON.parse(respBody)?.error || err; } catch { /* leave raw */ }
          return reject(new Error(`${pathname} ${res.statusCode}: ${err}`));
        }
        try { resolve(JSON.parse(respBody)); }
        catch (e) { reject(new Error(`${pathname} parse failed: ${e?.message || e}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error(`${pathname} timeout`)); });
    req.write(payload);
    req.end();
  });
}

function fetchAdHocSpawnPlan({ host, profileId, port, jumpHost }) {
  return internalPost('/api/internal/spawn-plan-ad-hoc', {
    host, profile_id: profileId, port, jump_host: jumpHost,
  });
}

function fetchProfileSecret(profileId) {
  return internalGet(`/api/profiles/${encodeURIComponent(profileId)}/internal-secret`)
    .then((data) => (data && typeof data.password === 'string') ? data.password : null);
}

/**
 * Best-effort: try to inject the password if the recent pty output looks like
 * a password/passphrase prompt and we haven't injected yet.
 *
 * Keeps state on the session object: autoFillState toggles to 'injected' on
 * success, 'failed' on the first prompt with no secret, 'disabled' when the
 * user opted out.
 *
 * The password is kept on the call stack only (one local variable, then
 * written into the pty). We do NOT store it on the session object after
 * injection.
 */
async function maybeAutoInject(handle, session) {
  if (session.autoFillState !== 'pending') return;
  if (!session.audit.profileId) {
    session.autoFillState = 'failed';
    return;
  }

  const profile = session.audit;
  const decision = scanForPrompt({
    recentOutput: session.promptTail,
    alreadyInjected: false,
    hasStoredSecret:
      profile.profileAuthType === 'password' || profile.profileAuthType === 'key_with_passphrase',
  });

  if (decision.kind === 'none') return;
  if (decision.kind === 'skip') {
    // A yes/no prompt (host-key acceptance on first connect, sudo
    // confirmation, etc.) is TRANSIENT — the user will answer and the
    // real password prompt typically comes immediately after. We must
    // not permanently disable auto-fill here, or first-time connects
    // would never get auto-filled.
    //
    // Other skip reasons (MFA / OTP context, no stored secret, already
    // injected) are session-final, so we mark the session disabled.
    const isTransient = typeof decision.reason === 'string' && /yes\/no/i.test(decision.reason);

    if (typeof _config.audit === 'function' && !isTransient) {
      _config.audit('terminal.autofill_skipped', {
        target_type: 'session',
        target_id: profile.sessionId,
        target_label: profile.sessionLabel,
        details: { reason: decision.reason },
      });
    }

    if (!isTransient) {
      session.autoFillState = 'disabled';
    } else {
      // Throw away the recent tail so the next scan doesn't keep matching the
      // yes/no question and we evaluate fresh once the user has answered.
      session.promptTail = '';
    }
    return;
  }

  // Pull the secret from the keychain via the internal endpoint.
  let secret;
  try {
    secret = await fetchProfileSecret(profile.profileId);
  } catch (e) {
    console.warn('[pty] failed to fetch secret:', e?.message || e);
    session.autoFillState = 'failed';
    return;
  }

  if (!secret) {
    session.autoFillState = 'failed';
    return;
  }

  // Race guard: another chunk may have already triggered injection while we
  // were awaiting the keychain.
  if (session.autoFillState !== 'pending') {
    secret = null;
    return;
  }

  try {
    session.pty.write(secret + '\r');
  } catch (e) {
    console.warn('[pty] inject write failed:', e?.message || e);
    session.autoFillState = 'failed';
    secret = null;
    return;
  }

  // Best-effort scrub. JS strings are immutable so we can't actually wipe
  // the bytes, but we can at least drop the only reference and hope GC.
  secret = null;

  session.autoFillState = 'injected';
  session.promptTail = ''; // don't re-trigger on the same tail

  if (typeof _config.audit === 'function') {
    _config.audit('terminal.password_injected', {
      target_type: 'session',
      target_id: profile.sessionId,
      target_label: profile.sessionLabel,
      details: { kind: decision.kind },
    });
  }
}

function killOrphans() {
  for (const [handle, s] of sessions) {
    const win = BrowserWindow.fromId(s.ownerId);
    if (!win || win.isDestroyed()) {
      try { s.pty.kill(); } catch { /* ignore */ }
      sessions.delete(handle);
    }
  }
}

function killAllOwnedBy(windowId) {
  for (const [handle, s] of sessions) {
    if (s.ownerId === windowId) {
      try { s.pty.kill(); } catch { /* ignore */ }
      sessions.delete(handle);
    }
  }
}

function killAll() {
  for (const [handle, s] of sessions) {
    try { s.pty.kill(); } catch { /* ignore */ }
    sessions.delete(handle);
  }
}

function register(config) {
  _config = { ..._config, ...config };

  async function spawnFromPlan(senderWindow, plan, payload) {
    if (!Array.isArray(plan?.argv) || plan.argv.length === 0) {
      return { ok: false, error: 'spawn-plan returned empty argv' };
    }
    // Defensive: every argv element must be a string.
    for (const a of plan.argv) {
      if (typeof a !== 'string') {
        return { ok: false, error: 'spawn-plan argv contained non-string' };
      }
    }

    const pty = loadPty();
    if (!pty) return { ok: false, error: 'node-pty unavailable on this platform' };

    const cols = Math.max(20, Math.min(500, Number(payload?.cols) || 80));
    const rows = Math.max(5, Math.min(200, Number(payload?.rows) || 24));

    let ptyProc;
    try {
      ptyProc = pty.spawn('ssh', plan.argv, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || '/',
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          DISPLAY: '',
          SSH_ASKPASS: '',
        },
      });
    } catch (err) {
      return { ok: false, error: `spawn failed: ${err?.message || err}` };
    }

    const handle = _nextHandle++;
    const perSessionAutoFill = payload?.disableAutoFill ? 'disabled' : 'pending';
    const session = {
      pty: ptyProc,
      ownerId: senderWindow.id,
      audit: {
        sessionId: plan.sessionId ?? null,
        profileId: plan.profileId,
        profileAuthType: plan.profileAuthType,
        sessionLabel: plan.sessionLabel,
      },
      ringBytes: 0,
      autoFillState: perSessionAutoFill,
      promptTail: '',
    };
    sessions.set(handle, session);

    if (typeof _config.audit === 'function') {
      _config.audit('terminal.open', {
        target_type: plan.sessionId ? 'session' : 'profile',
        target_id: plan.sessionId ?? plan.profileId ?? null,
        target_label: plan.sessionLabel,
        details: { ad_hoc: !plan.sessionId },
      });
    }

    wireDataAndExit(handle, session);
    return { ok: true, handle, display: plan.display, sessionLabel: plan.sessionLabel };
  }

  function wireDataAndExit(handle, session) {
    const ptyProc = session.pty;
    ptyProc.onData((data) => {
      const buf = Buffer.from(data, 'binary');
      session.ringBytes += buf.length;
      if (session.ringBytes > RING_BUFFER_BYTES) {
        // Just clamp the counter — we're not buffering, we forward immediately.
        session.ringBytes = RING_BUFFER_BYTES;
      }

      // Maintain a small UTF-8 tail used for prompt detection. Append the
      // chunk's string representation, then truncate to PROMPT_TAIL_BYTES.
      // We use 'utf8' decoding for the tail; xterm gets the raw bytes.
      if (session.autoFillState === 'pending' && _config.autoFillEnabled !== false) {
        const text = buf.toString('utf8');
        session.promptTail = (session.promptTail + text).slice(-PROMPT_TAIL_BYTES);
        // Run detection on the next microtask to avoid blocking forwarding.
        Promise.resolve().then(() => maybeAutoInject(handle, session));
      }

      const win = BrowserWindow.fromId(session.ownerId);
      if (win && !win.isDestroyed()) {
        win.webContents.send(`sshterm:data:${handle}`, buf);
      }
    });

    ptyProc.onExit(({ exitCode, signal }) => {
      if (typeof _config.audit === 'function') {
        _config.audit('terminal.exit', {
          target_type: session.audit.sessionId ? 'session' : 'profile',
          target_id: session.audit.sessionId ?? session.audit.profileId ?? null,
          target_label: session.audit.sessionLabel,
          details: { exitCode, signal },
        });
      }
      const win = BrowserWindow.fromId(session.ownerId);
      if (win && !win.isDestroyed()) {
        win.webContents.send(`sshterm:exit:${handle}`, { exitCode, signal });
      }
      sessions.delete(handle);
    });
  }

  ipcMain.handle('sshterm:open', async (event, payload) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return { ok: false, error: 'no window' };
    let owned = 0;
    for (const s of sessions.values()) if (s.ownerId === senderWindow.id) owned++;
    if (owned >= MAX_SESSIONS_PER_WINDOW) {
      return { ok: false, error: `too many open terminals (${MAX_SESSIONS_PER_WINDOW})` };
    }

    const sessionId = Number(payload?.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return { ok: false, error: 'invalid sessionId' };
    }

    let plan;
    try { plan = await fetchSpawnPlan(sessionId); }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }

    return spawnFromPlan(senderWindow, plan, payload);
  });

  ipcMain.handle('sshterm:open-ad-hoc', async (event, payload) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return { ok: false, error: 'no window' };
    let owned = 0;
    for (const s of sessions.values()) if (s.ownerId === senderWindow.id) owned++;
    if (owned >= MAX_SESSIONS_PER_WINDOW) {
      return { ok: false, error: `too many open terminals (${MAX_SESSIONS_PER_WINDOW})` };
    }

    const host = typeof payload?.host === 'string' ? payload.host.trim() : '';
    const profileId = Number(payload?.profileId);
    if (!host || !Number.isInteger(profileId) || profileId <= 0) {
      return { ok: false, error: 'host and profileId required' };
    }

    let plan;
    try {
      plan = await fetchAdHocSpawnPlan({
        host,
        profileId,
        port: Number.isFinite(Number(payload?.port)) ? Number(payload.port) : undefined,
        jumpHost: typeof payload?.jumpHost === 'string' ? payload.jumpHost : undefined,
      });
      // Override the label if the caller supplied one (typically the host).
      if (typeof payload?.label === 'string' && payload.label.trim()) {
        plan.sessionLabel = payload.label.trim();
      }
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }

    return spawnFromPlan(senderWindow, plan, payload);
  });

  ipcMain.handle('sshterm:write', (event, { handle, data }) => {
    const s = sessions.get(handle);
    if (!s) return { ok: false, error: 'unknown handle' };
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.id !== s.ownerId) {
      return { ok: false, error: 'handle not owned by this window' };
    }
    if (typeof data !== 'string') return { ok: false, error: 'data must be string' };
    try { s.pty.write(data); return { ok: true }; }
    catch (err) { return { ok: false, error: `write failed: ${err?.message || err}` }; }
  });

  ipcMain.handle('sshterm:resize', (event, { handle, cols, rows }) => {
    const s = sessions.get(handle);
    if (!s) return { ok: false, error: 'unknown handle' };
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.id !== s.ownerId) {
      return { ok: false, error: 'handle not owned by this window' };
    }
    const c = Math.max(20, Math.min(500, Number(cols) || 80));
    const r = Math.max(5, Math.min(200, Number(rows) || 24));
    try { s.pty.resize(c, r); return { ok: true }; }
    catch (err) { return { ok: false, error: `resize failed: ${err?.message || err}` }; }
  });

  ipcMain.handle('sshterm:close', (event, { handle }) => {
    const s = sessions.get(handle);
    if (!s) return { ok: true };
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.id !== s.ownerId) {
      return { ok: false, error: 'handle not owned by this window' };
    }
    try { s.pty.kill(); } catch { /* ignore */ }
    sessions.delete(handle);
    return { ok: true };
  });
}

module.exports = {
  register,
  killOrphans,
  killAllOwnedBy,
  killAll,
  _sessions: sessions,
};
