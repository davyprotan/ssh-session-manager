// Server-only. Map Electerm bookmark export → SSH Manager DB rows.
//
// Electerm export shape (`bookmarks-YYYY-…json`):
//   {
//     bookmarkGroups: [{ id, title, bookmarkIds: [], bookmarkGroupIds: [] }],
//     bookmarks:      [{ id, title, host, port, username, authType, privateKey?, password?, passphrase?, color?, profile? }]
//   }
//
// `privateKey` is the *content* of the key, not a path — Electerm stores keys inline. We write each
// unique key to ~/.ssh/ssh-manager-imported/{shortHash}.key with mode 0600 and reference that path.

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getDb } from "./db";
import { setPassword as kcSet, isAvailable as kcAvailable } from "./keychain";

const PALETTE = ["cyan", "green", "amber", "purple", "pink", "rose"] as const;
const KEYS_DIR = path.join(os.homedir(), ".ssh", "ssh-manager-imported");

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}

interface ElectermBookmark {
  id: string;
  title?: string;
  host: string;
  port?: number;
  username?: string;
  authType?: "privateKey" | "password" | "profiles";
  privateKey?: string;
  passphrase?: string;
  password?: string;
  color?: string;
  description?: string;
  profile?: string;
}

interface ElectermGroup {
  id: string;
  title: string;
  bookmarkIds?: string[];
}

export interface ElectermFile {
  bookmarks?: ElectermBookmark[];
  bookmarkGroups?: ElectermGroup[];
}

export function looksLikeElecterm(parsed: unknown): parsed is ElectermFile {
  if (!parsed || typeof parsed !== "object") return false;
  const r = parsed as Record<string, unknown>;
  return Array.isArray(r.bookmarks) && Array.isArray(r.bookmarkGroups);
}

/** Write key content to ~/.ssh/ssh-manager-imported/<hash>.key. Returns absolute path. */
function writeKey(content: string, label: string): string {
  ensureKeysDir();
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32);
  const filename = `${safeLabel}-${hash}.key`;
  const full = path.join(KEYS_DIR, filename);
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, content.endsWith("\n") ? content : content + "\n", { mode: 0o600 });
  }
  return full;
}

export interface ImportResult {
  foldersAdded: number;
  profilesAdded: number;
  sessionsAdded: number;
  sessionsSkipped: number;
  keysWritten: number;
  warnings: string[];
}

