import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { exec } from 'child_process';

interface JoinedSession {
  host: string;
  port: number;
  username?: string;
  auth_type?: string;
  key_path?: string;
}

interface JoinedProfile {
  username: string;
  auth_type: string;
  key_path?: string;
  port: number;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  let host: string;
  let port: number;
  let username = '';
  let keyPath = '';

  if (body.session_id) {
    const session = db.prepare(`
      SELECT s.host, s.port, p.username, p.auth_type, p.key_path
      FROM sessions s
      LEFT JOIN profiles p ON s.profile_id = p.id
      WHERE s.id = ?
    `).get(body.session_id) as JoinedSession | undefined;

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    host = session.host;
    port = session.port || 22;
    username = session.username || '';
    keyPath = session.key_path || '';

    db.prepare(`UPDATE sessions SET last_connected_at = datetime('now') WHERE id = ?`).run(body.session_id);
  } else if (body.host && body.profile_id) {
    // Quick connect: arbitrary host with a saved profile
    const profile = db.prepare(`
      SELECT username, auth_type, key_path, port FROM profiles WHERE id = ?
    `).get(body.profile_id) as JoinedProfile | undefined;

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    host = body.host;
    port = body.port || profile.port || 22;
    username = profile.username;
    keyPath = profile.key_path || '';
  } else {
    return NextResponse.json({ error: 'Provide session_id, or host + profile_id' }, { status: 400 });
  }

  let sshArgs = '';
  if (keyPath) sshArgs += ` -i "${keyPath}"`;
  if (port !== 22) sshArgs += ` -p ${port}`;

  const target = username ? `${username}@${host}` : host;
  const sshCmd = `ssh${sshArgs} ${target}`;

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

  return NextResponse.json({ ok: true, command: sshCmd });
}
