// GET → returns the password/passphrase for a profile.
// Origin-guarded; only callable from the local app.
// Used when the user clicks the "reveal" eye icon while editing a profile.

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPassword as kcGet } from '@/lib/keychain';
import { assertSafeOrigin } from '@/lib/api-guard';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT password, uses_keychain FROM profiles WHERE id = ?').get(idNum) as
    | { password: string | null; uses_keychain: number }
    | undefined;
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let secret: string | null = null;
  if (row.uses_keychain) {
    secret = await kcGet(idNum);
  } else {
    secret = row.password;
  }

  return NextResponse.json({ password: secret });
}
