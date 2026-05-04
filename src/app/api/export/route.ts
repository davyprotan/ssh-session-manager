import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPassword as kcGet } from '@/lib/keychain';
import { assertSafeRead } from '@/lib/api-guard';

interface ProfileRow {
  id: number;
  password: string | null;
  uses_keychain?: number;
  [k: string]: unknown;
}

// GET → safe export, NO plaintext passwords
export async function GET(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  return buildExport(req, false);
}

// POST → with `?include_secrets=1` body, includes plaintext passwords pulled from keychain.
// Requires the same origin guard. Use this from the in-app Settings dialog only.
export async function POST(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const includeSecrets = body && body.include_secrets === true;
  return buildExport(req, includeSecrets);
}

async function buildExport(req: NextRequest, includeSecrets: boolean) {
  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY id').all();
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id').all() as ProfileRow[];
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id').all();

  for (const p of profiles) {
    if (!includeSecrets) {
      // Strip plaintext password from export by default
      p.password = null;
    } else if (p.uses_keychain) {
      const pwd = await kcGet(p.id);
      if (pwd) p.password = pwd;
    }
    delete p.uses_keychain;
  }

  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    contains_secrets: includeSecrets,
    folders,
    profiles,
    sessions,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ssh-manager-backup-${new Date().toISOString().split('T')[0]}${includeSecrets ? '-with-secrets' : ''}.json"`,
    },
  });
}
