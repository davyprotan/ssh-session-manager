// Internal-only endpoint, gated by the per-launch SSH_MANAGER_INTERNAL_TOKEN
// that is never sent to the renderer. The Electron main process calls this
// to pull a stored password/passphrase from the OS keychain on demand for
// auto-injection into a pty.
//
// Why a separate route from /api/profiles/[id]/secret (which is renderer-
// callable for the password reveal flow): different auth model, different
// audit category. The renderer endpoint is origin-guarded; this one is
// internal-token-guarded so even a renderer compromise can't pull secrets
// for arbitrary profiles unprompted.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPassword as kcGet } from "@/lib/keychain";
import { assertInternal } from "@/lib/api-guard";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = assertInternal(req);
  if (guard) return guard;

  const { id } = await params;
  const idNum = parseInt(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare("SELECT name, password, uses_keychain FROM profiles WHERE id = ?").get(idNum) as
    | { name: string; password: string | null; uses_keychain: number }
    | undefined;
  if (!row) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  let secret: string | null = null;
  if (row.uses_keychain) {
    secret = await kcGet(idNum);
  } else {
    // Plain-fallback was removed in v0.8.0 for new profiles, but legacy rows
    // could in theory exist. Read whatever's there.
    secret = row.password;
  }

  audit({
    event: "terminal.password_fetched",
    target_type: "profile",
    target_id: idNum,
    target_label: row.name,
    details: { source: row.uses_keychain ? "keychain" : "db" },
  });

  return NextResponse.json({ password: secret });
}
