import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY name').all();
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, username, auth_type, password, key_path, port = 22 } = body;

  if (!name || !username || !auth_type) {
    return NextResponse.json({ error: 'name, username, and auth_type are required' }, { status: 400 });
  }

  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO profiles (name, username, auth_type, password, key_path, port)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, username, auth_type, password || null, key_path || null, port);

    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(profile, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A profile with that name already exists' }, { status: 409 });
    }
    throw e;
  }
}
