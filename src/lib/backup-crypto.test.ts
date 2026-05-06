import { describe, it, expect } from 'vitest';
import {
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from './backup-crypto';

// scrypt with N=2^17 takes ~150ms on a modern machine, so each round-trip is real work.
// Keep the suite small.

describe('backup-crypto', () => {
  it('round-trips a payload', { timeout: 30_000 }, async () => {
    const payload = { profiles: [{ name: 'prod', secret: 'hunter2' }], n: 42 };
    const env = await encryptPayload(payload, 'correct horse battery staple');
    expect(isEncryptedEnvelope(env)).toBe(true);
    const out = await decryptPayload(env, 'correct horse battery staple');
    expect(out).toEqual(payload);
  });

  it('fails to decrypt with the wrong password', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, 'pw1');
    await expect(decryptPayload(env, 'pw2')).rejects.toThrow(/wrong password|corrupted/i);
  });

  it('detects ciphertext tampering via GCM auth tag', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, 'pw');
    // Flip a byte in the ciphertext.
    const buf = Buffer.from(env.ciphertext, 'base64');
    buf[0] ^= 0x01;
    const tampered: EncryptedEnvelope = { ...env, ciphertext: buf.toString('base64') };
    await expect(decryptPayload(tampered, 'pw')).rejects.toThrow();
  });

  it('detects tag tampering', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, 'pw');
    const buf = Buffer.from(env.tag, 'base64');
    buf[0] ^= 0xff;
    const tampered: EncryptedEnvelope = { ...env, tag: buf.toString('base64') };
    await expect(decryptPayload(tampered, 'pw')).rejects.toThrow();
  });

  it('produces fresh salt and iv on every call', { timeout: 30_000 }, async () => {
    const a = await encryptPayload({ x: 1 }, 'pw');
    const b = await encryptPayload({ x: 1 }, 'pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses to decrypt non-envelopes', async () => {
    const fake = { format: 'something-else', encrypted: true } as unknown as EncryptedEnvelope;
    await expect(decryptPayload(fake, 'pw')).rejects.toThrow(/not an encrypted backup/i);
  });

  describe('isEncryptedEnvelope', () => {
    it('identifies a valid envelope', async () => {
      const env = await encryptPayload({ x: 1 }, 'pw');
      expect(isEncryptedEnvelope(env)).toBe(true);
    });

    it('rejects nulls and non-objects', () => {
      expect(isEncryptedEnvelope(null)).toBe(false);
      expect(isEncryptedEnvelope('hi')).toBe(false);
      expect(isEncryptedEnvelope(42)).toBe(false);
      expect(isEncryptedEnvelope({})).toBe(false);
    });

    it('rejects payloads missing required fields', () => {
      expect(
        isEncryptedEnvelope({ format: 'ssh-manager-backup', encrypted: true, salt: 'a', iv: 'b', ciphertext: 'c' }),
      ).toBe(false);
    });

    it('rejects plaintext (encrypted: false) backups', () => {
      expect(
        isEncryptedEnvelope({
          format: 'ssh-manager-backup',
          encrypted: false,
          salt: 'a',
          iv: 'b',
          ciphertext: 'c',
          tag: 'd',
        }),
      ).toBe(false);
    });
  });
});
