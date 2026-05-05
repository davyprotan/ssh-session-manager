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
        // Only send -i when auth type is key-based; for password auth, ssh shouldn't be told to use a key file
        keyPath = (profile.auth_type === 'key' || profile.auth_type === 'key_with_passphrase') ? (profile.key_path || '') : '';
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
    keyPath = (profile.auth_type === 'key' || profile.auth_type === 'key_with_passphrase') ? (profile.key_path || '') : '';
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
  const sshCmd = `ssh ${result.argv.map(sq).join(' ')}`;

  // For iTerm2 we open a fresh window and TYPE the command into the user's normal login
  // shell. When ssh exits the user is back at their shell prompt and can read the error
  // until they close the window manually. This avoids iTerm2's "command session ended"
  // behaviour where the window closes faster than the eye can read.
  // For Terminal.app, `do script` already keeps the window open after the command exits.
  const escapedForIterm = escapeForAppleScriptString(sshCmd);
  const escapedForTerminal = escapeForAppleScriptString(sshCmd);
  const appleScript = `
    tell application "System Events"
      set appList to name of every application process
    end tell
    if appList contains "iTerm2" or appList contains "iTerm" then
      tell application "iTerm"
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${escapedForIterm}"
        end tell
        activate
      end tell
    else
      tell application "Terminal"
        do script "${escapedForTerminal}"
        activate
      end tell
    end if
  `;

  // Use execFile (no shell) so the AppleScript content can never break out into a shell.
  execFile('osascript', ['-e', appleScript], (err) => {
    if (err) console.error('AppleScript error:', err);
  });

  // Log to history (best-effort; never block the connection on this)
  try {
    let profileId: number | null = null;
    let profileName: string | null = null;
    let profileColor: string | null = null;
    let sessionId: number | null = null;
    let sessionName: string | null = null;

    if (typeof body.session_id === 'number') {
      sessionId = body.session_id;
      const s = db.prepare('SELECT name, profile_id FROM sessions WHERE id = ?').get(sessionId) as { name: string; profile_id: number | null } | undefined;
      if (s) {
        sessionName = s.name;
        profileId = s.profile_id;
      }
    } else if (typeof body.profile_id === 'number') {
      profileId = body.profile_id;
    }

    if (profileId) {
      const p = db.prepare('SELECT name, color FROM profiles WHERE id = ?').get(profileId) as { name: string; color: string } | undefined;
      if (p) { profileName = p.name; profileColor = p.color; }
    }

    db.prepare(`
      INSERT INTO connection_history
        (host, port, username, jump_host, profile_id, session_id,
         profile_name_snapshot, profile_color_snapshot, session_name_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(host!, port!, username || null, jumpHost || null, profileId, sessionId, profileName, profileColor, sessionName);

    // Trim to last 500 entries to keep the table bounded
    db.prepare(`
      DELETE FROM connection_history WHERE id IN (
        SELECT id FROM connection_history ORDER BY connected_at DESC LIMIT -1 OFFSET 500
      )
    `).run();
  } catch (e) {
    console.warn('Failed to write history entry:', e);
  }

  // Surface whether this connection uses password auth so the UI can offer
  // to set up key-based auth as a follow-up.
  let isPasswordAuth = false;
  if (typeof body.session_id === 'number') {
    const s = db.prepare('SELECT p.auth_type FROM sessions s LEFT JOIN profiles p ON s.profile_id = p.id WHERE s.id = ?').get(body.session_id) as { auth_type?: string } | undefined;
    isPasswordAuth = s?.auth_type === 'password';
  } else if (typeof body.profile_id === 'number') {
    const p = db.prepare('SELECT auth_type FROM profiles WHERE id = ?').get(body.profile_id) as { auth_type?: string } | undefined;
    isPasswordAuth = p?.auth_type === 'password';
  }

  return NextResponse.json({ ok: true, command: result.display, password_auth: isPasswordAuth });
}
