// Parse what a user types into the host launcher: `host`, `host:port`,
// `user@host`, `user@host:port`, `[v6]:port` or a bare IPv6 address.
// Client-safe and pure. The username is only a hint for picking a profile —
// ssh always runs with the chosen profile's username.

export interface ParsedHostInput {
  host: string;
  port?: number;
  user?: string;
}

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/; // mirrors validators.ts / ssh-command.ts

export function parseHostInput(raw: string): ParsedHostInput | null {
  let s = raw.trim();
  if (!s) return null;
  // Tolerate a pasted `ssh ` prefix or `ssh://` scheme.
  s = s.replace(/^ssh\s+/i, "").replace(/^ssh:\/\//i, "").replace(/\/+$/, "");

  let user: string | undefined;
  const at = s.lastIndexOf("@");
  if (at !== -1) {
    user = s.slice(0, at) || undefined;
    s = s.slice(at + 1);
  }

  let host = s;
  let portStr: string | undefined;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  if (bracketed) {
    host = bracketed[1];
    portStr = bracketed[2];
  } else if ((s.match(/:/g) || []).length === 1) {
    // Exactly one colon → host:port. More than one → bare IPv6, no port.
    const i = s.indexOf(":");
    host = s.slice(0, i);
    portStr = s.slice(i + 1);
    if (!/^\d+$/.test(portStr)) return null;
  }

  if (!host || !HOST_RE.test(host)) return null;
  if (user !== undefined && !/^[a-zA-Z0-9._\-]+$/.test(user)) return null;

  let port: number | undefined;
  if (portStr !== undefined && portStr !== "") {
    port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return { host, port, user };
}
