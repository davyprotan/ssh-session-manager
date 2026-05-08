// Server-only. Talks to the OS keychain (macOS Keychain, Windows Credential
// Vault, libsecret on Linux).
//
// Two paths:
//
//   1. **Delegated mode** (Electron-launched, the common case in production):
//      `SSH_MANAGER_KEYCHAIN_URL` + `SSH_MANAGER_INTERNAL_TOKEN` are set by the
//      Electron main process at boot. We delegate via HTTP to a tiny server
//      hosted INSIDE main (`electron/keychain-server.js`). macOS attributes
//      the keychain access dialog to "SSH Manager" (the bundle), not
//      "next-server" (the Node `process.title` inside the Next child).
//
//   2. **Direct mode** (`npm run dev` without Electron, or build steps):
//      no env vars set, we load `keytar` directly from this process. Same
//      behaviour as before D was introduced. Useful for development.
//
// Both modes expose the same async API: setPassword / getPassword /
// deletePassword / isAvailable.
const SERVICE_NAME = 'SSH Manager';

interface KeytarModule {
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

const KEYCHAIN_URL = (process.env.SSH_MANAGER_KEYCHAIN_URL || '').trim();
const INTERNAL_TOKEN = (process.env.SSH_MANAGER_INTERNAL_TOKEN || '').trim();
const DELEGATED = !!(KEYCHAIN_URL && INTERNAL_TOKEN);

// ─── Delegated-mode helpers ─────────────────────────────────────────────

async function delegatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-internal-token', INTERNAL_TOKEN);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${KEYCHAIN_URL}${path}`, { ...init, headers });
}

async function dSetPassword(profileId: number, password: string): Promise<boolean> {
  try {
    const res = await delegatedFetch(`/keychain/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch (e) {
    console.warn('keychain delegate set failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function dGetPassword(profileId: number): Promise<string | null> {
  try {
    const res = await delegatedFetch(`/keychain/${encodeURIComponent(profileId)}`);
    if (!res.ok) return null;
    const data = await res.json() as { password?: string | null };
    return typeof data.password === 'string' ? data.password : null;
  } catch (e) {
    console.warn('keychain delegate get failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function dDeletePassword(profileId: number): Promise<void> {
  try {
    await delegatedFetch(`/keychain/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('keychain delegate delete failed:', e instanceof Error ? e.message : String(e));
  }
}

async function dIsAvailable(): Promise<boolean> {
  try {
    const res = await delegatedFetch('/available');
    if (!res.ok) return false;
    const data = await res.json() as { available?: boolean };
    return !!data.available;
  } catch {
    return false;
  }
}

// ─── Direct-mode helpers (dev fallback) ─────────────────────────────────

let _keytar: KeytarModule | null = null;
let _keytarAvailable = true;

function isKeytarShape(x: unknown): x is KeytarModule {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.setPassword === 'function' &&
    typeof r.getPassword === 'function' &&
    typeof r.deletePassword === 'function'
  );
}

async function getKeytar(): Promise<KeytarModule | null> {
  if (_keytar) return _keytar;
  if (!_keytarAvailable) return null;
  try {
    const mod = (await import('keytar')) as Record<string, unknown>;
    const candidate =
      isKeytarShape(mod.default) ? (mod.default as KeytarModule) :
      isKeytarShape(mod) ? (mod as unknown as KeytarModule) :
      null;
    if (!candidate) {
      console.warn('Keychain module loaded but has unexpected shape');
      _keytarAvailable = false;
      return null;
    }
    _keytar = candidate;
    return _keytar;
  } catch (e) {
    console.warn('Keychain not available:', e instanceof Error ? e.message : String(e));
    _keytarAvailable = false;
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function setPassword(profileId: number, password: string): Promise<boolean> {
  if (DELEGATED) return dSetPassword(profileId, password);
  const k = await getKeytar();
  if (!k) return false;
  try {
    await k.setPassword(SERVICE_NAME, `profile-${profileId}`, password);
    return true;
  } catch {
    return false;
  }
}

export async function getPassword(profileId: number): Promise<string | null> {
  if (DELEGATED) return dGetPassword(profileId);
  const k = await getKeytar();
  if (!k) return null;
  try {
    return await k.getPassword(SERVICE_NAME, `profile-${profileId}`);
  } catch {
    return null;
  }
}

export async function deletePassword(profileId: number): Promise<void> {
  if (DELEGATED) return dDeletePassword(profileId);
  const k = await getKeytar();
  if (!k) return;
  try {
    await k.deletePassword(SERVICE_NAME, `profile-${profileId}`);
  } catch {
    // ignore
  }
}

export async function isAvailable(): Promise<boolean> {
  if (DELEGATED) return dIsAvailable();
  return (await getKeytar()) !== null;
}