export async function importElecterm(data: ElectermFile): Promise<ImportResult> {
  const db = getDb();
  const useKc = await kcAvailable();
  const warnings: string[] = [];
  let foldersAdded = 0, profilesAdded = 0, sessionsAdded = 0, sessionsSkipped = 0, keysWritten = 0;
  const passwordWrites: Array<{ id: number; password: string }> = [];

  // Build a quick lookup: bookmarkId → groupTitle
  const bookmarkToGroup: Map<string, string> = new Map();
  for (const g of data.bookmarkGroups || []) {
    if (!g.title || g.id === "default") continue; // skip the implicit "default" group
    for (const bid of g.bookmarkIds || []) bookmarkToGroup.set(bid, g.title);
  }

  // Cache of existing folders / profiles to dedupe imports
  const folderByName = new Map<string, number>();
  for (const f of db.prepare("SELECT id, name FROM folders").all() as Array<{ id: number; name: string }>) {
    folderByName.set(f.name, f.id);
  }
  const profileByKey = new Map<string, number>(); // key = `${username}|${keyPath}|${authType}|${port}`
  const existingProfiles = db.prepare("SELECT id, name, username, key_path, auth_type, port FROM profiles").all() as Array<{ id: number; name: string; username: string; key_path: string | null; auth_type: string; port: number }>;
  for (const p of existingProfiles) {
    profileByKey.set(`${p.username}|${p.key_path || ""}|${p.auth_type}|${p.port}`, p.id);
  }

  let paletteCursor = existingProfiles.length;

  function getOrCreateFolder(name: string): number {
    const existing = folderByName.get(name);
    if (existing) return existing;
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const r = db.prepare("INSERT INTO folders (name, color) VALUES (?, ?)").run(name, color);
    const id = Number(r.lastInsertRowid);
    folderByName.set(name, id);
    foldersAdded++;
    return id;
  }

  function getOrCreateProfile(opts: { username: string; keyPath: string | null; authType: "key" | "key_with_passphrase" | "password"; port: number; passphrase?: string; password?: string; color?: string }): number {
    const key = `${opts.username}|${opts.keyPath || ""}|${opts.authType}|${opts.port}`;
    const existing = profileByKey.get(key);
    if (existing) return existing;

    const baseName = `${opts.username}${opts.keyPath ? ` · ${path.basename(opts.keyPath)}` : ""}`;
    let name = baseName;
    let counter = 1;
    while (db.prepare("SELECT 1 FROM profiles WHERE name = ?").get(name)) {
      counter++;
      name = `${baseName} (${counter})`;
    }

    const color = opts.color && /^[a-z]+$/.test(opts.color) ? opts.color : PALETTE[paletteCursor++ % PALETTE.length];
    const passwordToStore = opts.password || opts.passphrase || null;
    const usesKeychain = passwordToStore && useKc ? 1 : 0;

    const r = db.prepare(`
      INSERT INTO profiles (name, username, auth_type, password, key_path, port, color, uses_keychain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, opts.username, opts.authType, usesKeychain ? null : passwordToStore, opts.keyPath, opts.port, color, usesKeychain);
    const id = Number(r.lastInsertRowid);
    profileByKey.set(key, id);
    if (usesKeychain && passwordToStore) passwordWrites.push({ id, password: passwordToStore });
    profilesAdded++;
    return id;
  }

  db.transaction(() => {
    for (const b of data.bookmarks || []) {
      const host = (b.host || "").trim();
      if (!host) { warnings.push(`Skipped "${b.title || b.id}": no host`); sessionsSkipped++; continue; }

      const username = (b.username || os.userInfo().username).trim();
      const port = b.port && Number.isInteger(b.port) ? b.port : 22;
      const sessionName = (b.title || host).trim();

      // Resolve auth type. Electerm "profiles" means "use a stored profile" — for our purposes
      // we treat it as a key profile (since Electerm stores the key inline).
      let authType: "key" | "key_with_passphrase" | "password" = "key";
      let keyPath: string | null = null;
      let passphrase: string | undefined;
      let password: string | undefined;

      if (b.privateKey && b.privateKey.trim().length > 0) {
        try {
          keyPath = writeKey(b.privateKey, username);
          keysWritten++;
        } catch (e) {
          warnings.push(`Failed to write key for "${sessionName}": ${e instanceof Error ? e.message : String(e)}`);
        }
        if (b.passphrase) { authType = "key_with_passphrase"; passphrase = b.passphrase; }
        else { authType = "key"; }
      } else if (b.password) {
        authType = "password";
        password = b.password;
      } else {
        // Falls back to key auth without an explicit key — user can edit the profile later
        authType = "key";
      }

      const profileId = getOrCreateProfile({ username, keyPath, authType, port, passphrase, password });

      // Skip if a session with the same name+host already exists
      const dup = db.prepare("SELECT 1 FROM sessions WHERE name = ? AND host = ?").get(sessionName, host);
      if (dup) { sessionsSkipped++; continue; }

      const groupTitle = bookmarkToGroup.get(b.id);
      const folderId = groupTitle ? getOrCreateFolder(groupTitle) : null;

      const notes = b.description ? b.description.trim() : null;

      db.prepare(`
        INSERT INTO sessions (name, host, port, profile_id, folder_id, tags, notes)
        VALUES (?, ?, ?, ?, ?, '[]', ?)
      `).run(sessionName, host, port, profileId, folderId, notes);
      sessionsAdded++;
    }
  })();

  for (const { id, password } of passwordWrites) await kcSet(id, password);

  return { foldersAdded, profilesAdded, sessionsAdded, sessionsSkipped, keysWritten, warnings };
}
