// Internal-only endpoint. The Electron main process calls this to obtain a
// validated argv to pass to node-pty. The renderer never has the internal
// token, so this route is unreachable from the browser.
//
// Returns the same shape used by /api/connect's spawn step, minus the
// AppleScript wrapping.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildSshArgs } from "@/lib/ssh-command";
import { assertInternal } from "@/lib/api-guard";

interface ProfileRow {
  id: number;
  username: string;
  auth_type: string;
  key_path?: string;
  agent_forwarding: number;
  compression: number;
  server_alive_interval: number;
  extra_args?: string;
  compat_legacy?: number;
}

interface SessionRow {
  id: number;
  name: string;
  host: string;
  port: number;
  jump_host?: string;
  profile_id?: number;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertInternal(req);
  if (guard) return guard;

  const { id } = await params;
  const sessionId = parseInt(id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getDb();
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
  if (!session) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  let profile: ProfileRow | undefined;
  if (session.profile_id) {
    profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(session.profile_id) as ProfileRow | undefined;
  }

  const result = buildSshArgs({
    host: session.host,
    port: session.port || 22,
    username: profile?.username || "",
    keyPath:
      profile && (profile.auth_type === "key" || profile.auth_type === "key_with_passphrase")
        ? (profile.key_path || "")
        : "",
    jumpHost: session.jump_host || "",
    agentForwarding: !!profile?.agent_forwarding,
    compression: !!profile?.compression,
    serverAliveInterval: profile?.server_alive_interval || 0,
    extraArgs: profile?.extra_args || "",
    compatLegacy: !!profile?.compat_legacy,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `refused: ${result.error}` }, { status: 400 });
  }

  return NextResponse.json({
    argv: result.argv,
    display: result.display,
    sessionLabel: session.name,
    sessionId: session.id,
    profileId: profile?.id ?? null,
    profileAuthType: profile?.auth_type ?? null,
    // Phase-2 hint: does this profile have a stored secret we *could* inject?
    profileHasSecret: !!profile && (profile.auth_type === "password" || profile.auth_type === "key_with_passphrase"),
  });
}
