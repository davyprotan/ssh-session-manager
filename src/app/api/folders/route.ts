import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY sort_order, name').all();
  return NextResponse.json(folders);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, color = 'cyan' } = body;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO folders (name, color) VALUES (?, ?)').run(name, color);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(folder, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Folder with that name exists' }, { status: 409 });
    }
    throw e;
  }
}
