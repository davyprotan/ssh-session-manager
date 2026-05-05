import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { deleteBackupFile } from "@/lib/backup";

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;
  const body = await req.json().catch(() => ({}));
  const filename = typeof body.filename === "string" ? body.filename : null;
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });
  try {
    deleteBackupFile(filename);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 400 });
  }
}
