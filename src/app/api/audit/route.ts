import { NextRequest, NextResponse } from 'next/server';
import { assertSafeRead } from '@/lib/api-guard';
import { listAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const limitParam = parseInt(url.searchParams.get('limit') || '200');
  const limit = Number.isFinite(limitParam) ? limitParam : 200;
  const rows = listAudit(limit);
  return NextResponse.json(rows);
}
