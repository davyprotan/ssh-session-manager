// Safe builder for the ssh argv array. Server-only.
// Strict validation: any field that fails returns null (caller refuses to connect).

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/; // hostnames, IPv4, IPv6 (with %scope), basic punct
const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const KEYPATH_RE = /^[a-zA-Z0-9._/~\-+ ]+$/; // no metacharacters; spaces allowed in path

// Allowlist of SSH `-o` keys that we permit in the extra_args field.
//
// The previous regex accepted any `[A-Za-z0-9]+` key, which let users smuggle
// `-o ProxyCommand=…`, `-o LocalCommand=…`, `-o IdentityAgent=…`, etc. — all
// options that route user-controlled values through a shell. Even though the
// app stores its own profiles, a future renderer-side compromise (XSS, IPC
// confusion) could plant such a value in extra_args and get arbitrary local
// execution the next time the user clicked Connect.
//
// This allowlist is deliberately conservative: only options that tune
// connection / auth / algorithm behaviour, none that execute commands, change
// identity sources, or open additional channels. If you need something not on
// this list, prefer adding a dedicated profile field with its own validation.
const SAFE_EXTRA_ARG_KEYS: ReadonlySet<string> = new Set([
  // Connection tuning
  "connecttimeout", "connectionattempts", "tcpkeepalive",
  "serveraliveinterval", "serveralivecountmax",
  // Auth tuning (NOT IdentityAgent, NOT IdentityFile — those go through dedicated fields)
  "batchmode", "identitiesonly", "numberofpasswordprompts",
  "preferredauthentications", "passwordauthentication", "pubkeyauthentication",
  "kbdinteractiveauthentication", "gssapiauthentication",
  // Host-key tuning
  "stricthostkeychecking", "userknownhostsfile", "hashknownhosts",
  "checkhostip", "hostkeyalias", "fingerprinthash", "verifyhostkeydns",
  // Algorithm tuning
  "kexalgorithms", "hostkeyalgorithms", "ciphers", "macs",
  "pubkeyacceptedalgorithms", "hostbasedacceptedalgorithms", "casignaturealgorithms",
  // Logging / display
  "loglevel", "visualhostkey",
  // Agent (NOT IdentityAgent — that lets you redirect to an attacker socket)
  "addkeystoagent",
  // X11
  "forwardx11", "forwardx11trusted", "forwardx11timeout",
  // Misc safe options
  "requesttty", "nohostauthenticationforlocalhost",
]);

// Per-pair value charset: alphanumerics + the punctuation seen in real SSH
// option values (paths, comma-separated algorithm lists, durations). No
// spaces, `$`, `{}`, `<>`, backticks, or quotes — all already rejected by the
// upstream regex but reasserted here for clarity.
const EXTRA_ARG_VALUE_RE = /^[A-Za-z0-9._\-/+,@:]*$/;

export interface ExtraArgsParseResult {
  ok: boolean;
  /** Tokenized argv slice, e.g. ['-o','ConnectTimeout=10','-o','BatchMode=yes']. */
  tokens?: string[];
  /** Reason a value was rejected, suitable for surfacing in a 400 response. */
  error?: string;
}

/**
 * Parse and validate an extra_args string. Accepts only `-o Key[=Value]` pairs
 * where `Key` is in `SAFE_EXTRA_ARG_KEYS`. Returns `{ok:true, tokens}` on
 * success or `{ok:false, error}` describing the first invalid pair.
 */
