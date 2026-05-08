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
import { rateLimit } from "@/lib/rate-limit";

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 8000;

// Block cloud-instance metadata services and obvious link-local probes. The
// probe endpoint exists to test SSH reachability of saved hosts, not to scan
// link-local IMDS endpoints. See:
//   AWS:   169.254.169.254  / fd00:ec2::254
//   GCP:   metadata.google.internal / 169.254.169.254
//   Azure: 169.254.169.254
//   IBM:   169.254.169.254
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
]);

function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  // Any 169.254.x.x literal (covers 169.254.169.254 and other link-local junk)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // AWS IPv6 IMDS
  if (lower === "fd00:ec2::254" || lower === "[fd00:ec2::254]") return true;
  return false;
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  // 60 probes / minute is plenty for the UI's quick-connect flow and makes
  // any scripted port-scan loud (and bounded).
  const rl = rateLimit("probe", 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many probes. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  if (!host || !HOST_RE.test(host) || host.length > 253) {
    return NextResponse.json({ error: "invalid host" }, { status: 400 });
  }
  if (isBlockedHost(host)) {
    return NextResponse.json({ error: "host is not probeable" }, { status: 400 });
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
