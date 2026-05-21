// Internal-only endpoint for the built-in terminal's "Quick Connect" path
// where there's no saved session yet. Takes host + profile_id + optional
// port/jump_host (same body as /api/connect), validates via buildSshArgs,
// and returns the argv. The renderer never has the internal token, so this
// route is unreachable from the browser.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildSshArgs } from "@/lib/ssh-command";
import { assertInternal } from "@/lib/api-guard";

interface ProfileRow {
  id: number;
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

export async function POST(req: NextRequest) {
  const guard = assertInternal(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  const profileId = Number.isInteger(body.profile_id) ? body.profile_id : parseInt(String(body.profile_id));
  const requestedPort = Number.isInteger(body.port) ? body.port : parseInt(String(body.port));
  const jumpHost = typeof body.jump_host === "string" ? body.jump_host : "";

  if (!host) return NextResponse.json({ error: "host required" }, { status: 400 });
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return NextResponse.json({ error: "valid profile_id required" }, { status: 400 });
  }

  const db = getDb();
  const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(profileId) as ProfileRow | undefined;
  if (!profile) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : (profile.port || 22);

  const result = buildSshArgs({
    host,
    port,
    username: profile.username || "",
    keyPath: (profile.auth_type === "key" || profile.auth_type === "key_with_passphrase")
      ? (profile.key_path || "")
      : "",
    jumpHost,
    agentForwarding: !!profile.agent_forwarding,
    compression: !!profile.compression,
    serverAliveInterval: profile.server_alive_interval || 0,
    extraArgs: profile.extra_args || "",
    compatLegacy: !!profile.compat_legacy,
    authType: (profile.auth_type as "key" | "key_with_passphrase" | "password" | undefined) ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ error: `refused: ${result.error}` }, { status: 400 });
  }

  return NextResponse.json({
    argv: result.argv,
    display: result.display,
    sessionLabel: host,         // no saved session, so the host is the label
    sessionId: null,
    profileId: profile.id,
    profileAuthType: profile.auth_type,
  });
}
