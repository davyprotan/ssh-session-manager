import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';
import { parseSession, ValidationError } from '@/lib/validators';

const SELECT_JOINED = `
  SELECT s.*,
         p.name as profile_name, p.username as profile_username,
         p.auth_type as profile_auth_type, p.color as profile_color,
         f.name as folder_name, f.color as folder_color
  FROM sessions s
  LEFT JOIN profiles p ON s.profile_id = p.id
  LEFT JOIN folders f ON s.folder_id = f.id
`;

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const db = getDb();
  const sessions = db.prepare(`${SELECT_JOINED} ORDER BY s.name`).all();
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  let input: ReturnType<typeof parseSession>;
  try {
    input = parseSession(await req.json());
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  if (!input.name || !input.host) {
    return NextResponse.json({ error: 'name and host are required' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sessions (name, host, port, profile_id, folder_id, jump_host, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.name, input.host, input.port, input.profile_id, input.folder_id, input.jump_host, JSON.stringify(input.tags), input.notes);

  const session = db.prepare(`${SELECT_JOINED} WHERE s.id = ?`).get(result.lastInsertRowid);
  return NextResponse.json(session, { status: 201 });
}