export function parseExtraArgs(input: string): ExtraArgsParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, tokens: [] };

  // Tokenize on whitespace. Each `-o` consumes the next token.
  const raw = trimmed.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "-o") {
      return { ok: false, error: 'extra_args must be "-o Key[=Value]" pairs' };
    }
    const pair = raw[i + 1];
    if (!pair) return { ok: false, error: '"-o" requires a Key=Value' };
    i++;

    const eq = pair.indexOf("=");
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : "";

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
      return { ok: false, error: `invalid -o key: ${key}` };
    }
    if (!SAFE_EXTRA_ARG_KEYS.has(key.toLowerCase())) {
      return { ok: false, error: `-o ${key} is not allowed (see safe-keys allowlist)` };
    }
    if (!EXTRA_ARG_VALUE_RE.test(value)) {
      return { ok: false, error: `invalid value for -o ${key}` };
    }
    tokens.push("-o", pair);
  }

  return { ok: true, tokens };
}

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
  /** When true, add the well-known deprecated KEX/host-key/cipher/MAC
   *  algorithms that old network gear (Arista, ADVA, Cisco IOS, etc.) still
   *  requires. OpenSSH 9+ disables these by default. */
  compatLegacy?: boolean;
  /** Profile auth type. When 'password', we disable client-side public-key
   *  authentication so `ssh` doesn't offer ~/.ssh/id_* to the server. That
   *  is both faster (no wasted offer rounds), safer (no key fingerprint
   *  leaked to random gear), and works around RomSShell / other embedded
   *  SSH stacks that send a malformed SSH_MSG_USERAUTH_PK_OK reply which
   *  OpenSSH 10 rejects as "invalid format". */
  authType?: 'key' | 'key_with_passphrase' | 'password' | '';
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
  const parsedExtra = parseExtraArgs(extraArgs);
  if (!parsedExtra.ok) {
    return { ok: false, error: parsedExtra.error || "invalid extra_args" };
  }

  // Defaults for connection-loss detection. Without these, OpenSSH won't
  // probe the link and the local `ssh` process can sit on a dead TCP socket
  // for hours, leaving the UI stuck on "connected" after the network drops.
  // With 30s × 3 missed probes, a broken link surfaces as a PTY exit within
  // ~90s and the renderer transitions to "exited" / auto-reconnect kicks in.
  //
  // Precedence:
  //   1. Explicit `serverAliveInterval` field on the profile wins outright.
  //   2. Otherwise, defer to whatever extra_args already specifies.
  //   3. Otherwise, inject our defaults.
  // ServerAliveCountMax has no dedicated field, so only steps 2/3 apply.
  const extraHasInterval = parsedExtra.tokens?.some(
    (t, i) => i > 0 && parsedExtra.tokens![i - 1] === "-o" && /^serveraliveinterval(=|$)/i.test(t)
  ) ?? false;
  const extraHasCountMax = parsedExtra.tokens?.some(
    (t, i) => i > 0 && parsedExtra.tokens![i - 1] === "-o" && /^serveralivecountmax(=|$)/i.test(t)
  ) ?? false;
  const DEFAULT_SERVER_ALIVE_INTERVAL = 30;
  const DEFAULT_SERVER_ALIVE_COUNT_MAX = 3;

  const argv: string[] = [];
  if (keyPath) { argv.push("-i", keyPath); }
  if (port !== 22) { argv.push("-p", String(port)); }
  if (input.agentForwarding) argv.push("-A");
  if (input.compression) argv.push("-C");
  if (sai > 0) {
    argv.push("-o", `ServerAliveInterval=${sai}`);
  } else if (!extraHasInterval) {
    argv.push("-o", `ServerAliveInterval=${DEFAULT_SERVER_ALIVE_INTERVAL}`);
  }
  if (!extraHasCountMax) {
    argv.push("-o", `ServerAliveCountMax=${DEFAULT_SERVER_ALIVE_COUNT_MAX}`);
  }
  if (jumpHost) { argv.push("-J", jumpHost); }
  // Legacy compatibility: add the deprecated algorithms that old network
  // gear still negotiates. Use `+algo` so they're appended to the modern
  // defaults — modern hosts prefer modern algorithms, old hosts pick these.
  //
  // Notes on what's NOT here:
  //  - `ssh-dss` was REMOVED entirely from OpenSSH 9.8+ (no longer parses
  //    even with `+`). Including it here breaks the connection on modern
  //    macOS (`Bad key types '+ssh-rsa,ssh-dss'`).
  //  - 3des-cbc and hmac-md5 are still supported (just disabled-by-default)
  //    so they stay.
  // If you're hitting kit that ONLY supports DSA host keys, you'll need
  // to install an older OpenSSH (e.g. via Homebrew) — modern OpenSSH
  // can't talk to it at all.
  if (input.compatLegacy) {
    argv.push("-o", "KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha1");
    argv.push("-o", "HostKeyAlgorithms=+ssh-rsa");
    argv.push("-o", "PubkeyAcceptedAlgorithms=+ssh-rsa");
    argv.push("-o", "Ciphers=+aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc");
    argv.push("-o", "MACs=+hmac-sha1,hmac-sha2-256,hmac-md5");
  }
  // For password-auth profiles, suppress client-side public-key auth so
  // `ssh` doesn't offer keys from ~/.ssh that the user never asked us to
  // send. Without this, OpenSSH still tries every default identity before
  // falling back to password — which trips RomSShell-derived embedded SSH
  // stacks (ADVA / Coriant / Adtran / older Arista) that send a malformed
  // SSH_MSG_USERAUTH_PK_OK reply, making OpenSSH 10 abort with
  // `ssh_dispatch_run_fatal: invalid format` before we ever get the chance
  // to type the password. If the user explicitly overrides either option
  // in extra_args, defer to that.
  if (input.authType === "password") {
    const extraHasPubkeyAuth = parsedExtra.tokens?.some(
      (t, i) => i > 0 && parsedExtra.tokens![i - 1] === "-o" && /^pubkeyauthentication(=|$)/i.test(t)
    ) ?? false;
    const extraHasIdentitiesOnly = parsedExtra.tokens?.some(
      (t, i) => i > 0 && parsedExtra.tokens![i - 1] === "-o" && /^identitiesonly(=|$)/i.test(t)
    ) ?? false;
    if (!extraHasPubkeyAuth) argv.push("-o", "PubkeyAuthentication=no");
    if (!extraHasIdentitiesOnly) argv.push("-o", "IdentitiesOnly=yes");
  }
  if (parsedExtra.tokens && parsedExtra.tokens.length > 0) {
    argv.push(...parsedExtra.tokens);
  }
  argv.push(username ? `${username}@${host}` : host);

  // Human-readable form for toast (NOT used to spawn a shell)
  const display = `ssh ${argv.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")}`;

  return { ok: true, argv, display };
}
