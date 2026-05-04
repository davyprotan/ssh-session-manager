// Lightweight ~/.ssh/config parser. Supports Host, HostName, User, Port, IdentityFile, ProxyJump.
// Server-only (uses os.homedir for path expansion).

import os from 'os';
import path from 'path';

export interface SshConfigEntry {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

/** Expand `~` (and the literal `$HOME`) in identity-file paths to absolute paths. */
function expandHome(p: string): string {
  let s = p.trim();
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.startsWith('~/') || s === '~') s = path.join(os.homedir(), s.slice(1));
  s = s.replace(/^\$HOME(?=\/|$)/, os.homedir());
  return s;
}

export function parseSshConfig(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = [];
  let current: SshConfigEntry | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'host') {
      const hosts = value.split(/\s+/);
      if (hosts.length === 1 && !hosts[0].includes('*') && !hosts[0].includes('?')) {
        current = { host: hosts[0] };
        entries.push(current);
      } else {
        current = null;
      }
    } else if (current) {
      switch (key) {
        case 'hostname': current.hostname = value; break;
        case 'user': current.user = value; break;
        case 'port': {
          const n = parseInt(value);
          if (Number.isInteger(n) && n > 0 && n < 65536) current.port = n;
          break;
        }
        case 'identityfile': current.identityFile = expandHome(value); break;
        case 'proxyjump': current.proxyJump = value; break;
      }
    }
  }

  return entries;
}
