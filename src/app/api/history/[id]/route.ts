import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM connection_history WHERE id = ?').run(idNum);
  return NextResponse.json({ ok: true });
}
