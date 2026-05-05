import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { readBackupFile } from "@/lib/backup";
import { getDb } from "@/lib/db";
import { setPassword as kcSet, isAvailable as kcAvailable } from "@/lib/keychain";

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

interface BackupPayload {
  format?: string;
  folders?: ImportFolder[];
  profiles?: ImportProfile[];
  sessions?: ImportSession[];
}

// POST { filename, password?, mode?, preview? }
// preview: true → just count what would be added/skipped, don't write
export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const filename = typeof body.filename === "string" ? body.filename : null;
  const password = typeof body.password === "string" ? body.password : undefined;
  const mode = body.mode === "replace" ? "replace" : "merge";
  const preview = !!body.preview;

  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });

  let payload: BackupPayload;
  try {
    payload = (await readBackupFile(filename, password)) as BackupPayload;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed to read backup";
    if (msg === "password required") return NextResponse.json({ error: msg, needs_password: true }, { status: 400 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!payload || payload.format !== "ssh-manager-backup") {
    return NextResponse.json({ error: "not a valid backup payload" }, { status: 400 });
  }

  if (preview) {
    return NextResponse.json({
      foldersInBackup: payload.folders?.length || 0,
      profilesInBackup: payload.profiles?.length || 0,
      sessionsInBackup: payload.sessions?.length || 0,
      mode,
    });
  }

  const db = getDb();
  const useKc = await kcAvailable();
  const folderIdMap = new Map<number, number>();
  const profileIdMap = new Map<number, number>();
  let foldersAdded = 0, profilesAdded = 0, sessionsAdded = 0;
  const passwordWrites: Array<{ id: number; password: string }> = [];

  db.transaction(() => {
    if (mode === "replace") {
      db.prepare("DELETE FROM sessions").run();
      db.prepare("DELETE FROM profiles").run();
      db.prepare("DELETE FROM folders").run();
    }

    for (const f of payload.folders || []) {
      const existing = db.prepare("SELECT id FROM folders WHERE name = ?").get(f.name) as { id: number } | undefined;
      let newId: number;
      if (existing) newId = existing.id;
      else {
        const r = db.prepare("INSERT INTO folders (name, color, sort_order) VALUES (?, ?, ?)").run(f.name, f.color || "cyan", f.sort_order || 0);
        newId = Number(r.lastInsertRowid);
        foldersAdded++;
      }
      if (f.id !== undefined) folderIdMap.set(f.id, newId);
    }

    for (const p of payload.profiles || []) {
      const existing = db.prepare("SELECT id FROM profiles WHERE name = ?").get(p.name) as { id: number } | undefined;
      let newId: number;
      if (existing) newId = existing.id;
      else {
        const usesKeychain = p.auth_type === "password" && p.password && useKc ? 1 : 0;
        const r = db.prepare(`
          INSERT INTO profiles (name, username, auth_type, password, key_path, port, color, is_default,
            agent_forwarding, compression, server_alive_interval, extra_args, uses_keychain)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.name, p.username, p.auth_type,
          usesKeychain ? null : (p.password || null),
          p.key_path || null, p.port || 22, p.color || "cyan", p.is_default || 0,
          p.agent_forwarding || 0, p.compression || 0, p.server_alive_interval || 0, p.extra_args || null,
          usesKeychain,
        );
        newId = Number(r.lastInsertRowid);
        if (usesKeychain && p.password) passwordWrites.push({ id: newId, password: p.password });
        profilesAdded++;
      }
      if (p.id !== undefined) profileIdMap.set(p.id, newId);
    }

    for (const s of payload.sessions || []) {
      const existing = db.prepare("SELECT id FROM sessions WHERE name = ? AND host = ?").get(s.name, s.host);
      if (existing) continue;
      db.prepare(`
        INSERT INTO sessions (name, host, port, profile_id, folder_id, jump_host, tags, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.name, s.host, s.port || 22,
        s.profile_id != null ? (profileIdMap.get(s.profile_id) ?? null) : null,
        s.folder_id != null ? (folderIdMap.get(s.folder_id) ?? null) : null,
        s.jump_host || null, s.tags || "[]", s.notes || null,
      );
      sessionsAdded++;
    }
  })();

  for (const { id, password: pwd } of passwordWrites) await kcSet(id, pwd);

  return NextResponse.json({ foldersAdded, profilesAdded, sessionsAdded });
}
