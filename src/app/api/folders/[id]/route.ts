import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, color, sort_order } = body;
  const db = getDb();
  db.prepare('UPDATE folders SET name=COALESCE(?,name), color=COALESCE(?,color), sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name ?? null, color ?? null, sort_order ?? null, id);
  return NextResponse.json(db.prepare('SELECT * FROM folders WHERE id=?').get(id));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
