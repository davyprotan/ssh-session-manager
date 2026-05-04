import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPassword as kcGet } from '@/lib/keychain';

interface ProfileRow {
  id: number;
  password: string | null;
  uses_keychain?: number;
  [k: string]: unknown;
}

export async function GET() {
  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY id').all();
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id').all() as ProfileRow[];
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id').all();

  // Inline keychain passwords so the export is portable
  for (const p of profiles) {
    if (p.uses_keychain) {
      const pwd = await kcGet(p.id);
      if (pwd) p.password = pwd;
    }
    // Don't export uses_keychain flag — recipient OS may differ
    delete p.uses_keychain;
  }

  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    folders,
    profiles,
    sessions,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ssh-manager-backup-${new Date().toISOString().split('T')[0]}.json"`,
    },
  });
}
