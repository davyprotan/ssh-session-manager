import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { ProfileColor } from './profile-colors';

const DATA_DIR = path.join(os.homedir(), '.ssh-session-manager');
const DB_PATH = path.join(DATA_DIR, 'sessions.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      last_connected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Idempotent ALTERs for existing DBs
  const cols = db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has("color")) db.exec("ALTER TABLE profiles ADD COLUMN color TEXT NOT NULL DEFAULT 'cyan'");
  if (!colNames.has("is_default")) db.exec("ALTER TABLE profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
}

export { PROFILE_COLORS, COLOR_HEX } from './profile-colors';
export type { ProfileColor } from './profile-colors';

export type { AuthType, Profile, Session } from './types';
