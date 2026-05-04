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
  `);

  // Idempotent ALTERs for existing DBs
  function ensureColumn(table: string, column: string, ddl: string) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  ensureColumn('profiles', 'color', "color TEXT NOT NULL DEFAULT 'cyan'");
  ensureColumn('profiles', 'is_default', 'is_default INTEGER NOT NULL DEFAULT 0');
  ensureColumn('profiles', 'agent_forwarding', 'agent_forwarding INTEGER NOT NULL DEFAULT 0');
  ensureColumn('profiles', 'compression', 'compression INTEGER NOT NULL DEFAULT 0');
  ensureColumn('profiles', 'server_alive_interval', 'server_alive_interval INTEGER NOT NULL DEFAULT 0');
  ensureColumn('profiles', 'extra_args', 'extra_args TEXT');
  ensureColumn('profiles', 'uses_keychain', 'uses_keychain INTEGER NOT NULL DEFAULT 0');
  ensureColumn('sessions', 'folder_id', 'folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL');
  ensureColumn('sessions', 'jump_host', 'jump_host TEXT');
}

export { PROFILE_COLORS, COLOR_HEX } from './profile-colors';
export type { ProfileColor } from './profile-colors';
export type { AuthType, Profile, Session, Folder } from './types';
