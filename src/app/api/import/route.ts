import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setPassword as kcSet, isAvailable as kcAvailable } from '@/lib/keychain';

interface ImportFolder { id?: number; name: string; color?: string; sort_order?: number }
interface ImportProfile {
  id?: number; name: string; username: string; auth_type: string;
  password?: string | null; key_path?: string | null; port?: number;
  color?: string; is_default?: number;
  agent_forwarding?: number; compression?: number; server_alive_interval?: number;
  extra_args?: string | null;
}
interface ImportSession {
  id?: number; name: string; host: string; port?: number;
  profile_id?: number | null; folder_id?: number | null;
  jump_host?: string | null; tags?: string; notes?: string | null;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    folders?: ImportFolder[];
    profiles?: ImportProfile[];
    sessions?: ImportSession[];
    mode?: 'merge' | 'replace';
  };

  const mode = body.mode || 'merge';
  const db = getDb();
  const useKc = await kcAvailable();

  // Maps from old IDs in the import file to new IDs in this DB
  const folderIdMap = new Map<number, number>();
  const profileIdMap = new Map<number, number>();

  let foldersAdded = 0, profilesAdded = 0, sessionsAdded = 0;
  const passwordWrites: Array<{ id: number; password: string }> = [];

  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM profiles').run();
      db.prepare('DELETE FROM folders').run();
    }

    // Folders
    for (const f of body.folders || []) {
      const existing = db.prepare('SELECT id FROM folders WHERE name = ?').get(f.name) as { id: number } | undefined;
      let newId: number;
      if (existing) {
        newId = existing.id;
      } else {
        const r = db.prepare('INSERT INTO folders (name, color, sort_order) VALUES (?, ?, ?)')
          .run(f.name, f.color || 'cyan', f.sort_order || 0);
        newId = Number(r.lastInsertRowid);
        foldersAdded++;
      }
      if (f.id !== undefined) folderIdMap.set(f.id, newId);
    }

    // Profiles
    for (const p of body.profiles || []) {
      const existing = db.prepare('SELECT id FROM profiles WHERE name = ?').get(p.name) as { id: number } | undefined;
      let newId: number;
      if (existing) {
        newId = existing.id;
      } else {
        const usesKeychain = p.auth_type === 'password' && p.password && useKc ? 1 : 0;
        const r = db.prepare(`
          INSERT INTO profiles (name, username, auth_type, password, key_path, port, color, is_default,
            agent_forwarding, compression, server_alive_interval, extra_args, uses_keychain)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.name, p.username, p.auth_type,
          usesKeychain ? null : (p.password || null),
          p.key_path || null, p.port || 22, p.color || 'cyan', p.is_default || 0,
          p.agent_forwarding || 0, p.compression || 0, p.server_alive_interval || 0, p.extra_args || null,
          usesKeychain,
        );
        newId = Number(r.lastInsertRowid);
        if (usesKeychain && p.password) passwordWrites.push({ id: newId, password: p.password });
        profilesAdded++;
      }
      if (p.id !== undefined) profileIdMap.set(p.id, newId);
    }

    // Sessions
    for (const s of body.sessions || []) {
      const existing = db.prepare('SELECT id FROM sessions WHERE name = ? AND host = ?').get(s.name, s.host);
      if (existing) continue;
      db.prepare(`
        INSERT INTO sessions (name, host, port, profile_id, folder_id, jump_host, tags, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.name, s.host, s.port || 22,
        s.profile_id != null ? (profileIdMap.get(s.profile_id) ?? null) : null,
        s.folder_id != null ? (folderIdMap.get(s.folder_id) ?? null) : null,
        s.jump_host || null,
        s.tags || '[]',
        s.notes || null,
      );
      sessionsAdded++;
    }
  })();

  // Save passwords to keychain after the transaction
  for (const { id, password } of passwordWrites) {
    await kcSet(id, password);
  }

  return NextResponse.json({ foldersAdded, profilesAdded, sessionsAdded });
}
