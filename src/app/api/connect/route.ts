import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { exec } from 'child_process';
import { getPassword as kcGet } from '@/lib/keychain';

interface ProfileRow {
  id?: number;
  username: string;
  auth_type: string;
  key_path?: string;
  port: number;
  agent_forwarding: number;
  compression: number;
  server_alive_interval: number;
  extra_args?: string;
  uses_keychain: number;
  password?: string;
}

interface SessionRow {
  id?: number;
  host: string;
  port: number;
  jump_host?: string;
  profile_id?: number;
}

function buildSshCommand(opts: {
  host: string;
  port: number;
  username: string;
  keyPath?: string;
  jumpHost?: string;
  agentForwarding?: number;
  compression?: number;
  serverAliveInterval?: number;
  extraArgs?: string;
}): string {
  const args: string[] = [];
  if (opts.keyPath) args.push(`-i "${opts.keyPath}"`);
  if (opts.port && opts.port !== 22) args.push(`-p ${opts.port}`);
  if (opts.agentForwarding) args.push('-A');
  if (opts.compression) args.push('-C');
  if (opts.serverAliveInterval && opts.serverAliveInterval > 0) {
    args.push(`-o ServerAliveInterval=${opts.serverAliveInterval}`);
  }
  if (opts.jumpHost) args.push(`-J "${opts.jumpHost}"`);
  if (opts.extraArgs) args.push(opts.extraArgs);

  const target = opts.username ? `${opts.username}@${opts.host}` : opts.host;
  return `ssh ${args.join(' ')} ${target}`.replace(/\s+/g, ' ').trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  let host: string;
  let port: number;
  let username = '';
  let keyPath = '';
  let jumpHost = '';
  let agentForwarding = 0;
  let compression = 0;
  let serverAliveInterval = 0;
  let extraArgs = '';
  let profileId: number | undefined;

  if (body.session_id) {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(body.session_id) as SessionRow | undefined;
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    host = session.host;
    port = session.port || 22;
    jumpHost = session.jump_host || '';
    profileId = session.profile_id;

    if (profileId) {
      const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(profileId) as ProfileRow | undefined;
      if (profile) {
        username = profile.username;
        keyPath = profile.key_path || '';
        agentForwarding = profile.agent_forwarding || 0;
        compression = profile.compression || 0;
        serverAliveInterval = profile.server_alive_interval || 0;
        extraArgs = profile.extra_args || '';
      }
    }

    db.prepare(`UPDATE sessions SET last_connected_at = datetime('now') WHERE id = ?`).run(body.session_id);
  } else if (body.host && body.profile_id) {
    const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(body.profile_id) as ProfileRow | undefined;
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    host = body.host;
    port = body.port || profile.port || 22;
    username = profile.username;
    keyPath = profile.key_path || '';
    agentForwarding = profile.agent_forwarding || 0;
    compression = profile.compression || 0;
    serverAliveInterval = profile.server_alive_interval || 0;
    extraArgs = profile.extra_args || '';
    profileId = body.profile_id;
  } else {
    return NextResponse.json({ error: 'Provide session_id, or host + profile_id' }, { status: 400 });
  }

  const sshCmd = buildSshCommand({
    host, port, username, keyPath, jumpHost,
    agentForwarding, compression, serverAliveInterval, extraArgs,
  });

  // For password-auth profiles using keychain, fetch password and use sshpass-style approach
  // sshpass isn't available by default on macOS — for now, password is shown in toast for manual paste
  // (key auth is the recommended path)
  let passwordHint = '';
  if (profileId) {
    const profile = db.prepare(`SELECT auth_type, password, uses_keychain FROM profiles WHERE id = ?`).get(profileId) as { auth_type: string; password?: string; uses_keychain: number } | undefined;
    if (profile?.auth_type === 'password') {
      const pwd = profile.uses_keychain ? await kcGet(profileId) : profile.password;
      if (pwd) passwordHint = pwd;
    }
  }

  const appleScript = `
    tell application "System Events"
      set appList to name of every application process
    end tell
    if appList contains "iTerm2" or appList contains "iTerm" then
      tell application "iTerm"
        create window with default profile command "${sshCmd.replace(/"/g, '\\"')}"
      end tell
    else
      tell application "Terminal"
        do script "${sshCmd.replace(/"/g, '\\"')}"
        activate
      end tell
    end if
  `;

  exec(`osascript -e '${appleScript.replace(/'/g, "\\'")}'`, (err) => {
    if (err) console.error('AppleScript error:', err);
  });

  return NextResponse.json({ ok: true, command: sshCmd, hasPassword: !!passwordHint });
}
