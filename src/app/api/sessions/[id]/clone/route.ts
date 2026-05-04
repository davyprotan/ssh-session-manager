import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = getDb();
  const original = db.prepare('SELECT * FROM sessions WHERE id = ?').get(idNum) as SessionRow | undefined;
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Strip any existing " (copy)" or " (copy N)" suffix to get the base name
  const baseName = original.name.replace(/\s*\(copy(?:\s\d+)?\)\s*$/, '');

  let name = `${baseName} (copy)`;
  let counter = 2;
  while (db.prepare('SELECT 1 FROM sessions WHERE name = ?').get(name)) {
    name = `${baseName} (copy ${counter++})`;
    if (counter > 1000) return NextResponse.json({ error: 'too many copies' }, { status: 409 });
  }

  const result = db.prepare(`
    INSERT INTO sessions (name, host, port, profile_id, folder_id, jump_host, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, original.host, original.port, original.profile_id, original.folder_id, original.jump_host, original.tags, original.notes);

  const session = db.prepare(`
    SELECT s.*, p.name as profile_name, p.username as profile_username, p.auth_type as profile_auth_type, p.color as profile_color,
           f.name as folder_name, f.color as folder_color
    FROM sessions s LEFT JOIN profiles p ON s.profile_id = p.id LEFT JOIN folders f ON s.folder_id = f.id WHERE s.id = ?
  `).get(result.lastInsertRowid);

  return NextResponse.json(session, { status: 201 });
}
