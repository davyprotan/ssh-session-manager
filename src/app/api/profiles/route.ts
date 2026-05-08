import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, isAvailable as kcAvailable } from '@/lib/keychain';
import { assertSafeOrigin } from '@/lib/api-guard';
import { parseProfile, ValidationError } from '@/lib/validators';
import { audit } from '@/lib/audit';

const PUBLIC_COLS = `
  id, name, username, auth_type, key_path, port, color, is_default,
  agent_forwarding, compression, server_alive_interval, extra_args,
  uses_keychain, compat_legacy, created_at, updated_at,
  CASE WHEN password IS NOT NULL OR uses_keychain = 1 THEN 1 ELSE 0 END AS has_password
`;

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const db = getDb();
  const profiles = db.prepare(`SELECT ${PUBLIC_COLS} FROM profiles ORDER BY is_default DESC, name`).all();
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  let input: ReturnType<typeof parseProfile>;
  try {
    input = parseProfile(await req.json());
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  if (!input.name || !input.username) {
    return NextResponse.json({ error: 'name and username are required' }, { status: 400 });
  }

  const db = getDb();
  // Use keychain for any auth type that has a secret to store (password OR passphrase)
  const hasSecret = !!input.password;
  const usesSecret = input.auth_type === 'password' || input.auth_type === 'key_with_passphrase';

  // Refuse to store secrets in plaintext — require the OS keychain.
  if (usesSecret && hasSecret && !(await kcAvailable())) {
    return NextResponse.json(
      { error: 'OS keychain is unavailable. Refusing to store the password in plaintext. Please ensure Keychain (macOS) / Credential Vault (Windows) / libsecret (Linux) is reachable and try again.' },
      { status: 503 },
    );
  }
  const useKeychain = usesSecret && hasSecret;

  try {
    const id = db.transaction(() => {
      if (input.is_default) db.prepare('UPDATE profiles SET is_default = 0').run();
      const result = db.prepare(`
        INSERT INTO profiles
          (name, username, auth_type, password, key_path, port, color, is_default,
           agent_forwarding, compression, server_alive_interval, extra_args, uses_keychain, compat_legacy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.name, input.username, input.auth_type,
        null,
        input.key_path, input.port, input.color, input.is_default,
        input.agent_forwarding, input.compression, input.server_alive_interval, input.extra_args,
        useKeychain ? 1 : 0,
        input.compat_legacy,
      );
      return Number(result.lastInsertRowid);
    })();

    if (useKeychain && input.password) {
      const ok = await kcSet(id, input.password);
      if (!ok) {
        // Keychain became unavailable between the precheck and the write — roll back.
        db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
        return NextResponse.json(
          { error: 'Keychain write failed. The profile was not created.' },
          { status: 503 },
        );
      }
    }

    const profile = db.prepare(`SELECT ${PUBLIC_COLS} FROM profiles WHERE id = ?`).get(id);
    audit({
      event: 'profile.create',
      target_type: 'profile',
      target_id: id,
      target_label: input.name,
      details: { auth_type: input.auth_type, uses_keychain: useKeychain ? 1 : 0 },
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A profile with that name already exists' }, { status: 409 });
    }
    throw e;
  }
}
