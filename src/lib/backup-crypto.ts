// Server-only. AES-256-GCM with scrypt KDF.
// Format mirrors what password managers (Bitwarden, 1Password) use:
// fixed envelope JSON with kdf params, salt, iv, ciphertext, auth tag.

import { scrypt, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// OWASP 2023 recommended scrypt params for password storage
const KDF_PARAMS = { N: 1 << 17, r: 8, p: 1 } as const; // ~128 MB memory, ~150ms on a M-series Mac
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard

export interface EncryptedEnvelope {
  format: "ssh-manager-backup";
  version: 1;
  encrypted: true;
  kdf: "scrypt";
  kdf_params: { N: number; r: number; p: number };
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
  tag: string;        // base64
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LEN, { ...KDF_PARAMS, maxmem: 256 * 1024 * 1024 });
}

export async function encryptPayload(payload: unknown, password: string): Promise<EncryptedEnvelope> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: "ssh-manager-backup",
    version: 1,
    encrypted: true,
    kdf: "scrypt",
    kdf_params: { ...KDF_PARAMS },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export async function decryptPayload(envelope: EncryptedEnvelope, password: string): Promise<unknown> {
  if (envelope.format !== "ssh-manager-backup" || !envelope.encrypted) {
    throw new Error("not an encrypted backup");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Wrong password or corrupted backup");
  }
}

export function isEncryptedEnvelope(o: unknown): o is EncryptedEnvelope {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return r.format === "ssh-manager-backup" && r.encrypted === true && typeof r.salt === "string" && typeof r.iv === "string" && typeof r.ciphertext === "string" && typeof r.tag === "string";
}
