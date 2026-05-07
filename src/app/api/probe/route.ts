// Lightweight TCP-connect probe used by Quick Connect to confirm a host is
// reachable BEFORE asking the user to pick a profile.
//
// Why on the server side: the renderer can't open arbitrary TCP sockets
// (browser sandbox), so we do this in the Next.js server which already runs
// on 127.0.0.1. Origin-guarded — renderer-only, no internal token needed.
//
// What it does:
//   - net.connect(port, host) with a 3-second timeout
//   - If the connection opens, optionally wait briefly for the SSH banner so
//     we can confirm "looks like SSH on the other end"
//   - Returns { reachable, latencyMs, banner?, error? }
//
// What it does NOT do:
//   - Validate ssh keys, run any auth, send any data the user didn't ask for
//   - Bypass the host-character allowlist — same regex as the SSH builder

import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { probeTcp } from "@/lib/probe";

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  if (!host || !HOST_RE.test(host) || host.length > 253) {
    return NextResponse.json({ error: "invalid host" }, { status: 400 });
  }

  const portRaw = body.port;
  const port = Number.isInteger(portRaw) ? portRaw : parseInt(String(portRaw || 22));
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "invalid port" }, { status: 400 });
  }

  const reqTimeout = Number.isFinite(Number(body.timeoutMs))
    ? Math.min(MAX_TIMEOUT_MS, Math.max(500, Number(body.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;

  const result = await probeTcp(host, port, { timeoutMs: reqTimeout });
  return NextResponse.json(result);
}
