import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { generateKey } from "@/lib/ssh-keygen";

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : null;
  const comment = typeof body.comment === "string" ? body.comment : undefined;
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : undefined;

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const result = await generateKey({ name, comment, passphrase });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ssh-keygen failed" }, { status: 500 });
  }
}
