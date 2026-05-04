import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { exec } from 'child_process';

export async function POST(req: NextRequest) {
  const { session_id } = await req.json();

  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, p.username, p.auth_type, p.key_path, p.port as profile_port
    FROM sessions s
    LEFT JOIN profiles p ON s.profile_id = p.id
    WHERE s.id = ?
  `).get(session_id) as {
    host: string;
    port: number;
    username?: string;
    auth_type?: string;
    key_path?: string;
    profile_port?: number;
  } | undefined;

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const port = session.port || 22;
  const username = session.username || '';
  const keyPath = session.key_path || '';

  let sshArgs = '';
  if (keyPath) sshArgs += ` -i "${keyPath}"`;
  if (port !== 22) sshArgs += ` -p ${port}`;

  const target = username ? `${username}@${session.host}` : session.host;
  const sshCmd = `ssh${sshArgs} ${target}`;

  // Update last_connected_at
  db.prepare(`UPDATE sessions SET last_connected_at = datetime('now') WHERE id = ?`).run(session_id);

  // Try to open in iTerm2, fall back to Terminal.app
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
