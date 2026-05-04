import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, username, auth_type, password, key_path, port = 22 } = body;

  const db = getDb();
  db.prepare(`
    UPDATE profiles SET name=?, username=?, auth_type=?, password=?, key_path=?, port=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, username, auth_type, password || null, key_path || null, port, id);

  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  return NextResponse.json(profile);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
