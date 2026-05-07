// Server-only. Reads/writes ~/.ssh/config with idempotent marker-block updates.
// Atomic write (tmp + rename), permissions preserved at 0600.

import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "./db";
import {
  BEGIN_MARKER,
  END_MARKER,
  generateSshConfigBlock,
  spliceManagedBlock,
  removeManagedBlock,
  type ExportSession,
} from "./ssh-config-export";

export const SSH_CONFIG_PATH = path.join(os.homedir(), ".ssh", "config");

interface SyncResult {
  path: string;
  action: "created" | "updated" | "noop" | "removed";
  hostCount: number;
  fileExisted: boolean;
}

interface SshConfigStatus {
  path: string;
  fileExists: boolean;
  managedBlockPresent: boolean;
  managedBlockHostCount: number;
  managedBlockGeneratedAt: string | null;
  /** Just the managed block text, for the UI preview. Empty string if not present. */
  managedBlockText: string;
}

/** Pull all sessions joined with their profile, in the shape the generator wants. */
function loadExportSessions(): ExportSession[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.name AS s_name, s.host AS s_host, s.port AS s_port, s.jump_host AS s_jump_host,
      p.username AS p_username, p.auth_type AS p_auth_type, p.key_path AS p_key_path,
      p.port AS p_port, p.agent_forwarding AS p_agent_forwarding, p.compression AS p_compression,
      p.server_alive_interval AS p_server_alive_interval, p.extra_args AS p_extra_args,
      p.uses_keychain AS p_uses_keychain
    FROM sessions s
    LEFT JOIN profiles p ON s.profile_id = p.id
    ORDER BY s.name
  `).all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    name: String(r.s_name),
    host: String(r.s_host),
    port: Number(r.s_port) || 22,
    jump_host: r.s_jump_host as string | null,
    profile: r.p_username == null ? null : {
      username: String(r.p_username),
      auth_type: String(r.p_auth_type) as "password" | "key" | "key_with_passphrase",
      key_path: r.p_key_path as string | null,
      port: r.p_port as number | undefined,
      agent_forwarding: Number(r.p_agent_forwarding) || 0,
      compression: Number(r.p_compression) || 0,
      server_alive_interval: Number(r.p_server_alive_interval) || 0,
      extra_args: r.p_extra_args as string | null,
      uses_keychain: Number(r.p_uses_keychain) || 0,
    },
  }));
}

function ensureSshDir(): void {
  const sshDir = path.dirname(SSH_CONFIG_PATH);
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }
}

function readExistingConfig(): { content: string; existed: boolean } {
  if (!fs.existsSync(SSH_CONFIG_PATH)) return { content: "", existed: false };
  return { content: fs.readFileSync(SSH_CONFIG_PATH, "utf8"), existed: true };
}

/** Atomically write `content` to ~/.ssh/config, mode 0600. */
function writeConfigAtomic(content: string): void {
  ensureSshDir();
  // Write to a tmp file in the same directory (so rename is atomic), then rename.
  const tmp = SSH_CONFIG_PATH + `.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  // Make sure tmp has the right perms even if the umask interfered.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, SSH_CONFIG_PATH);
}

/** Snapshot the current config alongside ~/.ssh-session-manager/backups/ before we overwrite it. */
function snapshotBeforeWrite(content: string, suffix: string): void {
  if (!content) return;
  try {
    const backupsDir = path.join(os.homedir(), ".ssh-session-manager", "backups");
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
    const dest = path.join(backupsDir, `ssh-config_${suffix}_${ts}.bak`);
    fs.writeFileSync(dest, content, { mode: 0o600 });
    // Keep at most 10 ssh-config backups.
    const snaps = fs.readdirSync(backupsDir)
      .filter((n) => n.startsWith("ssh-config_"))
      .map((n) => ({ name: n, m: fs.statSync(path.join(backupsDir, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const old of snaps.slice(10)) {
      try { fs.unlinkSync(path.join(backupsDir, old.name)); } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn("ssh_config snapshot failed (non-fatal):", err);
  }
}

/** Read status without writing. Used by the UI preview. */
export function getSshConfigStatus(): SshConfigStatus {
  const { content, existed } = readExistingConfig();
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  const present = beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx;

  let managedBlockText = "";
  let hostCount = 0;
  let generatedAt: string | null = null;
  if (present) {
    const blockEnd = content.indexOf("\n", endIdx);
    managedBlockText = content.slice(beginIdx, blockEnd === -1 ? undefined : blockEnd);
    // The number of "Host " lines in the block ≈ session count
    hostCount = (managedBlockText.match(/^\s*Host\s+\S/gm) || []).length;
    const m = managedBlockText.match(/^# Generated:\s*(\S+)/m);
    if (m) generatedAt = m[1];
  }

  return {
    path: SSH_CONFIG_PATH,
    fileExists: existed,
    managedBlockPresent: present,
    managedBlockHostCount: hostCount,
    managedBlockGeneratedAt: generatedAt,
    managedBlockText,
  };
}

/** Generate the proposed managed block from the current DB without touching the file. */
export function previewSshConfig(): { block: string; hostCount: number } {
  const sessions = loadExportSessions();
  const block = generateSshConfigBlock(sessions, { isMacOS: process.platform === "darwin" });
  return { block, hostCount: sessions.length };
}

/** Write the managed block into ~/.ssh/config, preserving everything outside the markers. */
export function syncSshConfig(): SyncResult {
  const sessions = loadExportSessions();
  const block = generateSshConfigBlock(sessions, { isMacOS: process.platform === "darwin" });

  const { content: existing, existed } = readExistingConfig();
  const updated = spliceManagedBlock(existing, block);

  if (existed && updated === existing) {
    return { path: SSH_CONFIG_PATH, action: "noop", hostCount: sessions.length, fileExisted: true };
  }

  if (existed) snapshotBeforeWrite(existing, "before-sync");
  writeConfigAtomic(updated);

  return {
    path: SSH_CONFIG_PATH,
    action: existed ? "updated" : "created",
    hostCount: sessions.length,
    fileExisted: existed,
  };
}

/** Strip the managed block, leaving any user-written content intact. */
export function removeSshConfigBlock(): SyncResult {
  const { content: existing, existed } = readExistingConfig();
  if (!existed) {
    return { path: SSH_CONFIG_PATH, action: "noop", hostCount: 0, fileExisted: false };
  }
  const stripped = removeManagedBlock(existing);
  if (stripped === existing) {
    return { path: SSH_CONFIG_PATH, action: "noop", hostCount: 0, fileExisted: true };
  }
  snapshotBeforeWrite(existing, "before-remove");
  if (stripped === "") {
    // Don't leave behind an empty config; remove the file entirely.
    fs.unlinkSync(SSH_CONFIG_PATH);
  } else {
    writeConfigAtomic(stripped);
  }
  return { path: SSH_CONFIG_PATH, action: "removed", hostCount: 0, fileExisted: true };
}
