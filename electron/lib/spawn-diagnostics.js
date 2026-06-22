// Turns a node-pty spawn failure into an accurate, actionable message.
//
// WHY THIS EXISTS:
//
//   On macOS, node-pty (1.1.0) throws a single bare string — "posix_spawnp
//   failed." — for several unrelated failures, because its native code maps
//   every early-exit in pty_posix_spawn to the same throw (the `err` variable
//   starts at -1 and the pty-allocation failures return without resetting it;
//   see node_modules/node-pty/src/unix/pty.cc:370). That same string fires
//   when:
//     * the pty device table is exhausted (posix_openpt → ENXIO/EAGAIN),
//     * the per-user process cap is hit (posix_spawn → EAGAIN),
//     * the ssh binary isn't on PATH (posix_spawn → ENOENT),
//     * memory is exhausted (ENOMEM), etc.
//
//   We can't recover node-pty's errno, so instead of GUESSING (an earlier
//   version counted /dev/ttys nodes, which is unreliable) we DIRECTLY PROBE the
//   one thing that matters: can the kernel hand out a pty right now? We attempt
//   to open the pty master clone device (/dev/ptmx) and immediately close it.
//   This is exactly the first thing node-pty does, so it reproduces the real
//   failure with a real errno — no heuristics.
//
//   Why pty exhaustion needs a reboot on macOS: closing a pty does not always
//   return its slave device node to the pool; nodes can linger for the rest of
//   the boot session, so a machine that has churned through many terminals can
//   hit the kern.tty.ptmx_max cap with almost nothing actually open. Once the
//   probe returns ENXIO, no app on the system can spawn a pty until reboot.

const fs = require('fs');

// node-pty error strings that unambiguously name the pty subsystem.
const PTY_ERROR_RE = /forkpty|openpty|out of pty|Device not configured|ptmx|pseudo-?terminal/i;

// errno codes from opening /dev/ptmx that mean "no pty available right now".
const PTY_EXHAUSTED_CODES = new Set(['ENXIO', 'EAGAIN', 'EMFILE', 'ENFILE', 'ENOSPC', 'EBUSY']);

/**
 * Directly test whether the OS can allocate a pseudo-terminal right now by
 * opening (and immediately closing) the master clone device. macOS and Linux
 * both expose it at /dev/ptmx.
 *
 * @returns {'available'|'exhausted'|'unknown'}
 */
function probePtyAvailability({ open = fs.openSync, close = fs.closeSync } = {}) {
  let fd;
  try {
    fd = open('/dev/ptmx', fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  } catch (e) {
    const code = e && e.code;
    if (PTY_EXHAUSTED_CODES.has(code)) return 'exhausted';
    // ENOENT (no /dev/ptmx — not macOS/Linux), EACCES, anything else: we can't
    // conclude exhaustion from this, so stay out of the way.
    return 'unknown';
  }
  try { close(fd); } catch { /* ignore */ }
  return 'available';
}

// Resolve `file` against a PATH string the same way execvp would, so our
// "ssh not found" verdict matches what the child process actually sees.
// Returns the resolved path, or null if not found / not executable.
function resolveOnPath(file, pathEnv) {
  if (typeof file !== 'string' || !file) return null;
  if (file.includes('/')) {
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { return null; }
  }
  const dirs = String(pathEnv || '').split(':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = `${dir}/${file}`;
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next */ }
  }
  return null;
}

function ptyExhaustedMessage(raw) {
  return (
    `macOS is out of pseudo-terminals — the kernel cannot allocate a new one ` +
    `right now, so the ssh session can't start. Quit unused Terminal/iTerm ` +
    `windows, SSH sessions, and other terminal-heavy apps to free some. On ` +
    `macOS closed ptys can linger until reboot, so if connections keep failing ` +
    `after closing things, restart macOS to reset the pty device table. (${raw})`
  );
}

/**
 * Pure decision logic. Given the raw error plus already-probed system facts,
 * returns the message to show the user.
 *
 * @param {object} facts
 * @param {string} facts.raw       - raw error message from node-pty
 * @param {string|null} facts.sshPath - resolved path to the ssh binary, or null
 * @param {'available'|'exhausted'|'unknown'} facts.ptyAvailability - probe result
 */
function buildSpawnDiagnosis({ raw, sshPath, ptyAvailability }) {
  const message = String(raw || '').trim() || 'unknown error';

  // 1. Genuine pty exhaustion — confirmed by directly probing the kernel, or
  //    named outright by node-pty. This is the case that actually needs a
  //    reboot, so we only say so when we're sure.
  if (ptyAvailability === 'exhausted' || PTY_ERROR_RE.test(message)) {
    return ptyExhaustedMessage(message);
  }

  // 2. ssh binary missing → posix_spawn returns ENOENT. A restart never helps.
  if (!sshPath) {
    return (
      `the "ssh" command could not be found on PATH, so macOS refused to ` +
      `start it. Install OpenSSH or make sure /usr/bin is on PATH, then retry. ` +
      `(${message})`
    );
  }

  // 3. Ambiguous "posix_spawnp failed." with ssh present AND ptys available.
  //    The most common remaining cause is the per-user process cap (EAGAIN).
  //    We do NOT suggest a reboot — the probe proved ptys are fine.
  return (
    `macOS could not start the ssh process. This is usually a temporary ` +
    `resource limit such as the per-user process cap — quit a few background ` +
    `apps and try again. (${message})`
  );
}

/**
 * Probe live system state and return an accurate failure message.
 *
 * @param {Error|string} err
 * @param {object} [opts]
 * @param {string} [opts.pathEnv]  - PATH the child was/would be spawned with
 * @param {function} [opts.resolveExecutable]   - injectable for tests
 * @param {function} [opts.getPtyAvailability]  - injectable for tests
 */
function diagnoseSpawnFailure(err, opts = {}) {
  const raw = String(err?.message || err || '').trim() || 'unknown error';
  const {
    pathEnv = process.env.PATH,
    resolveExecutable = resolveOnPath,
    getPtyAvailability = probePtyAvailability,
  } = opts;

  let sshPath = null;
  try { sshPath = resolveExecutable('ssh', pathEnv); } catch { sshPath = null; }

  let ptyAvailability = 'unknown';
  try { ptyAvailability = getPtyAvailability(); } catch { ptyAvailability = 'unknown'; }

  return buildSpawnDiagnosis({ raw, sshPath, ptyAvailability });
}

module.exports = {
  diagnoseSpawnFailure,
  buildSpawnDiagnosis,
  probePtyAvailability,
  resolveOnPath,
  PTY_ERROR_RE,
};
