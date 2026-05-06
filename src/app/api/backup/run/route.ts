import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { writeBackupFile } from "@/lib/backup";

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" && body.password.length > 0 ? body.password : undefined;
  const includeSecrets = !!body.include_secrets;

  // Encrypted backups always include secrets; otherwise only when explicitly requested.
  const effective = password ? true : includeSecrets;

  if (!password && includeSecrets) {
    // Allowed but warn — caller is responsible.
  }
  if (password && password.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }

  try {
    const result = await writeBackupFile({ password, includeSecrets: effective });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "backup failed" }, { status: 500 });
  }
}
