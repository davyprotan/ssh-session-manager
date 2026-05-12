// Internal liveness probe — main.js uses this to verify that the next-server
// listening on port 3005 was spawned by THIS Electron launch (and therefore
// holds THIS launch's SSH_MANAGER_INTERNAL_TOKEN). If the token doesn't match
// (e.g. an orphaned server from a previous launch that didn't shut down
// cleanly), assertInternal returns 403 here, main.js kills the orphan, and
// starts a fresh server.

import { NextRequest, NextResponse } from "next/server";
import { assertInternal } from "@/lib/api-guard";

export async function GET(req: NextRequest) {
  const guard = assertInternal(req);
  if (guard) return guard;
  return NextResponse.json({ ok: true, pid: process.pid });
}
