import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

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
}

export type AuthType = 'password' | 'key' | 'key_with_passphrase';

export interface Profile {
  id: number;
  name: string;
  username: string;
  auth_type: AuthType;
  password?: string | null;
  key_path?: string | null;
  port: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  name: string;
  host: string;
  port: number;
  profile_id: number | null;
  tags: string;
  notes: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  profile_name?: string | null;
  profile_username?: string | null;
  profile_auth_type?: string | null;
}
