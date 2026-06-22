// Turns a node-pty spawn failure into an accurate, actionable message.
//
// WHY THIS EXISTS:
//
//   On macOS, node-pty (1.1.0) throws a single bare string — "posix_spawnp
//   failed." — for several unrelated failures, because its native code
//   discards the real errno (see node_modules/node-pty/src/unix/pty.cc:372).
//   That same path fires when:
//     * the pty device table is exhausted (posix_openpt fails),
//     * the per-user process cap is hit (posix_spawn → EAGAIN),
//     * the ssh binary isn't on PATH (posix_spawn → ENOENT),
//     * memory is exhausted (ENOMEM), etc.
//
//   We can't recover the errno, so we lean on the few signals that ARE
//   trustworthy and refuse to guess beyond them.
//
// WHY WE NO LONGER COUNT PTYS:
//
//   An earlier version probed pty pressure by counting /dev/ttysNNN nodes and,
//   if the count was near kern.tty.ptmx_max, declared "out of pseudo-terminals,
//   restart macOS". That count is WRONG: macOS materializes /dev/ttysNNN slave
//   nodes on demand and never removes them for the rest of the boot session, so
//   the count is a boot-session high-water mark, NOT a live in-use figure. On a
//   machine with normal uptime it routinely sits in the hundreds (and can even
//   exceed ptmx_max — we've observed 527 nodes against a 511 cap with zero ptys
//   actually open), which is impossible for an "in use" metric. macOS exposes
//   the cap (kern.tty.ptmx_max) but no current-count sysctl, so there is no
//   cheap, reliable way to measure live ptys. The old heuristic therefore
//   produced confident false positives — telling users to reboot when nothing
//   was wrong. We removed it. Genuine pty failures still surface via the
//   explicit error strings node-pty does emit (forkpty/openpty/ptmx/...).

const fs = require('fs');

// node-pty error strings that unambiguously mean "couldn't get a pty" (as
// opposed to the ambiguous "posix_spawnp failed.").
const PTY_ERROR_RE = /forkpty|openpty|out of pty|Device not configured|ptmx|pseudo-?terminal/i;

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

/**
 * Pure decision logic. Given the raw error plus already-probed system facts,
 * returns the message to show the user.
 *
 * @param {object} facts
 * @param {string} facts.raw       - raw error message from node-pty
 * @param {string|null} facts.sshPath - resolved path to the ssh binary, or null
 */
function buildSpawnDiagnosis({ raw, sshPath }) {
  const message = String(raw || '').trim() || 'unknown error';

  // 1. Errors that explicitly name the pty subsystem are genuine pty failures.
  //    node-pty surfaces these directly (forkpty/openpty/ptmx/...), so this is
  //    a reliable signal — unlike counting device nodes.
  if (PTY_ERROR_RE.test(message)) {
    return (
      `macOS could not allocate a pseudo-terminal for the ssh session. This ` +
      `usually means too many terminals or shells are open at once — quit ` +
      `unused Terminal/iTerm windows and other terminal-heavy apps, then ` +
      `retry. If every new connection keeps failing, restarting macOS clears ` +
      `the pty device table. (${message})`
    );
  }

  // 2. ssh binary missing → posix_spawn returns ENOENT. A restart never helps.
  if (!sshPath) {
    return (
      `the "ssh" command could not be found on PATH, so macOS refused to ` +
      `start it. Install OpenSSH or make sure /usr/bin is on PATH, then retry. ` +
      `(${message})`
    );
  }

  // 3. Ambiguous "posix_spawnp failed." with ssh present. The most common real
  //    cause is the per-user process cap (EAGAIN), not pty exhaustion. We have
  //    no trustworthy way to measure live ptys (see file header), so we must
  //    NOT guess "out of ptys" or tell the user to reboot here.
  return (
    `macOS could not start the ssh process. This is usually a temporary ` +
    `resource limit such as the per-user process cap — quit a few background ` +
    `apps and try again. If every new connection fails, restarting the app ` +
    `(or macOS) clears it. (${message})`
  );
}

/**
 * Probe live system state and return an accurate failure message.
 *
 * @param {Error|string} err
 * @param {object} [opts]
 * @param {string} [opts.pathEnv]  - PATH the child was/would be spawned with
 * @param {function} [opts.resolveExecutable] - injectable for tests
 */
function diagnoseSpawnFailure(err, opts = {}) {
  const raw = String(err?.message || err || '').trim() || 'unknown error';
  const {
    pathEnv = process.env.PATH,
    resolveExecutable = resolveOnPath,
  } = opts;

  let sshPath = null;
  try { sshPath = resolveExecutable('ssh', pathEnv); } catch { sshPath = null; }

  return buildSpawnDiagnosis({ raw, sshPath });
}

module.exports = {
  diagnoseSpawnFailure,
  buildSpawnDiagnosis,
  resolveOnPath,
  PTY_ERROR_RE,
};
