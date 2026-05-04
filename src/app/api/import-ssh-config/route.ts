import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import { parseSshConfig, type SshConfigEntry } from '@/lib/ssh-config';
import { assertSafeOrigin } from '@/lib/api-guard';

const PALETTE = ['cyan', 'green', 'amber', 'purple', 'pink', 'rose'] as const;

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const KEYPATH_RE = /^[a-zA-Z0-9._/~\-+ ]+$/;

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const cfgPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(cfgPath)) {
    return NextResponse.json({ available: false, error: 'No ~/.ssh/config found', entries: [] });
  }

  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    const entries = parseSshConfig(content);
    return NextResponse.json({ available: true, entries, path: cfgPath });
  } catch (e: unknown) {
    return NextResponse.json({ available: false, error: e instanceof Error ? e.message : String(e), entries: [] });
  }
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: 'entries array required' }, { status: 400 });
  }

  // Validate each entry from the client (it may have been tampered with, even though
  // the original came from disk)
  const safeEntries: SshConfigEntry[] = [];
  for (const e of body.entries as unknown[]) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const host = typeof r.host === 'string' && HOST_RE.test(r.host) ? r.host : null;
    if (!host) continue;
    const hostname = typeof r.hostname === 'string' && HOST_RE.test(r.hostname) ? r.hostname : undefined;
    const user = typeof r.user === 'string' && USER_RE.test(r.user) ? r.user : undefined;
    const port = Number.isInteger(r.port) && (r.port as number) > 0 && (r.port as number) < 65536 ? (r.port as number) : undefined;
    const identityFile = typeof r.identityFile === 'string' && KEYPATH_RE.test(r.identityFile) ? r.identityFile : undefined;
    const proxyJump = typeof r.proxyJump === 'string' && /^(?:[a-zA-Z0-9._-]{1,64}@)?[a-zA-Z0-9._:%\-]+(?::\d{1,5})?$/.test(r.proxyJump) ? r.proxyJump : undefined;
    safeEntries.push({ host, hostname, user, port, identityFile, proxyJump });
  }

  const db = getDb();
  const existingProfiles = db.prepare('SELECT * FROM profiles').all() as Array<{
    id: number; username: string; key_path: string | null; port: number;
  }>;

  function findOrCreateProfile(user: string, keyPath: string | null, port: number): number {
    const found = existingProfiles.find(p =>
      p.username === user && (p.key_path || null) === keyPath && p.port === port
    );
    if (found) return found.id;

    const baseName = `${user}${keyPath ? ` · ${path.basename(keyPath)}` : ''}`;
    let name = baseName;
    let counter = 1;
    while (db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(name)) {
      counter++;
      name = `${baseName} (${counter})`;
    }
    const color = PALETTE[existingProfiles.length % PALETTE.length];
    const result = db.prepare(`
      INSERT INTO profiles (name, username, auth_type, key_path, port, color)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, user, 'key', keyPath || null, port, color);
    const id = Number(result.lastInsertRowid);
    existingProfiles.push({ id, username: user, key_path: keyPath, port });
    return id;
  }

  let imported = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const e of safeEntries) {
      const host = (e.hostname || e.host).trim();
      const user = (e.user || os.userInfo().username).trim();
      const port = e.port || 22;

      const exists = db.prepare('SELECT 1 FROM sessions WHERE name = ? AND host = ?').get(e.host, host);
      if (exists) { skipped++; continue; }

      const profileId = findOrCreateProfile(user, e.identityFile || null, port);

      db.prepare(`
        INSERT INTO sessions (name, host, port, profile_id, jump_host, tags, notes)
        VALUES (?, ?, ?, ?, ?, '[]', ?)
      `).run(e.host, host, port, profileId, e.proxyJump || null, `Imported from ~/.ssh/config`);
      imported++;
    }
  });
  tx();

  return NextResponse.json({ imported, skipped });
}
