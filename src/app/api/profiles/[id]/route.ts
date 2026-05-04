import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, deletePassword as kcDel, isAvailable as kcAvailable } from '@/lib/keychain';
import { assertSafeOrigin } from '@/lib/api-guard';
import { parseProfile, ValidationError } from '@/lib/validators';

const PUBLIC_COLS = `
  id, name, username, auth_type, key_path, port, color, is_default,
  agent_forwarding, compression, server_alive_interval, extra_args,
  uses_keychain, created_at, updated_at,
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
  const useKeychain = input.auth_type === 'password' && input.password && (await kcAvailable());

  db.transaction(() => {
    if (input.is_default) db.prepare('UPDATE profiles SET is_default = 0 WHERE id != ?').run(idNum);
    db.prepare(`
      UPDATE profiles SET
        name=?, username=?, auth_type=?, password=?, key_path=?, port=?, color=?, is_default=?,
        agent_forwarding=?, compression=?, server_alive_interval=?, extra_args=?, uses_keychain=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      input.name, input.username, input.auth_type,
      useKeychain ? null : (input.password || null),
      input.key_path, input.port, input.color, input.is_default,
      input.agent_forwarding, input.compression, input.server_alive_interval, input.extra_args,
      useKeychain ? 1 : 0,
      idNum,
    );
  })();

  if (useKeychain && input.password) {
    await kcSet(idNum, input.password);
  } else if (input.auth_type !== 'password') {
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
  db.prepare('DELETE FROM profiles WHERE id = ?').run(idNum);
  await kcDel(idNum);
  return NextResponse.json({ ok: true });
}
