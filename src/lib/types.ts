// Client-safe types — no server-only imports
import type { ProfileColor } from './profile-colors';

export type AuthType = 'password' | 'key' | 'key_with_passphrase';

export interface Folder {
  id: number;
  name: string;
  color: ProfileColor;
  sort_order: number;
  created_at: string;
}

export interface Profile {
  id: number;
  name: string;
  username: string;
  auth_type: AuthType;
  password?: string | null;
  key_path?: string | null;
  port: number;
  color: ProfileColor;
  is_default: number;
  agent_forwarding: number;
  compression: number;
  server_alive_interval: number;
  extra_args?: string | null;
  uses_keychain: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  name: string;
  host: string;
  port: number;
  profile_id: number | null;
  folder_id: number | null;
  jump_host?: string | null;
  tags: string;
  notes: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  profile_name?: string | null;
  profile_username?: string | null;
  profile_auth_type?: string | null;
  profile_color?: string | null;
  folder_name?: string | null;
  folder_color?: string | null;
}
