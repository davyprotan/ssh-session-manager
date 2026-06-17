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
//   The old message blamed pty exhaustion every time and told the user to
//   restart macOS — useless (and alarming) when the real cause is a missing
//   binary or a transient process-cap blip. Here we probe live system state
//   at failure time and tailor the message so "restart macOS" is only ever
//   suggested when the ptys really are (near) exhausted.
//
//   The decision logic (buildSpawnDiagnosis) is pure and injectable so it can
//   be unit-tested without touching the real filesystem or sysctl.

const fs = require('fs');
const { execFileSync } = require('child_process');

// macOS default for kern.tty.ptmx_max. Used only if sysctl can't be read.
const DEFAULT_PTMX_MAX = 511;

// node-pty error strings that unambiguously mean "couldn't get a pty" (as
// opposed to the ambiguous "posix_spawnp failed.").
const PTY_ERROR_RE = /forkpty|openpty|out of pty|Device not configured|ptmx|pseudo-?terminal/i;

let _cachedPtyMax; // read once; the limit effectively never changes at runtime.

function readPtyMax() {
  if (_cachedPtyMax !== undefined) return _cachedPtyMax;
  try {
    const out = execFileSync('sysctl', ['-n', 'kern.tty.ptmx_max'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const n = parseInt(out.trim(), 10);
    _cachedPtyMax = Number.isFinite(n) && n > 0 ? n : DEFAULT_PTMX_MAX;
  } catch {
    _cachedPtyMax = DEFAULT_PTMX_MAX;
  }
  return _cachedPtyMax;
}

// Count allocated pty slave nodes. macOS materializes /dev/ttysNNN as slaves
// are opened, so this is a good (if approximate) proxy for pty pressure — and
// crucially it needs NO subprocess, so it still works when we're at the
// process cap. Returns NaN if /dev can't be read.
function countAllocatedPtys() {
  try {
    let n = 0;
    for (const name of fs.readdirSync('/dev')) {
      if (/^ttys[0-9a-f]+$/i.test(name)) n++;
    }
    return n;
  } catch {
    return NaN;
  }
}

function readPtyUsage() {
  return { count: countAllocatedPtys(), max: readPtyMax() };
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

function ptyUsageSuffix(count, max) {
  return Number.isFinite(count) && Number.isFinite(max) && max > 0
    ? ` (${count}/${max} in use)`
    : '';
}

function ptyExhaustedMessage(count, max, raw) {
  return (
    `macOS is out of pseudo-terminals${ptyUsageSuffix(count, max)}. ` +
    `Each open SSH window or shell holds one — quit unused Terminal/iTerm ` +
    `windows and other terminal-heavy apps, then retry. If it persists, ` +
    `restart macOS to reset the pty device table. (${raw})`
  );
}

/**
 * Pure decision logic. Given the raw error plus already-probed system facts,
 * returns the message to show the user.
 *
 * @param {object} facts
 * @param {string} facts.raw       - raw error message from node-pty
 * @param {string|null} facts.sshPath - resolved path to the ssh binary, or null
 * @param {number} facts.ptyCount  - allocated pty count (NaN if unknown)
 * @param {number} facts.ptyMax    - pty limit (NaN if unknown)
 */
function buildSpawnDiagnosis({ raw, sshPath, ptyCount, ptyMax }) {
  const message = String(raw || '').trim() || 'unknown error';
  const known = Number.isFinite(ptyCount) && Number.isFinite(ptyMax) && ptyMax > 0;
  // "Near exhaustion" with a margin: by the time the user reads this a pty may
  // have freed, and node-pty allocates several fds per spawn.
  const ptyNearMax = known && ptyCount >= Math.max(ptyMax - 16, Math.floor(ptyMax * 0.9));

  // 1. Errors that explicitly name the pty subsystem are genuine pty failures
  //    regardless of headroom (a race can free a slot between failure and probe).
  if (PTY_ERROR_RE.test(message)) {
    return ptyExhaustedMessage(ptyCount, ptyMax, message);
  }

  // 2. ssh binary missing → posix_spawn returns ENOENT. A restart never helps.
  if (!sshPath) {
    return (
      `the "ssh" command could not be found on PATH, so macOS refused to ` +
      `start it. Install OpenSSH or make sure /usr/bin is on PATH, then retry. ` +
      `(${message})`
    );
  }

  // 3. Genuine pty exhaustion behind the ambiguous "posix_spawnp failed."
  if (ptyNearMax) {
    return ptyExhaustedMessage(ptyCount, ptyMax, message);
  }

  // 4. Spawn failed but ptys have headroom → almost always a transient
  //    resource limit (the per-user process cap). Do NOT tell them to reboot.
  const headroom = known
    ? ` (${ptyCount}/${ptyMax} ptys in use, so this is not pty exhaustion)`
    : '';
  return (
    `macOS could not start the ssh process${headroom}. This is usually a ` +
    `temporary resource limit such as the per-user process cap, not something ` +
    `a restart fixes — quit a few background apps and try again. (${message})`
  );
}

/**
 * Probe live system state and return an accurate failure message.
 *
 * @param {Error|string} err
 * @param {object} [opts]
 * @param {string} [opts.pathEnv]  - PATH the child was/would be spawned with
 * @param {function} [opts.resolveExecutable] - injectable for tests
 * @param {function} [opts.getPtyUsage]       - injectable for tests
 */
function diagnoseSpawnFailure(err, opts = {}) {
  const raw = String(err?.message || err || '').trim() || 'unknown error';
  const {
    pathEnv = process.env.PATH,
    resolveExecutable = resolveOnPath,
    getPtyUsage = readPtyUsage,
  } = opts;

  let usage;
  try { usage = getPtyUsage(); } catch { usage = { count: NaN, max: NaN }; }

  let sshPath = null;
  try { sshPath = resolveExecutable('ssh', pathEnv); } catch { sshPath = null; }

  return buildSpawnDiagnosis({
    raw,
    sshPath,
    ptyCount: usage?.count,
    ptyMax: usage?.max,
  });
}

module.exports = {
  diagnoseSpawnFailure,
  buildSpawnDiagnosis,
  resolveOnPath,
  readPtyUsage,
  PTY_ERROR_RE,
  DEFAULT_PTMX_MAX,
};
