// Safe builder for the ssh argv array. Server-only.
// Strict validation: any field that fails returns null (caller refuses to connect).

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/; // hostnames, IPv4, IPv6 (with %scope), basic punct
const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const KEYPATH_RE = /^[a-zA-Z0-9._/~\-+ ]+$/; // no metacharacters; spaces allowed in path

export interface SshArgsInput {
  host: string;
  port: number;
  username?: string;
  keyPath?: string;
  jumpHost?: string;
  agentForwarding?: boolean;
  compression?: boolean;
  serverAliveInterval?: number;
  extraArgs?: string;
}

export interface SshArgsResult {
  ok: true;
  argv: string[];      // ['-i', '/key', '-p', '22', 'user@host']
  display: string;     // human-readable command for toast
}

export interface SshArgsError {
  ok: false;
  error: string;
}

function isValidExtraArgs(s: string): boolean {
  if (!s.trim()) return true;
  // Only `-o Key=Value` pairs separated by single spaces, repeated
  return /^(\s*-o\s+[A-Za-z0-9]+(?:=[A-Za-z0-9._\-/]*)?)+\s*$/.test(s);
}

export function buildSshArgs(input: SshArgsInput): SshArgsResult | SshArgsError {
  const host = (input.host || "").trim();
  if (!host || !HOST_RE.test(host)) return { ok: false, error: "invalid host" };

  const port = Number.isInteger(input.port) ? input.port : parseInt(String(input.port));
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { ok: false, error: "invalid port" };

  const username = (input.username || "").trim();
  if (username && !USER_RE.test(username)) return { ok: false, error: "invalid username" };

  const keyPath = (input.keyPath || "").trim();
  if (keyPath && !KEYPATH_RE.test(keyPath)) return { ok: false, error: "invalid key path" };

  const jumpHost = (input.jumpHost || "").trim();
  if (jumpHost) {
    // Allow user@host[:port]
    const m = jumpHost.match(/^(?:([a-zA-Z0-9._-]{1,64})@)?([a-zA-Z0-9._:%\-]+)(?::(\d{1,5}))?$/);
    if (!m) return { ok: false, error: "invalid jump host" };
  }

  const sai = Number.isFinite(input.serverAliveInterval) ? Number(input.serverAliveInterval) : 0;
  if (sai < 0 || sai > 86400) return { ok: false, error: "invalid keepalive" };

  const extraArgs = (input.extraArgs || "").trim();
  if (extraArgs && !isValidExtraArgs(extraArgs)) {
    return { ok: false, error: 'extra args must be "-o Key=Value" pairs' };
  }

  const argv: string[] = [];
  if (keyPath) { argv.push("-i", keyPath); }
  if (port !== 22) { argv.push("-p", String(port)); }
  if (input.agentForwarding) argv.push("-A");
  if (input.compression) argv.push("-C");
  if (sai > 0) { argv.push("-o", `ServerAliveInterval=${sai}`); }
  if (jumpHost) { argv.push("-J", jumpHost); }
  if (extraArgs) {
    // Already validated to be "-o Key=Value [-o Key=Value...]". Tokenize.
    const tokens = extraArgs.split(/\s+/).filter(Boolean);
    argv.push(...tokens);
  }
  argv.push(username ? `${username}@${host}` : host);

  // Human-readable form for toast (NOT used to spawn a shell)
  const display = `ssh ${argv.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")}`;

  return { ok: true, argv, display };
}
