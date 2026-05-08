import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ─────────────────────────────────────────────────────────────
// CRITICAL: these paths MUST NOT change between versions.
// Changing them = users lose their saved hosts/profiles on upgrade.
// ─────────────────────────────────────────────────────────────

/** Base directory for all user data. Stable since v0.1.0. */
export const DATA_DIR = path.join(os.homedir(), '.ssh-session-manager');

/** Primary DB. Stable since v0.1.0. */
const DB_PATH = path.join(DATA_DIR, 'sessions.db');

/** Where pre-migration snapshots & user-initiated backups live. */
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/** Current schema version. Bump only when adding/changing columns or tables. */
const SCHEMA_VERSION = 6;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
}

let _db: Database.Database | null = null;
let _deferredKicked = false;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  // Kick off the async post-migration that moves any leftover plaintext
  // passwords into the OS keychain. Fire-and-forget — if it fails the rows
  // remain as-is and we'll try again next startup.
  if (!_deferredKicked) {
    _deferredKicked = true;
    queueMicrotask(() => {
      void migratePlaintextPasswordsToKeychain().catch((e) =>
        console.warn('plaintext→keychain migration failed:', e),
      );
    });
  }
  return _db;
}

/** Snapshot the DB into backups/ before any migration. */
function snapshotBeforeMigration(fromVersion: number, toVersion: number) {
  if (!fs.existsSync(DB_PATH)) return; // first run, nothing to back up
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    const dest = path.join(BACKUPS_DIR, `pre-migration_v${fromVersion}-to-v${toVersion}_${ts}.db`);
    fs.copyFileSync(DB_PATH, dest);
    fs.chmodSync(dest, 0o600);
    // Also copy WAL+SHM if present, so the snapshot is fully consistent
    for (const ext of ['-wal', '-shm']) {
      const sidecar = DB_PATH + ext;
      if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, dest + ext);
    }
    // Keep at most 10 pre-migration snapshots
    const snaps = fs.readdirSync(BACKUPS_DIR)
      .filter(n => n.startsWith('pre-migration_'))
      .map(n => ({ name: n, m: fs.statSync(path.join(BACKUPS_DIR, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const old of snaps.slice(10)) {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, old.name)); } catch {}
    }
  } catch (e) {
    // Don't block startup if snapshotting fails — we still want the user's app to load.
    console.warn('Pre-migration snapshot failed:', e);
  }
}

function migrate(db: Database.Database) {
  // Read previous schema version (0 = brand-new DB)
  const cur = (db.pragma('user_version', { simple: true }) as number) || 0;

  if (cur < SCHEMA_VERSION) {
    snapshotBeforeMigration(cur, SCHEMA_VERSION);
  }

  // Always ensure baseline tables exist (idempotent — uses IF NOT EXISTS)
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT 'cyan',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'key', 'key_with_passphrase')),
      password TEXT,
      key_path TEXT,
      port INTEGER NOT NULL DEFAULT 22,
      color TEXT NOT NULL DEFAULT 'cyan',
      is_default INTEGER NOT NULL DEFAULT 0,
      agent_forwarding INTEGER NOT NULL DEFAULT 0,
      compression INTEGER NOT NULL DEFAULT 0,
      server_alive_interval INTEGER NOT NULL DEFAULT 0,
      extra_args TEXT,
      uses_keychain INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      jump_host TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      last_connected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS connection_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      jump_host TEXT,
      profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      -- snapshot fields preserve display even if profile/session is later deleted
      profile_name_snapshot TEXT,
      profile_color_snapshot TEXT,
      session_name_snapshot TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_connected_at ON connection_history(connected_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,           -- e.g. 'profile.delete', 'backup.export', 'restore.run'
      target_type TEXT,              -- 'profile' | 'session' | 'folder' | 'backup' | null
      target_id INTEGER,             -- DB id or null for non-row events
      target_label TEXT,             -- human-readable name at time of event (snapshot)
      details TEXT,                  -- short free-form JSON for context
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
  `);

  // Per-version migrations. Adding columns is non-destructive in SQLite.
  // NOTE: We never DROP columns or tables. If something is no longer used, leave it
  // — that way downgrading the app doesn't throw "unknown column" errors.

  ensureColumn(db, 'profiles', 'color', "color TEXT NOT NULL DEFAULT 'cyan'");
  ensureColumn(db, 'profiles', 'is_default', 'is_default INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'agent_forwarding', 'agent_forwarding INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'compression', 'compression INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'server_alive_interval', 'server_alive_interval INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'extra_args', 'extra_args TEXT');
  ensureColumn(db, 'profiles', 'uses_keychain', 'uses_keychain INTEGER NOT NULL DEFAULT 0');
  // v6: add legacy-SSH-compat flag — adds the well-known deprecated KEX /
  // host-key / cipher / MAC algos that old network gear still requires.
  ensureColumn(db, 'profiles', 'compat_legacy', 'compat_legacy INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sessions', 'folder_id', 'folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL');
  ensureColumn(db, 'sessions', 'jump_host', 'jump_host TEXT');

  // Persist the schema version so we know what was last applied.
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  if (cur === 0) {
    console.log(`[ssh-manager] DB initialized at v${SCHEMA_VERSION}`);
  } else if (cur < SCHEMA_VERSION) {
    console.log(`[ssh-manager] DB migrated v${cur} → v${SCHEMA_VERSION} (pre-migration snapshot in ${BACKUPS_DIR})`);
  } else if (cur > SCHEMA_VERSION) {
    console.warn(`[ssh-manager] DB schema is newer (v${cur}) than this app expects (v${SCHEMA_VERSION}). Reading anyway — extra columns will be ignored.`);
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Move any rows that still hold a plaintext password into the OS keychain.
 * Idempotent — re-runnable on every startup. Fails quietly per-row so a flaky
 * keychain doesn't block the rest of the migration. Audit-logs each success.
 *
 * Why not run inside `migrate()`? Keychain access is async and requires a
 * native module. We don't want to make `getDb()` async, so this runs
 * fire-and-forget after the sync migration finishes.
 */
async function migratePlaintextPasswordsToKeychain(): Promise<void> {
  if (!_db) return;
  // Lazy-import to avoid a cycle (keychain is consumer of db only via callers,
  // but audit imports getDb).
  const { setPassword: kcSet, isAvailable: kcAvailable } = await import('./keychain');
  if (!(await kcAvailable())) return;

  const rows = _db
    .prepare("SELECT id, name, password FROM profiles WHERE password IS NOT NULL AND password != ''")
    .all() as Array<{ id: number; name: string; password: string }>;
  if (rows.length === 0) return;

  const { audit } = await import('./audit');
  let migrated = 0;

  for (const r of rows) {
    try {
      const ok = await kcSet(r.id, r.password);
      if (!ok) continue;
      _db.prepare('UPDATE profiles SET password = NULL, uses_keychain = 1 WHERE id = ?').run(r.id);
      audit({
        event: 'profile.password_migrated',
        target_type: 'profile',
        target_id: r.id,
        target_label: r.name,
      });
      migrated++;
    } catch (e) {
      console.warn(`failed to migrate profile ${r.id} (${r.name}) to keychain:`, e);
    }
  }

  if (migrated > 0) {
    console.log(`[ssh-manager] migrated ${migrated} plaintext password(s) into the OS keychain`);
  }
}

export { PROFILE_COLORS, COLOR_HEX } from './profile-colors';
export type { ProfileColor } from './profile-colors';
export type { AuthType, Profile, Session, Folder, HistoryEntry } from './types';
