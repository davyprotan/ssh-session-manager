// Server-only. Builds export payloads, writes/reads backup files in ~/.ssh-session-manager/backups/.

import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "./db";
import { getPassword as kcGet } from "./keychain";
import { encryptPayload, decryptPayload, isEncryptedEnvelope } from "./backup-crypto";

const BACKUPS_DIR = path.join(os.homedir(), ".ssh-session-manager", "backups");

// Ensure dir exists with safe perms
function ensureDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
}

interface ProfileRow {
  id: number;
  password: string | null;
  uses_keychain?: number;
  [k: string]: unknown;
}

/** Build the export payload — folders, profiles, sessions. Optionally pull keychain passwords. */
export async function buildExportPayload(includeSecrets: boolean) {
  const db = getDb();
  const folders = db.prepare("SELECT * FROM folders ORDER BY id").all();
  const profiles = db.prepare("SELECT * FROM profiles ORDER BY id").all() as ProfileRow[];
  const sessions = db.prepare("SELECT * FROM sessions ORDER BY id").all();

  for (const p of profiles) {
    if (!includeSecrets) {
      p.password = null;
    } else if (p.uses_keychain) {
      const pwd = await kcGet(p.id);
      if (pwd) p.password = pwd;
    }
    delete p.uses_keychain;
  }

  return {
    format: "ssh-manager-backup",
    version: 1,
    encrypted: false,
    contains_secrets: includeSecrets,
    exported_at: new Date().toISOString(),
    folders,
    profiles,
    sessions,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
}

/** Write a backup file to ~/.ssh-session-manager/backups/. Returns the absolute path. */
export async function writeBackupFile(opts: {
  password?: string;            // omit → unencrypted JSON
  includeSecrets?: boolean;     // pull keychain plaintext into the backup
}): Promise<{ path: string; size: number; encrypted: boolean }> {
  ensureDir();
  const includeSecrets = !!opts.includeSecrets;
  const payload = await buildExportPayload(includeSecrets);

  let body: string;
  let suffix: string;
  let encrypted = false;

  if (opts.password) {
    const env = await encryptPayload(payload, opts.password);
    body = JSON.stringify(env, null, 2);
    suffix = ".encrypted.json";
    encrypted = true;
  } else {
    body = JSON.stringify(payload, null, 2);
    suffix = includeSecrets ? ".with-secrets.json" : ".json";
  }

  const filename = `ssh-manager_${timestamp()}${suffix}`;
  const fullPath = path.join(BACKUPS_DIR, filename);
  fs.writeFileSync(fullPath, body, { mode: 0o600 });

  const stat = fs.statSync(fullPath);
  return { path: fullPath, size: stat.size, encrypted };
}

export interface BackupFileInfo {
  filename: string;
  size: number;
  encrypted: boolean;
  contains_secrets: boolean;
  created_at: string;
  format_version: number | null;
  invalid?: string;
}

/** List backup files (newest first), with metadata sniffed from the JSON header. */
export function listBackups(): BackupFileInfo[] {
  ensureDir();
  const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith(".json"));
  const infos: BackupFileInfo[] = [];

  for (const filename of files) {
    const full = path.join(BACKUPS_DIR, filename);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }

    const info: BackupFileInfo = {
      filename,
      size: stat.size,
      encrypted: false,
      contains_secrets: false,
      created_at: stat.mtime.toISOString(),
      format_version: null,
    };

    // Don't parse huge files
    if (stat.size > 16 * 1024 * 1024) {
      info.invalid = "file too large to inspect";
      infos.push(info);
      continue;
    }

    try {
      const text = fs.readFileSync(full, "utf8");
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (isEncryptedEnvelope(parsed)) {
        info.encrypted = true;
        info.contains_secrets = true; // assume secrets present in encrypted backup
        info.format_version = (parsed.version as number) ?? null;
      } else if (parsed && parsed.format === "ssh-manager-backup") {
        info.contains_secrets = !!parsed.contains_secrets;
        info.format_version = (parsed.version as number) ?? null;
      } else {
        info.invalid = "unrecognised file";
      }
    } catch (e: unknown) {
      info.invalid = e instanceof Error ? e.message : "parse error";
    }
    infos.push(info);
  }

  infos.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return infos;
}

/** Read a backup file, decrypting if necessary. Returns the inner payload. */
export async function readBackupFile(filename: string, password?: string): Promise<unknown> {
  // Reject path traversal
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("invalid filename");
  }
  const full = path.join(BACKUPS_DIR, filename);
  if (!full.startsWith(BACKUPS_DIR + path.sep)) throw new Error("invalid filename");

  const text = fs.readFileSync(full, "utf8");
  const parsed = JSON.parse(text);
  if (isEncryptedEnvelope(parsed)) {
    if (!password) throw new Error("password required");
    return await decryptPayload(parsed, password);
  }
  return parsed;
}

export function deleteBackupFile(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("invalid filename");
  }
  const full = path.join(BACKUPS_DIR, filename);
  if (!full.startsWith(BACKUPS_DIR + path.sep)) throw new Error("invalid filename");
  fs.unlinkSync(full);
}

export function getBackupsDir(): string {
  return BACKUPS_DIR;
}
