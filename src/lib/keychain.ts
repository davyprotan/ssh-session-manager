// Server-only — uses keytar to access the OS keychain (macOS Keychain, Windows Credential Vault, libsecret on Linux)
const SERVICE_NAME = 'SSH Manager';

interface KeytarModule {
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

let _keytar: KeytarModule | null = null;
let _available = true;

async function getKeytar(): Promise<KeytarModule | null> {
  if (_keytar) return _keytar;
  if (!_available) return null;
  try {
    // Dynamic import — keytar is a native module
    const mod = await import('keytar');
    _keytar = (mod as unknown as { default?: KeytarModule }).default || (mod as unknown as KeytarModule);
    return _keytar;
  } catch (e) {
    console.warn('Keychain not available:', e instanceof Error ? e.message : String(e));
    _available = false;
    return null;
  }
}

export async function setPassword(profileId: number, password: string): Promise<boolean> {
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
  const k = await getKeytar();
  if (!k) return null;
  try {
    return await k.getPassword(SERVICE_NAME, `profile-${profileId}`);
  } catch {
    return null;
  }
}

export async function deletePassword(profileId: number): Promise<void> {
  const k = await getKeytar();
  if (!k) return;
  try {
    await k.deletePassword(SERVICE_NAME, `profile-${profileId}`);
  } catch {
    // ignore
  }
}

export async function isAvailable(): Promise<boolean> {
  return (await getKeytar()) !== null;
}
