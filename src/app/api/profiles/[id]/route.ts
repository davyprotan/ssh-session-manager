import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, deletePassword as kcDel, isAvailable as kcAvailable } from '@/lib/keychain';
import { assertSafeOrigin } from '@/lib/api-guard';
import { parseProfile, ValidationError } from '@/lib/validators';
import { audit } from '@/lib/audit';

const PUBLIC_COLS = `
  id, name, username, auth_type, key_path, port, color, is_default,
  agent_forwarding, compression, server_alive_interval, extra_args,
  uses_keychain, compat_legacy, created_at, updated_at,
  CASE WHEN password IS NOT NULL OR uses_keychain = 1 THEN 1 ELSE 0 END AS has_password
`;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let input: ReturnType<typeof parseProfile>;
  try {
    input = parseProfile(await req.json());
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const db = getDb();
  const hasNewSecret = !!input.password;
  const usesSecret = input.auth_type === 'password' || input.auth_type === 'key_with_passphrase';

  // Refuse to store secrets in plaintext — require the OS keychain.
  if (usesSecret && hasNewSecret && !(await kcAvailable())) {
    return NextResponse.json(
      { error: 'OS keychain is unavailable. Refusing to store the password in plaintext. Please ensure Keychain (macOS) / Credential Vault (Windows) / libsecret (Linux) is reachable and try again.' },
      { status: 503 },
    );
  }

  // Look up the existing row so we can preserve the keychain link when the
  // user edits a profile WITHOUT re-typing the password. Previously this
  // handler always set `uses_keychain` based purely on whether a fresh
  // password was supplied — so editing any other field (e.g. flipping
  // `compat_legacy`) clobbered the link to 0 and silently broke auto-fill.
  const existing = db.prepare('SELECT uses_keychain, password FROM profiles WHERE id = ?').get(idNum) as
    | { uses_keychain: number; password: string | null }
    | undefined;
  if (!existing) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  // If the user typed a NEW password, that's an explicit re-keying.
  // Otherwise, preserve whatever the row already had.
  let nextUsesKeychain: number;
  if (!usesSecret) {
    nextUsesKeychain = 0;             // auth_type changed away from password/passphrase
  } else if (hasNewSecret) {
    nextUsesKeychain = 1;             // new secret will be written to keychain
  } else {
    nextUsesKeychain = existing.uses_keychain; // keep the existing link
  }

  // If a new secret was provided, write it to the keychain BEFORE updating
  // the database, so a failing keychain write doesn't leave us with a row
  // that claims `uses_keychain=1` but has no entry to read.
  if (usesSecret && hasNewSecret) {
    const ok = await kcSet(idNum, input.password!);
    if (!ok) {
      return NextResponse.json(
        { error: 'Keychain write failed. The profile was not updated.' },
        { status: 503 },
      );
    }
  }

  db.transaction(() => {
    if (input.is_default) db.prepare('UPDATE profiles SET is_default = 0 WHERE id != ?').run(idNum);
    db.prepare(`
      UPDATE profiles SET
        name=?, username=?, auth_type=?, password=?, key_path=?, port=?, color=?, is_default=?,
        agent_forwarding=?, compression=?, server_alive_interval=?, extra_args=?, uses_keychain=?,
        compat_legacy=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      input.name, input.username, input.auth_type,
      null,
      input.key_path, input.port, input.color, input.is_default,
      input.agent_forwarding, input.compression, input.server_alive_interval, input.extra_args,
      nextUsesKeychain,
      input.compat_legacy,
      idNum,
    );
  })();

  if (!usesSecret) {
    // auth_type changed to plain SSH key — clean up any old keychain entry
    await kcDel(idNum);
  }

  const profile = db.prepare(`SELECT ${PUBLIC_COLS} FROM profiles WHERE id = ?`).get(idNum);
  return NextResponse.json(profile);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = getDb();
  const existing = db.prepare('SELECT name FROM profiles WHERE id = ?').get(idNum) as { name: string } | undefined;
  db.prepare('DELETE FROM profiles WHERE id = ?').run(idNum);
  await kcDel(idNum);
  if (existing) audit({ event: 'profile.delete', target_type: 'profile', target_id: idNum, target_label: existing.name });
  return NextResponse.json({ ok: true });
}
