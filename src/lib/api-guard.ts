// API security guard:
// 1. Reject requests whose Origin/Referer don't match our local origin
//    (defends against drive-by CSRF from any browser on the user's machine)
// 2. Optional per-launch token check (Electron sets API_TOKEN env var)
//
// All API mutation routes should call assertSafeOrigin(req).

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3005",
  "http://localhost:3005",
]);

const TOKEN = process.env.API_TOKEN || "";

export function assertSafeOrigin(req: NextRequest): NextResponse | null {
  // 1) Origin/Referer check — blocks any web page from another origin POSTing here
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  // For state-changing methods, require an allowed Origin or Referer
  const method = req.method.toUpperCase();
  const isMutation = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";

  if (isMutation) {
    const validOrigin = origin && ALLOWED_ORIGINS.has(origin);
    const validReferer = referer && Array.from(ALLOWED_ORIGINS).some(o => referer.startsWith(o + "/") || referer === o + "/" || referer === o);
    if (!validOrigin && !validReferer) {
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

/** For sensitive READ endpoints (export). Same rules as mutations. */
export function assertSafeRead(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const validOrigin = origin && ALLOWED_ORIGINS.has(origin);
  const validReferer = referer && Array.from(ALLOWED_ORIGINS).some(o => referer.startsWith(o + "/") || referer === o);
  if (!validOrigin && !validReferer) {
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
