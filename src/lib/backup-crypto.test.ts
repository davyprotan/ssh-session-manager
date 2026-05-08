import { describe, it, expect } from 'vitest';
import { scrypt, randomBytes, createCipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import {
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from './backup-crypto';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Mint a v1 envelope (no AAD) the way pre-v0.9.17 builds did. Used to verify
// backwards compatibility on decrypt.
async function mintV1Envelope(payload: unknown, password: string): Promise<EncryptedEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptAsync(password, salt, 32, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: 'ssh-manager-backup',
    version: 1,
    encrypted: true,
    kdf: 'scrypt',
    kdf_params: { N: 1 << 17, r: 8, p: 1 },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

// scrypt with N=2^17 takes ~150ms on a modern machine, so each round-trip is real work.
// Keep the suite small.

// All test passwords are >= 12 chars to satisfy the encrypt-side floor.
const PW_A = 'correct horse battery staple';
const PW_B = 'correct horse battery STAPLE'; // same length, different content
const PW_GENERIC = 'unit-test-password-pw';

describe('backup-crypto', () => {
  it('round-trips a payload', { timeout: 30_000 }, async () => {
    const payload = { profiles: [{ name: 'prod', secret: 'hunter2' }], n: 42 };
    const env = await encryptPayload(payload, PW_A);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env.version).toBe(2);
    const out = await decryptPayload(env, PW_A);
    expect(out).toEqual(payload);
  });

  it('fails to decrypt with the wrong password', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, PW_A);
    await expect(decryptPayload(env, PW_B)).rejects.toThrow(/wrong password|corrupted/i);
  });

  it('detects ciphertext tampering via GCM auth tag', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, PW_GENERIC);
    // Flip a byte in the ciphertext.
    const buf = Buffer.from(env.ciphertext, 'base64');
    buf[0] ^= 0x01;
    const tampered: EncryptedEnvelope = { ...env, ciphertext: buf.toString('base64') };
    await expect(decryptPayload(tampered, PW_GENERIC)).rejects.toThrow();
  });

  it('detects tag tampering', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, PW_GENERIC);
    const buf = Buffer.from(env.tag, 'base64');
    buf[0] ^= 0xff;
    const tampered: EncryptedEnvelope = { ...env, tag: buf.toString('base64') };
    await expect(decryptPayload(tampered, PW_GENERIC)).rejects.toThrow();
  });

  it('detects envelope-metadata tampering via AAD (v2)', { timeout: 30_000 }, async () => {
    const env = await encryptPayload({ secret: 'x' }, PW_GENERIC);
    // Rewrite the salt field — without AAD this would silently work because
    // GCM only authenticates the ciphertext; with AAD the tag check fails.
    const newSalt = Buffer.alloc(16, 0xab).toString('base64');
    const tampered: EncryptedEnvelope = { ...env, salt: newSalt };
    await expect(decryptPayload(tampered, PW_GENERIC)).rejects.toThrow();
  });

  it('produces fresh salt and iv on every call', { timeout: 30_000 }, async () => {
    const a = await encryptPayload({ x: 1 }, PW_GENERIC);
    const b = await encryptPayload({ x: 1 }, PW_GENERIC);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    await expect(encryptPayload({ x: 1 }, 'short')).rejects.toThrow(/12 char/);
  });

  it('still decrypts a v1 envelope (no AAD) for backwards compat', { timeout: 30_000 }, async () => {
    const payload = { profiles: [{ name: 'legacy', secret: 'still-works' }] };
    const v1 = await mintV1Envelope(payload, PW_A);
    expect(v1.version).toBe(1);
    const out = await decryptPayload(v1, PW_A);
    expect(out).toEqual(payload);
  });

  it('refuses to decrypt non-envelopes', async () => {
    const fake = { format: 'something-else', encrypted: true } as unknown as EncryptedEnvelope;
    await expect(decryptPayload(fake, PW_GENERIC)).rejects.toThrow(/not an encrypted backup/i);
  });

  describe('isEncryptedEnvelope', () => {
    it('identifies a valid envelope', async () => {
      const env = await encryptPayload({ x: 1 }, PW_GENERIC);
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
