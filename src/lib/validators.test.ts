import { describe, it, expect } from 'vitest';
import { parseProfile, parseSession, parseFolder, ValidationError } from './validators';

const BASE_PROFILE = {
  name: 'prod',
  username: 'deploy',
  auth_type: 'key',
  port: 22,
};

describe('parseProfile', () => {
  it('parses a minimal valid profile and applies defaults', () => {
    const out = parseProfile({ ...BASE_PROFILE });
    expect(out.name).toBe('prod');
    expect(out.username).toBe('deploy');
    expect(out.auth_type).toBe('key');
    expect(out.port).toBe(22);
    expect(out.color).toBe('cyan');
    expect(out.is_default).toBe(0);
    expect(out.password).toBeNull();
    expect(out.key_path).toBeNull();
    expect(out.extra_args).toBeNull();
  });

  it('rejects non-object body', () => {
    expect(() => parseProfile(null)).toThrow(ValidationError);
    expect(() => parseProfile('hello')).toThrow(ValidationError);
    expect(() => parseProfile(42)).toThrow(ValidationError);
  });

  it('rejects invalid auth_type', () => {
    expect(() => parseProfile({ ...BASE_PROFILE, auth_type: 'rootkit' })).toThrow(/auth_type/);
  });

  it('rejects invalid color', () => {
    expect(() => parseProfile({ ...BASE_PROFILE, color: 'rainbow' })).toThrow(/color/);
  });

  it('rejects username with shell metacharacters', () => {
    expect(() => parseProfile({ ...BASE_PROFILE, username: 'foo;rm -rf /' })).toThrow(/username/);
    expect(() => parseProfile({ ...BASE_PROFILE, username: '$(whoami)' })).toThrow(/username/);
    expect(() => parseProfile({ ...BASE_PROFILE, username: 'bad space' })).toThrow(/username/);
  });

  it('rejects port out of range', () => {
    expect(() => parseProfile({ ...BASE_PROFILE, port: 0 })).toThrow(/range/);
    expect(() => parseProfile({ ...BASE_PROFILE, port: 70000 })).toThrow(/range/);
    expect(() => parseProfile({ ...BASE_PROFILE, port: 'pwned' })).toThrow();
  });

  it('rejects key_path containing shell metacharacters', () => {
    for (const bad of [
      '/keys/id_rsa;reboot',
      '/keys/id_rsa|cat',
      '/keys/$(whoami)',
      '/keys/`id`',
      '/keys/"escape"',
      '/keys/id_rsa\nrm',
    ]) {
      expect(() => parseProfile({ ...BASE_PROFILE, key_path: bad })).toThrow(/key_path/);
    }
  });

  it('accepts a normal key path', () => {
    const out = parseProfile({ ...BASE_PROFILE, key_path: '/Users/me/.ssh/id_ed25519' });
    expect(out.key_path).toBe('/Users/me/.ssh/id_ed25519');
  });

  it('only accepts -o options in extra_args', () => {
    const ok = parseProfile({ ...BASE_PROFILE, extra_args: '-o ServerAliveInterval=30 -o ConnectTimeout=10' });
    expect(ok.extra_args).toBe('-o ServerAliveInterval=30 -o ConnectTimeout=10');

    // Valueless flags like `-o VisualHostKey` are valid SSH and should be accepted.
    const valueless = parseProfile({ ...BASE_PROFILE, extra_args: '-o VisualHostKey' });
    expect(valueless.extra_args).toBe('-o VisualHostKey');

    for (const bad of [
      '-X',
      '-L 8080:localhost:80',
      '-o ServerAliveInterval=30; rm -rf /',
      'ServerAliveInterval=30',
      '-o Key=$(whoami)',
    ]) {
      expect(() => parseProfile({ ...BASE_PROFILE, extra_args: bad })).toThrow(/extra_args/);
    }
  });

  it('coerces booleans to 0 / 1', () => {
    const out = parseProfile({ ...BASE_PROFILE, is_default: true, agent_forwarding: 1, compression: 'yes' });
    expect(out.is_default).toBe(1);
    expect(out.agent_forwarding).toBe(1);
    expect(out.compression).toBe(1);
  });

  it('caps oversize strings', () => {
    const huge = 'x'.repeat(5000);
    expect(() => parseProfile({ ...BASE_PROFILE, name: huge })).toThrow();
  });
});

describe('parseSession', () => {
  it('parses a valid session', () => {
    const out = parseSession({ name: 'prod-1', host: '10.0.0.1', port: 22, tags: ['db', 'prod'] });
    expect(out.host).toBe('10.0.0.1');
    expect(out.tags).toEqual(['db', 'prod']);
    expect(out.profile_id).toBeNull();
    expect(out.notes).toBeNull();
  });

  it('rejects host with shell metacharacters', () => {
    for (const bad of ['host;evil', 'host$(whoami)', 'host`id`', 'host|cat', 'host space']) {
      expect(() => parseSession({ name: 'x', host: bad })).toThrow(/host/);
    }
  });

  it('accepts ipv6 hosts (with %, : characters)', () => {
    const out = parseSession({ name: 'v6', host: 'fe80::1%en0' });
    expect(out.host).toBe('fe80::1%en0');
  });

  it('parses jump_host with optional user@ and :port', () => {
    expect(parseSession({ name: 'a', host: 'h', jump_host: 'bastion.example.com' }).jump_host).toBe('bastion.example.com');
    expect(parseSession({ name: 'a', host: 'h', jump_host: 'me@bastion.example.com:2222' }).jump_host).toBe('me@bastion.example.com:2222');
  });

  it('rejects malformed jump_host', () => {
    expect(() => parseSession({ name: 'a', host: 'h', jump_host: 'me@host;rm -rf' })).toThrow(/jump_host/);
  });

  it('rejects too many tags', () => {
    const tags = Array.from({ length: 51 }, (_, i) => `t${i}`);
    expect(() => parseSession({ name: 'x', host: 'h', tags })).toThrow();
  });

  it('rejects invalid profile_id', () => {
    expect(() => parseSession({ name: 'x', host: 'h', profile_id: -1 })).toThrow(/id/);
    expect(() => parseSession({ name: 'x', host: 'h', profile_id: 1.5 })).toThrow(/id/);
  });
});

describe('parseFolder', () => {
  it('parses a valid folder', () => {
    expect(parseFolder({ name: 'prod', color: 'green' })).toEqual({ name: 'prod', color: 'green' });
  });

  it('defaults color', () => {
    expect(parseFolder({ name: 'prod' })).toEqual({ name: 'prod', color: 'cyan' });
  });

  it('rejects invalid color', () => {
    expect(() => parseFolder({ name: 'p', color: 'taupe' })).toThrow(/color/);
  });
});
