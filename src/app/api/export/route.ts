import { NextRequest, NextResponse } from "next/server";
import { assertSafeRead } from "@/lib/api-guard";
import { buildExportPayload } from "@/lib/backup";
import { encryptPayload } from "@/lib/backup-crypto";
import { audit } from "@/lib/audit";

// GET → unencrypted, no secrets (safe default for browser-triggered downloads)
export async function GET(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  const payload = await buildExportPayload(false);
  audit({ event: "backup.export", details: { encrypted: false, includeSecrets: false, source: "GET" } });
  return jsonAttachment(payload, "ssh-manager-backup", false, false);
}

// POST { include_secrets?: bool, password?: string }
//   - include_secrets=true: pulls keychain plaintext into the payload
//   - password: encrypts the payload (AES-256-GCM with scrypt KDF). Implies include_secrets.
export async function POST(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" && body.password.length > 0 ? body.password : undefined;
  const includeSecrets = !!body.include_secrets || !!password;

  if (password && password.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }

  const payload = await buildExportPayload(includeSecrets);

  if (password) {
    const env = await encryptPayload(payload, password);
    audit({ event: "backup.export", details: { encrypted: true, includeSecrets: true, source: "POST" } });
    return jsonAttachment(env, "ssh-manager-backup", true, true);
  }
  audit({ event: "backup.export", details: { encrypted: false, includeSecrets, source: "POST" } });
  return jsonAttachment(payload, "ssh-manager-backup", false, includeSecrets);
}

function jsonAttachment(obj: unknown, baseName: string, encrypted: boolean, hasSecrets: boolean) {
  const date = new Date().toISOString().split("T")[0];
  const suffix = encrypted ? ".encrypted" : (hasSecrets ? ".with-secrets" : "");
  const filename = `${baseName}-${date}${suffix}.json`;
  return new NextResponse(JSON.stringify(obj, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
