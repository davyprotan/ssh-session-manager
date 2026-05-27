// Loaded inside an Electron utilityProcess. The only reason this file exists
// is to keep `require('keytar')` out of the main process.
//
// keytar's NAPI wrapper can throw a C++ exception that bypasses JavaScript
// try/catch and aborts the host process. In v0.9.37 that took the entire
// app down (see the crash trace in the v7 DB-migration comment). Running it
// here means a keytar abort kills only this helper; main observes 'exit'
// and treats the in-flight legacy operation as failed.
//
// Protocol: parent sends a single JSON message per request via process.send
// of shape { id, op, profileId } where op is 'extract' | 'forget'. We reply
// with { id, ok, password?, error? }. One message in, one message out.
// We never batch — keeping the helper's state machine trivial means a crash
// affects at most one pending op.

const SERVICE_NAME = 'SSH Manager';

let keytar = null;
try {
  const mod = require('keytar');
  keytar = mod.default || mod;
} catch (e) {
  // Reply to every incoming request with a load error. Don't exit — the
  // parent decides when to terminate us.
  process.parentPort.on('message', (ev) => {
    const msg = ev?.data;
    if (msg && typeof msg.id === 'number') {
      process.parentPort.postMessage({
        id: msg.id,
        ok: false,
        error: `keytar failed to load: ${e?.message || e}`,
      });
    }
  });
  return;
}

function accountFor(profileId) {
  return `profile-${profileId}`;
}

process.parentPort.on('message', async (ev) => {
  const msg = ev?.data;
  if (!msg || typeof msg.id !== 'number') return;
  const { id, op, profileId } = msg;

  if (!Number.isInteger(profileId) || profileId <= 0) {
    process.parentPort.postMessage({ id, ok: false, error: 'invalid profileId' });
    return;
  }

  try {
    if (op === 'extract') {
      const password = await keytar.getPassword(SERVICE_NAME, accountFor(profileId));
      process.parentPort.postMessage({ id, ok: true, password: password ?? null });
      return;
    }
    if (op === 'forget') {
      await keytar.deletePassword(SERVICE_NAME, accountFor(profileId));
      process.parentPort.postMessage({ id, ok: true });
      return;
    }
    process.parentPort.postMessage({ id, ok: false, error: `unknown op: ${op}` });
  } catch (err) {
    process.parentPort.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
    });
  }
});
