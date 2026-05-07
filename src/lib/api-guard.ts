// API security guard:
// 1. Reject requests whose Origin/Referer don't match our local origin
//    (defends against drive-by CSRF from any browser on the user's machine)
// 2. Optional per-launch token check (Electron sets API_TOKEN env var)
// 3. Internal-only routes that ONLY the Electron main process can call —
//    guarded by a per-launch random token that never reaches the renderer
//    (set via SSH_MANAGER_INTERNAL_TOKEN env var by main.js).
//
// All API mutation routes should call assertSafeOrigin(req).

import { NextRequest, NextResponse } from "next/server";

// All loopback origins we accept. Origins are compared lowercased so headers
// from clients that uppercase the scheme/host still match.
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3005",
  "http://localhost:3005",
  "http://[::1]:3005",
]);

const TOKEN = process.env.API_TOKEN || "";
const INTERNAL_TOKEN = process.env.SSH_MANAGER_INTERNAL_TOKEN || "";

function originMatches(value: string | null): boolean {
  if (!value) return false;
  return ALLOWED_ORIGINS.has(value.toLowerCase());
}

function refererMatches(value: string | null): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  for (const o of ALLOWED_ORIGINS) {
    if (v === o || v === o + "/" || v.startsWith(o + "/")) return true;
  }
  return false;
}

export function assertSafeOrigin(req: NextRequest): NextResponse | null {
  // 1) Origin/Referer check — blocks any web page from another origin POSTing here
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  // For state-changing methods, require an allowed Origin or Referer
  const method = req.method.toUpperCase();
  const isMutation = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";

  if (isMutation) {
    if (!originMatches(origin) && !refererMatches(referer)) {
      return NextResponse.json({ error: "Forbidden: bad origin" }, { status: 403 });
    }
  }

  // 2) Token check (optional — only enforced when API_TOKEN env is set)
  if (TOKEN) {
    const supplied = req.headers.get("x-api-token");
    if (supplied !== TOKEN) {
      return NextResponse.json({ error: "Forbidden: bad token" }, { status: 403 });
    }
  }

  return null;
}

/**
 * For routes that are ONLY callable by the Electron main process (e.g. the
 * pty spawn-plan endpoint). Requires a per-launch random token in the
 * `x-internal-token` header that matches `SSH_MANAGER_INTERNAL_TOKEN`. The
 * renderer never sees this token, so it cannot reach internal routes even
 * if the renderer is compromised.
 *
 * If the env var isn't set (e.g. running `npm run dev` without Electron),
 * the route is unreachable — that's intentional, fail closed.
 */
export function assertInternal(req: NextRequest): NextResponse | null {
  if (!INTERNAL_TOKEN) {
    return NextResponse.json({ error: "Internal route unavailable" }, { status: 503 });
  }
  const supplied = req.headers.get("x-internal-token");
  // Constant-time-ish compare to avoid leaking whether the lengths match.
  if (!supplied || supplied.length !== INTERNAL_TOKEN.length) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let mismatch = 0;
  for (let i = 0; i < supplied.length; i++) {
    mismatch |= supplied.charCodeAt(i) ^ INTERNAL_TOKEN.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** For sensitive READ endpoints (export). Same rules as mutations. */
export function assertSafeRead(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!originMatches(origin) && !refererMatches(referer)) {
    return NextResponse.json({ error: "Forbidden: bad origin" }, { status: 403 });
  }
  if (TOKEN) {
    const supplied = req.headers.get("x-api-token");
    if (supplied !== TOKEN) {
      return NextResponse.json({ error: "Forbidden: bad token" }, { status: 403 });
    }
  }
  return null;
}
