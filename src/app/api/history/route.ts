import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertSafeOrigin } from '@/lib/api-guard';

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const db = getDb();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

  const rows = db.prepare(`
    SELECT h.*,
           p.name as profile_name, p.color as profile_color,
           s.name as session_name
    FROM connection_history h
    LEFT JOIN profiles p ON h.profile_id = p.id
    LEFT JOIN sessions s ON h.session_id = s.id
    ORDER BY h.connected_at DESC
    LIMIT ?
  `).all(limit);

  return NextResponse.json(rows);
}

// DELETE /api/history → clear all
export async function DELETE(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const db = getDb();
  db.prepare('DELETE FROM connection_history').run();
  return NextResponse.json({ ok: true });
}
