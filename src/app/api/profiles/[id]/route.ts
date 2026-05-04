import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, deletePassword as kcDel, isAvailable as kcAvailable } from '@/lib/keychain';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idNum = parseInt(id);
  const body = await req.json();
  const {
    name, username, auth_type, password, key_path, port = 22,
    color = 'cyan', is_default = 0,
    agent_forwarding = 0, compression = 0, server_alive_interval = 0, extra_args = null,
  } = body;

  const db = getDb();
  const useKeychain = auth_type === 'password' && password && (await kcAvailable());

  db.transaction(() => {
    if (is_default) db.prepare('UPDATE profiles SET is_default = 0 WHERE id != ?').run(idNum);
    db.prepare(`
      UPDATE profiles SET
        name=?, username=?, auth_type=?, password=?, key_path=?, port=?, color=?, is_default=?,
        agent_forwarding=?, compression=?, server_alive_interval=?, extra_args=?, uses_keychain=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      name, username, auth_type,
      useKeychain ? null : (password || null),
      key_path || null, port, color, is_default ? 1 : 0,
      agent_forwarding ? 1 : 0, compression ? 1 : 0, server_alive_interval || 0, extra_args || null,
      useKeychain ? 1 : 0,
      idNum,
    );
  })();

  if (useKeychain) {
    await kcSet(idNum, password);
  } else if (auth_type !== 'password') {
    // Auth type changed away from password — clean up keychain
    await kcDel(idNum);
  }

  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(idNum);
  return NextResponse.json(profile);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idNum = parseInt(id);
  const db = getDb();
  db.prepare('DELETE FROM profiles WHERE id = ?').run(idNum);
  await kcDel(idNum);
  return NextResponse.json({ ok: true });
}
