import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, username, auth_type, password, key_path, port = 22, color = 'cyan', is_default = 0 } = body;

  const db = getDb();
  const tx = db.transaction(() => {
    if (is_default) {
      db.prepare('UPDATE profiles SET is_default = 0 WHERE id != ?').run(id);
    }
    db.prepare(`
      UPDATE profiles SET name=?, username=?, auth_type=?, password=?, key_path=?, port=?, color=?, is_default=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, username, auth_type, password || null, key_path || null, port, color, is_default ? 1 : 0, id);
    return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  });

  return NextResponse.json(tx());
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
