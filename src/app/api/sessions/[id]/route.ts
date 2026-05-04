import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const SELECT_JOINED = `
  SELECT s.*,
         p.name as profile_name, p.username as profile_username,
         p.auth_type as profile_auth_type, p.color as profile_color,
         f.name as folder_name, f.color as folder_color
  FROM sessions s
  LEFT JOIN profiles p ON s.profile_id = p.id
  LEFT JOIN folders f ON s.folder_id = f.id
`;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, host, port = 22, profile_id, folder_id, jump_host, tags = [], notes } = body;

  const db = getDb();
  db.prepare(`
    UPDATE sessions SET name=?, host=?, port=?, profile_id=?, folder_id=?, jump_host=?, tags=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, host, port, profile_id || null, folder_id || null, jump_host || null, JSON.stringify(tags), notes || null, id);

  const session = db.prepare(`${SELECT_JOINED} WHERE s.id = ?`).get(id);
  return NextResponse.json(session);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
