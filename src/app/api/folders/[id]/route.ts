import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.slice(0, 64) : null;
  const color = typeof body.color === 'string' && /^[a-z]+$/.test(body.color) ? body.color : null;
  const sort_order = Number.isInteger(body.sort_order) ? body.sort_order : null;

  const db = getDb();
  db.prepare('UPDATE folders SET name=COALESCE(?,name), color=COALESCE(?,color), sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name, color, sort_order, idNum);
  return NextResponse.json(db.prepare('SELECT * FROM folders WHERE id=?').get(idNum));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = getDb();
  // Manually null sessions referencing this folder, since legacy DBs may not enforce FK ON DELETE SET NULL
  db.transaction(() => {
    db.prepare('UPDATE sessions SET folder_id = NULL WHERE folder_id = ?').run(idNum);
    db.prepare('DELETE FROM folders WHERE id = ?').run(idNum);
  })();
  return NextResponse.json({ ok: true });
}
