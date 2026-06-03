import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { execFile, execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, unlink } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
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
  compat_legacy?: number;
}

interface SessionRow {
  id?: number;
  host: string;
  port: number;
  jump_host?: string;
  profile_id?: number;
}

const PTY_EXHAUSTED_MESSAGE =
  'macOS cannot allocate a new pseudo-terminal right now. This is the same system state that makes Terminal show "[forkpty: Device not configured]". Quit unused terminal windows; if it persists, restart macOS to reset the pty device table.';

function canAllocatePty() {
  if (process.platform !== 'darwin') return true;
  try {
    execFileSync('script', ['-q', '/dev/null', '/usr/bin/true'], {
      stdio: 'ignore',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
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
  let compatLegacy = 0;
  let authType: 'key' | 'key_with_passphrase' | 'password' | '' = '';

  if (typeof body.session_id === 'number') {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(body.session_id) as SessionRow | undefined;
    if (!session) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

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
        compatLegacy = profile.compat_legacy || 0;
        authType = (profile.auth_type as typeof authType) || '';
      }
    }

    db.prepare(`UPDATE sessions SET last_connected_at = datetime('now') WHERE id = ?`).run(body.session_id);
  } else if (typeof body.host === 'string' && typeof body.profile_id === 'number') {
    const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(body.profile_id) as ProfileRow | undefined;
    if (!profile) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

    host = String(body.host);
    const requestedPort = Number(body.port) || profile.port || 22;
    port = requestedPort;
    username = profile.username;
    keyPath = (profile.auth_type === 'key' || profile.auth_type === 'key_with_passphrase') ? (profile.key_path || '') : '';
    agentForwarding = profile.agent_forwarding || 0;
    compression = profile.compression || 0;
    serverAliveInterval = profile.server_alive_interval || 0;
    extraArgs = profile.extra_args || '';
    compatLegacy = profile.compat_legacy || 0;
    authType = (profile.auth_type as typeof authType) || '';
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
    compatLegacy: !!compatLegacy,
    authType,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `Refused to connect: ${result.error}` }, { status: 400 });
  }

  if (!canAllocatePty()) {
    return NextResponse.json({ error: PTY_EXHAUSTED_MESSAGE }, { status: 503 });
  }

  // Build the shell command. Each argv element is properly single-quoted.
  // single-quote escape: replace ' with '\''
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const sshCmd = `ssh ${result.argv.map(sq).join(' ')}`;

  // ── How the command reaches each terminal app ──────────────────────────
  // We do NOT script iTerm's window API. `create window with default profile`
  // (with or without a `command`) proved unreliable in the field: on some
  // profiles the session dies the instant it's created, `create window`
  // returns `missing value` so there's no handle to write into, and iTerm's
  // `command` tokenizer mangles quoted arguments. The net effect was a window
  // that opened and closed instantly, or opened blank.
  //
  // Instead we use the mechanism macOS itself uses for "run this in a
  // terminal": an executable `.command` file launched with `open`. iTerm (and
  // Terminal) open a `.command` file by running it in a fresh session — no
  // window scripting, no argument tokenizing, no session handle needed. The
  // script runs ssh and then `exec`s an interactive login shell so the window
  // stays open for the user to read any error. It holds no secret (ssh prompts
  // for the password interactively) and deletes itself on first run.
  //
  // It lives under ~/.ssh-manager/ rather than os.tmpdir(): /var/folders/…
  // temp paths can be unreadable by a separate process like iTerm, whereas a
  // home-relative path is always readable by the same user.
  let commandFile = '';
  try {
    const dir = join(homedir(), '.ssh-manager');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    commandFile = join(dir, `launch-${randomBytes(8).toString('hex')}.command`);
    const scriptBody =
      `#!/bin/sh\n` +
      `rm -f "$0"\n` +
      `${sshCmd}\n` +
      `printf '%s\\n' "── ssh exited (status $?) — you are now in a shell ──"\n` +
      `exec "\${SHELL:-/bin/zsh}" -il\n`;
    writeFileSync(commandFile, scriptBody, { mode: 0o700 });
    // Belt-and-suspenders cleanup if the file is never opened. It self-deletes
    // on run, so this is a no-op on the happy path.
    setTimeout(() => unlink(commandFile, () => {}), 30000);
  } catch (e) {
    console.warn('could not stage terminal launch script:', e instanceof Error ? e.message : String(e));
    commandFile = '';
  }

  if (commandFile) {
    // Prefer iTerm if it's installed; fall back to the user's default terminal.
    // `open -a iTerm <file>` launches iTerm and runs the .command file; if iTerm
    // isn't present, `open` (no -a) routes to whatever the user's default
    // terminal is. We try iTerm first and fall back on failure.
    execFile('open', ['-a', 'iTerm', commandFile], (err) => {
      if (err) {
        execFile('open', [commandFile], (err2) => {
          if (err2) console.error('failed to open terminal:', err2);
        });
      }
    });
  }

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
