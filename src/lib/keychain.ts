// Server-only. Stores SSH credentials as safeStorage-encrypted blobs in the
// `profiles.password_enc` column of the local SQLite DB.
//
// Why a credential store at all:
//   We never want to keep plaintext passwords on disk. Until v0.9.37 we used
//   keytar to delegate to the OS keychain. keytar's NAPI wrapper can throw
//   a C++ exception that bypasses every JS try/catch and abort()s the host
//   process; that took the whole app down in production (see v7 migration
//   note in db.ts).
//
// What replaces it:
//   The Electron main process runs an in-process bridge
//   (electron/keychain-server.js) exposing /encrypt and /decrypt over
//   loopback. Both endpoints call Electron's `safeStorage`, which on macOS
//   stores a single master key in the Keychain and AES-encrypts every
//   secret with it. The ciphertext is what we store in the DB.
//
// Why a bridge at all instead of calling safeStorage directly:
//   safeStorage only exists in the Electron main process. This module runs
//   inside the Next.js server child, which is a separate process.
//
// Public API is unchanged: setPassword / getPassword / deletePassword /
// isAvailable. Callers pass a profileId; we resolve that to a DB row and
// handle the cipher round-trip transparently.

import { getDb } from './db';

const KEYCHAIN_URL = (process.env.SSH_MANAGER_KEYCHAIN_URL || '').trim();
const INTERNAL_TOKEN = (process.env.SSH_MANAGER_INTERNAL_TOKEN || '').trim();
const BRIDGE_READY = !!(KEYCHAIN_URL && INTERNAL_TOKEN);

async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-internal-token', INTERNAL_TOKEN);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${KEYCHAIN_URL}${path}`, { ...init, headers });
}

async function encryptToBlob(plaintext: string): Promise<Buffer | null> {
  try {
    const res = await bridgeFetch('/encrypt', {
      method: 'POST',
      body: JSON.stringify({ plaintext }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ciphertext?: string };
    if (typeof data.ciphertext !== 'string') return null;
    return Buffer.from(data.ciphertext, 'base64');
  } catch (e) {
    console.warn('encrypt failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function decryptFromBlob(blob: Buffer): Promise<string | null> {
  try {
    const res = await bridgeFetch('/decrypt', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: blob.toString('base64') }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { plaintext?: string };
    return typeof data.plaintext === 'string' ? data.plaintext : null;
  } catch (e) {
    console.warn('decrypt failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function setPassword(profileId: number, password: string): Promise<boolean> {
  if (!BRIDGE_READY) return false;
  const blob = await encryptToBlob(password);
  if (!blob) return false;
  try {
    getDb()
      .prepare('UPDATE profiles SET password_enc = ?, uses_keychain = 1, password = NULL WHERE id = ?')
      .run(blob, profileId);
    return true;
  } catch (e) {
    console.warn('keychain DB write failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function getPassword(profileId: number): Promise<string | null> {
  if (!BRIDGE_READY) return null;
  let row: { password_enc: Buffer | null; uses_keychain: number } | undefined;
  try {
    row = getDb()
      .prepare('SELECT password_enc, uses_keychain FROM profiles WHERE id = ?')
      .get(profileId) as { password_enc: Buffer | null; uses_keychain: number } | undefined;
  } catch (e) {
    console.warn('keychain DB read failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
  if (!row) return null;
  if (row.password_enc) return decryptFromBlob(row.password_enc);

  // Legacy fall-through: the row claims uses_keychain=1 but hasn't been
  // migrated to password_enc yet. This happens for a few seconds at startup
  // before the deferred keytar→safeStorage migration completes, or for any
  // row the background pass hasn't reached. Migrate this single row inline
  // so the user's first connect "just works". The migration goes through
  // the keychain bridge's utilityProcess, so a keytar abort here is still
  // contained.
  if (row.uses_keychain) {
    const ok = await migrateLegacyKeytarEntry(profileId);
    if (!ok) return null;
    const fresh = getDb()
      .prepare('SELECT password_enc FROM profiles WHERE id = ?')
      .get(profileId) as { password_enc: Buffer | null } | undefined;
    if (fresh?.password_enc) return decryptFromBlob(fresh.password_enc);
  }
  return null;
}

export async function deletePassword(profileId: number): Promise<void> {
  // Always clear the DB column even if the bridge is unavailable — this is
  // purely a local write and shouldn't depend on Electron being up.
  try {
    getDb()
      .prepare('UPDATE profiles SET password_enc = NULL, uses_keychain = 0 WHERE id = ?')
      .run(profileId);
  } catch (e) {
    console.warn('keychain DB delete failed:', e instanceof Error ? e.message : String(e));
  }
}

export async function isAvailable(): Promise<boolean> {
  if (!BRIDGE_READY) return false;
  try {
    const res = await bridgeFetch('/available');
    if (!res.ok) return false;
    const data = (await res.json()) as { available?: boolean };
    return !!data.available;
  } catch {
    return false;
  }
}

// ─── Migration helpers (used by db.ts post-migration runner) ────────────

/**
 * Pull a profile's password out of the legacy keytar store, re-encrypt it
 * with safeStorage, and write it into `password_enc`. Returns true if a
 * legacy entry existed and was successfully migrated.
 *
 * The bridge handles both the keytar read (in an isolated utilityProcess so
 * a keytar abort can't take down main) and the safeStorage encryption, then
 * returns the ciphertext to us. We only deal with the DB write here.
 */
export async function migrateLegacyKeytarEntry(profileId: number): Promise<boolean> {
  if (!BRIDGE_READY) return false;
  try {
    const res = await bridgeFetch('/legacy/extract', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ciphertext?: string | null };
    if (typeof data.ciphertext !== 'string') return false;
    const blob = Buffer.from(data.ciphertext, 'base64');
    getDb()
      .prepare('UPDATE profiles SET password_enc = ?, uses_keychain = 1 WHERE id = ?')
      .run(blob, profileId);
    // Best-effort delete of the legacy keytar entry. Failure is fine — it
    // just leaves a redundant entry in the OS keychain. The next migration
    // pass skips this profile because password_enc is now non-null.
    try {
      await bridgeFetch('/legacy/forget', {
        method: 'POST',
        body: JSON.stringify({ profileId }),
      });
    } catch { /* ignore */ }
    return true;
  } catch (e) {
    console.warn(`legacy keytar migration for profile ${profileId} failed:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}
