import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import { parseSshConfig, type SshConfigEntry } from '@/lib/ssh-config';

const PALETTE = ['cyan', 'green', 'amber', 'purple', 'pink', 'rose'] as const;

// GET → returns a preview (parses ~/.ssh/config and returns what would be imported)
export async function GET() {
  const cfgPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(cfgPath)) {
    return NextResponse.json({ available: false, error: 'No ~/.ssh/config found', entries: [] });
  }

  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    const entries = parseSshConfig(content);
    // Expand $HOME
    const expanded = entries.map(e => ({
      ...e,
      identityFile: e.identityFile?.replace('$HOME', os.homedir()),
    }));
    return NextResponse.json({ available: true, entries: expanded, path: cfgPath });
  } catch (e: unknown) {
    return NextResponse.json({ available: false, error: e instanceof Error ? e.message : String(e), entries: [] });
  }
}

// POST → actually import. Body: { entries: SshConfigEntry[] } (the user-confirmed subset)
export async function POST(req: NextRequest) {
  const { entries } = (await req.json()) as { entries: SshConfigEntry[] };
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: 'entries array required' }, { status: 400 });
  }

  const db = getDb();
  const existingProfiles = db.prepare('SELECT * FROM profiles').all() as Array<{
    id: number; username: string; key_path: string | null; port: number;
  }>;

  // Group entries by (user, identityFile, port) → reuse or create profile
  function findOrCreateProfile(user: string, keyPath: string | null, port: number): number {
    const found = existingProfiles.find(p =>
      p.username === user &&
      (p.key_path || null) === keyPath &&
      p.port === port
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
    for (const e of entries) {
      const host = (e.hostname || e.host).trim();
      const user = (e.user || os.userInfo().username).trim();
      const port = e.port || 22;

      // Skip if a session with same name and host already exists
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
