// GET   → status + preview
// POST  → { action: "sync" | "remove" }
//
// "sync"   regenerates the managed block from the current DB and writes it.
// "remove" strips the managed block, leaving everything else intact.

import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin, assertSafeRead } from "@/lib/api-guard";
import { getSshConfigStatus, previewSshConfig, syncSshConfig, removeSshConfigBlock } from "@/lib/ssh-config-file";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const guard = assertSafeRead(req);
  if (guard) return guard;

  const status = getSshConfigStatus();
  const preview = previewSshConfig();
  return NextResponse.json({
    ...status,
    preview: preview.block,
    previewHostCount: preview.hostCount,
  });
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const action = body && typeof body.action === "string" ? body.action : "sync";

  if (action === "sync") {
    const result = syncSshConfig();
    audit({
      event: "ssh_config.sync",
      target_type: "file",
      target_label: result.path,
      details: { action: result.action, hostCount: result.hostCount, fileExisted: result.fileExisted },
    });
    return NextResponse.json(result);
  }

  if (action === "remove") {
    const result = removeSshConfigBlock();
    audit({
      event: "ssh_config.remove",
      target_type: "file",
      target_label: result.path,
      details: { action: result.action },
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
