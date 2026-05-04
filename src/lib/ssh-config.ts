// Lightweight ~/.ssh/config parser. Supports Host, HostName, User, Port, IdentityFile, ProxyJump.

export interface SshConfigEntry {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

export function parseSshConfig(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = [];
  let current: SshConfigEntry | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    // Match key + value (key may have leading whitespace)
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"|"$/g, '');

    if (key === 'host') {
      // Skip wildcard-only blocks
      const hosts = value.split(/\s+/);
      if (hosts.length === 1 && !hosts[0].includes('*') && !hosts[0].includes('?')) {
        current = { host: hosts[0] };
        entries.push(current);
      } else {
        current = null; // Skip wildcard blocks
      }
    } else if (current) {
      switch (key) {
        case 'hostname': current.hostname = value; break;
        case 'user': current.user = value; break;
        case 'port': current.port = parseInt(value); break;
        case 'identityfile': current.identityFile = value.replace(/^~/, '$HOME'); break;
        case 'proxyjump': current.proxyJump = value; break;
      }
    }
  }

  return entries;
}
