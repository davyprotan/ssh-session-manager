import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, isAvailable as kcAvailable } from '@/lib/keychain';

export async function GET() {
  const db = getDb();
  // Don't return raw passwords in list response — they're sensitive
  const profiles = db.prepare(`
    SELECT id, name, username, auth_type, key_path, port, color, is_default,
           agent_forwarding, compression, server_alive_interval, extra_args,
           uses_keychain, created_at, updated_at,
           CASE WHEN password IS NOT NULL OR uses_keychain = 1 THEN 1 ELSE 0 END AS has_password
    FROM profiles ORDER BY is_default DESC, name
  `).all();
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name, username, auth_type, password, key_path, port = 22,
    color = 'cyan', is_default = 0,
    agent_forwarding = 0, compression = 0, server_alive_interval = 0, extra_args = null,
  } = body;

  if (!name || !username || !auth_type) {
    return NextResponse.json({ error: 'name, username, and auth_type are required' }, { status: 400 });
  }

  const db = getDb();
  const useKeychain = auth_type === 'password' && password && (await kcAvailable());

  try {
    const id = db.transaction(() => {
      if (is_default) db.prepare('UPDATE profiles SET is_default = 0').run();
      const result = db.prepare(`
        INSERT INTO profiles
          (name, username, auth_type, password, key_path, port, color, is_default,
           agent_forwarding, compression, server_alive_interval, extra_args, uses_keychain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name, username, auth_type,
        useKeychain ? null : (password || null),
        key_path || null, port, color, is_default ? 1 : 0,
        agent_forwarding ? 1 : 0, compression ? 1 : 0, server_alive_interval || 0, extra_args || null,
        useKeychain ? 1 : 0,
      );
      return Number(result.lastInsertRowid);
    })();

    if (useKeychain) await kcSet(id, password);

    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    return NextResponse.json(profile, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A profile with that name already exists' }, { status: 409 });
    }
    throw e;
  }
}
