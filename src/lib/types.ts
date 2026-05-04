// Client-safe types — no server-only imports
import type { ProfileColor } from './profile-colors';

export type AuthType = 'password' | 'key' | 'key_with_passphrase';

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
  profile_name?: string | null;
  profile_username?: string | null;
  profile_auth_type?: string | null;
  profile_color?: string | null;
}
