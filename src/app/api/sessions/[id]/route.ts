import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, host, port = 22, profile_id, tags = [], notes } = body;

  const db = getDb();
  db.prepare(`
    UPDATE sessions SET name=?, host=?, port=?, profile_id=?, tags=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, host, port, profile_id || null, JSON.stringify(tags), notes || null, id);

  const session = db.prepare(`
    SELECT s.*, p.name as profile_name, p.username as profile_username, p.auth_type as profile_auth_type
    FROM sessions s LEFT JOIN profiles p ON s.profile_id = p.id
    WHERE s.id = ?
  `).get(id);
  return NextResponse.json(session);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
