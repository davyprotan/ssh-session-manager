import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { execFile } from 'child_process';
import { buildSshArgs } from '@/lib/ssh-command';
import { assertSafeOrigin } from '@/lib/api-guard';

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
}

interface SessionRow {
  id?: number;
  host: string;
  port: number;
  jump_host?: string;
  profile_id?: number;
}

/** Escape an arbitrary string for safe inclusion in an AppleScript double-quoted string. */
function escapeForAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const db = getDb();

  let host: string | undefined;
  let port: number | undefined;
  let username = '';
  let keyPath = '';
  let jumpHost = '';
  let agentForwarding = 0;
  let compression = 0;
  let serverAliveInterval = 0;
  let extraArgs = '';

  if (typeof body.session_id === 'number') {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(body.session_id) as SessionRow | undefined;
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    host = session.host;
    port = session.port || 22;
    jumpHost = session.jump_host || '';
    const profileId = session.profile_id;

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
  } else if (typeof body.host === 'string' && typeof body.profile_id === 'number') {
    const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(body.profile_id) as ProfileRow | undefined;
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    host = String(body.host);
    const requestedPort = Number(body.port) || profile.port || 22;
    port = requestedPort;
    username = profile.username;
    keyPath = profile.key_path || '';
    agentForwarding = profile.agent_forwarding || 0;
    compression = profile.compression || 0;
    serverAliveInterval = profile.server_alive_interval || 0;
    extraArgs = profile.extra_args || '';
  } else {
    return NextResponse.json({ error: 'Provide session_id, or host + profile_id' }, { status: 400 });
  }

  // Build & validate the SSH args
  const result = buildSshArgs({
    host: host!,
    port: port!,
    username,
    keyPath,
    jumpHost,
    agentForwarding: !!agentForwarding,
    compression: !!compression,
    serverAliveInterval,
    extraArgs,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `Refused to connect: ${result.error}` }, { status: 400 });
  }

  // Build the shell command. Each argv element is properly single-quoted.
  // single-quote escape: replace ' with '\''
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const shellCmd = `ssh ${result.argv.map(sq).join(' ')}`;

  // AppleScript with proper escaping
  const escaped = escapeForAppleScriptString(shellCmd);
  const appleScript = `
    tell application "System Events"
      set appList to name of every application process
    end tell
    if appList contains "iTerm2" or appList contains "iTerm" then
      tell application "iTerm"
        create window with default profile command "${escaped}"
      end tell
    else
      tell application "Terminal"
        do script "${escaped}"
        activate
      end tell
    end if
  `;

  // Use execFile (no shell) so the AppleScript content can never break out into a shell.
  execFile('osascript', ['-e', appleScript], (err) => {
    if (err) console.error('AppleScript error:', err);
  });

  return NextResponse.json({ ok: true, command: result.display });
}
