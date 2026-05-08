import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertSafeOrigin } from '@/lib/api-guard';

const SSH_DIR = path.join(os.homedir(), '.ssh');

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const keyPath = body && typeof body.path === 'string' ? body.path : null;
  if (!keyPath) return NextResponse.json({ exists: false, error: 'path required' });

  // Reject metacharacters before doing anything with the path
  if (/[;|&<>$`"\n\r]/.test(keyPath)) {
    return NextResponse.json({ exists: false, error: 'invalid path' });
  }

  const expanded = path.resolve(keyPath.replace(/^~(?=\/|$)/, os.homedir()));

  // Restrict to ~/.ssh by default — file existence checks elsewhere can leak info
  if (!expanded.startsWith(SSH_DIR + path.sep) && expanded !== SSH_DIR) {
    return NextResponse.json({ exists: false, error: 'only paths inside ~/.ssh are checked' });
  }

  try {
    const stat = fs.statSync(expanded);
    if (!stat.isFile()) return NextResponse.json({ exists: false });
    // Re-check against the symlink-resolved real path. Without this, a symlink
    // under ~/.ssh/ that points outside (e.g. to /etc/passwd) would still be
    // reported as existing — handing an attacker a same-machine file-existence
    // oracle for any path the user can read.
    const real = fs.realpathSync(expanded);
    if (!real.startsWith(SSH_DIR + path.sep) && real !== SSH_DIR) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: true });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
