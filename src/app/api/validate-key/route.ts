import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';

export async function POST(req: NextRequest) {
  const { path: keyPath } = await req.json();
  if (!keyPath || typeof keyPath !== 'string') {
    return NextResponse.json({ exists: false, error: 'path required' });
  }

  // Expand ~ to home directory
  const expanded = keyPath.replace(/^~/, os.homedir());

  try {
    const stat = fs.statSync(expanded);
    return NextResponse.json({
      exists: true,
      path: expanded,
      size: stat.size,
      mode: (stat.mode & 0o777).toString(8),
    });
  } catch {
    return NextResponse.json({ exists: false, path: expanded });
  }
}
