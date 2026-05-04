import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface SessionRow {
  name: string;
  host: string;
  port: number;
  profile_id: number | null;
  folder_id: number | null;
  jump_host: string | null;
  tags: string;
  notes: string | null;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const original = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Find a unique name like "X (copy)", "X (copy 2)", etc.
  let name = `${original.name} (copy)`;
  let counter = 2;
  while (db.prepare('SELECT 1 FROM sessions WHERE name = ?').get(name)) {
    name = `${original.name} (copy ${counter++})`;
  }

  const result = db.prepare(`
    INSERT INTO sessions (name, host, port, profile_id, folder_id, jump_host, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, original.host, original.port, original.profile_id, original.folder_id, original.jump_host, original.tags, original.notes);

  const session = db.prepare(`
    SELECT s.*, p.name as profile_name, p.username as profile_username, p.auth_type as profile_auth_type, p.color as profile_color
    FROM sessions s LEFT JOIN profiles p ON s.profile_id = p.id WHERE s.id = ?
  `).get(result.lastInsertRowid);

  return NextResponse.json(session, { status: 201 });
}
