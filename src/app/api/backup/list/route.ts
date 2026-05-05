import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import { listBackups, getBackupsDir } from "@/lib/backup";

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;
  return NextResponse.json({
    dir: getBackupsDir(),
    backups: listBackups(),
  });
}
