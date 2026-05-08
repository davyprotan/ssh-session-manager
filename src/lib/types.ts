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
  /** When 1, ssh is invoked with legacy KEX/host-key/cipher/MAC algorithms
   *  appended to the defaults. For old network gear (Arista, ADVA, Cisco). */
  compat_legacy?: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: number;
  host: string;
  port: number;
  username: string | null;
  jump_host: string | null;
  profile_id: number | null;
  session_id: number | null;
  profile_name_snapshot: string | null;
  profile_color_snapshot: string | null;
  session_name_snapshot: string | null;
  connected_at: string;
  // Joined when available
  profile_name?: string | null;
  profile_color?: string | null;
  session_name?: string | null;
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
