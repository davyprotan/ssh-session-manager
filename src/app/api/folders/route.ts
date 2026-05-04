import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';
import { parseFolder, ValidationError } from '@/lib/validators';

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY sort_order, name').all();
  return NextResponse.json(folders);
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  let input: ReturnType<typeof parseFolder>;
  try {
    input = parseFolder(await req.json());
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  if (!input.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO folders (name, color) VALUES (?, ?)').run(input.name, input.color);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(folder, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Folder with that name exists' }, { status: 409 });
    }
    throw e;
  }
}
