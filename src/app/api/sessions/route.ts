import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*, p.name as profile_name, p.username as profile_username, p.auth_type as profile_auth_type
    FROM sessions s
    LEFT JOIN profiles p ON s.profile_id = p.id
    ORDER BY s.name
  `).all();
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, host, port = 22, profile_id, tags = [], notes } = body;

  if (!name || !host) {
    return NextResponse.json({ error: 'name and host are required' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sessions (name, host, port, profile_id, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, host, port, profile_id || null, JSON.stringify(tags), notes || null);

  const session = db.prepare(`
    SELECT s.*, p.name as profile_name, p.username as profile_username, p.auth_type as profile_auth_type
    FROM sessions s LEFT JOIN profiles p ON s.profile_id = p.id
    WHERE s.id = ?
  `).get(result.lastInsertRowid);

  return NextResponse.json(session, { status: 201 });
}
