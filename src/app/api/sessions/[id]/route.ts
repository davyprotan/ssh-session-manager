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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let input: ReturnType<typeof parseSession>;
  try {
    input = parseSession(await req.json());
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const db = getDb();
  db.prepare(`
    UPDATE sessions SET name=?, host=?, port=?, profile_id=?, folder_id=?, jump_host=?, tags=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(input.name, input.host, input.port, input.profile_id, input.folder_id, input.jump_host, JSON.stringify(input.tags), input.notes, idNum);

  const session = db.prepare(`${SELECT_JOINED} WHERE s.id = ?`).get(idNum);
  return NextResponse.json(session);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(idNum);
  return NextResponse.json({ ok: true });
}
