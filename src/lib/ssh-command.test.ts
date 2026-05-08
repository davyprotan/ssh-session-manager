import { describe, it, expect } from 'vitest';
import { buildSshArgs, parseExtraArgs } from './ssh-command';

describe('parseExtraArgs', () => {
  it('accepts empty input', () => {
    const r = parseExtraArgs('');
    expect(r.ok).toBe(true);
    expect(r.tokens).toEqual([]);
  });

  it('accepts allowlisted -o keys with values', () => {
    const r = parseExtraArgs('-o ConnectTimeout=10 -o ServerAliveInterval=30');
    expect(r.ok).toBe(true);
    expect(r.tokens).toEqual(['-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30']);
  });

  it('accepts valueless -o flags like VisualHostKey', () => {
    const r = parseExtraArgs('-o VisualHostKey');
    expect(r.ok).toBe(true);
    expect(r.tokens).toEqual(['-o', 'VisualHostKey']);
  });

  it('accepts algorithm lists with + , @ : characters', () => {
    const r = parseExtraArgs('-o Ciphers=+chacha20-poly1305@openssh.com,aes256-gcm@openssh.com');
    expect(r.ok).toBe(true);
  });

  it('is case-insensitive on the key', () => {
    expect(parseExtraArgs('-o connecttimeout=5').ok).toBe(true);
    expect(parseExtraArgs('-o CONNECTTIMEOUT=5').ok).toBe(true);
  });

  it('rejects keys outside the allowlist', () => {
    for (const dangerous of [
      '-o ProxyCommand=/bin/sh',
      '-o LocalCommand=/tmp/x',
      '-o PermitLocalCommand=yes',
      '-o IdentityAgent=/tmp/sock',
      '-o IdentityFile=/etc/passwd',
      '-o RemoteCommand=cat',
      '-o RemoteForward=8080',
      '-o LocalForward=8080',
      '-o DynamicForward=1080',
      '-o ControlMaster=auto',
      '-o ControlPath=/tmp/x',
      '-o ControlPersist=10m',
      '-o KnownHostsCommand=/tmp/x',
      '-o Match=user',
      '-o Include=/tmp/x',
      '-o SendEnv=FOO',
      '-o SetEnv=FOO=bar',
    ]) {
      const r = parseExtraArgs(dangerous);
      expect(r.ok, `expected reject: ${dangerous}`).toBe(false);
      expect(r.error).toMatch(/not allowed/);
    }
  });

  it('rejects non -o tokens', () => {
    expect(parseExtraArgs('-X').ok).toBe(false);
    expect(parseExtraArgs('-L 8080:localhost:80').ok).toBe(false);
    expect(parseExtraArgs('ConnectTimeout=10').ok).toBe(false);
  });

  it('rejects values with shell metacharacters', () => {
    for (const bad of [
      '-o ConnectTimeout=$(whoami)',
      '-o Ciphers=`whoami`',
      '-o Ciphers=foo|bar',
      '-o Ciphers=foo;bar',
      '-o ConnectTimeout=10 ; rm -rf /', // ';' lands as bare arg, not -o
    ]) {
      const r = parseExtraArgs(bad);
      expect(r.ok, `expected reject: ${bad}`).toBe(false);
    }
  });

  it('rejects bare -o with no key', () => {
    expect(parseExtraArgs('-o').ok).toBe(false);
  });
});

describe('buildSshArgs', () => {
  it('builds a minimal argv', () => {
    const r = buildSshArgs({ host: '10.0.0.1', port: 22 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.argv).toEqual(['10.0.0.1']);
  });

  it('refuses host with shell metacharacters', () => {
    const r = buildSshArgs({ host: 'evil; rm -rf /', port: 22 });
    expect(r.ok).toBe(false);
  });

  it('rejects ProxyCommand smuggled through extra_args', () => {
    const r = buildSshArgs({
      host: '10.0.0.1',
      port: 22,
      extraArgs: '-o ProxyCommand=/bin/sh',
    });
    expect(r.ok).toBe(false);
  });

  it('passes through allowlisted extra_args as separate argv tokens', () => {
    const r = buildSshArgs({
      host: '10.0.0.1',
      port: 22,
      extraArgs: '-o ConnectTimeout=5 -o BatchMode=yes',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Each -o and its value land as independent argv elements (no shell)
    expect(r.argv).toContain('-o');
    expect(r.argv).toContain('ConnectTimeout=5');
    expect(r.argv).toContain('BatchMode=yes');
  });

  it('still adds the legacy compat algos when compatLegacy is set', () => {
    const r = buildSshArgs({ host: '10.0.0.1', port: 22, compatLegacy: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.argv.join(' ')).toContain('KexAlgorithms=+');
    expect(r.argv.join(' ')).toContain('HostKeyAlgorithms=+ssh-rsa');
  });
});
