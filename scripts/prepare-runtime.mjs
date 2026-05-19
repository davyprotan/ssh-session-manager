// Prepares two artifacts that electron-builder's extraResources reads
// when packaging:
//
//   1. next-runtime-package.json — a verbatim copy of package.json, under
//      a name that doesn't collide with electron-builder's asar dedup
//      logic (see electron-builder#4160).
//
//   2. .build-runtime/node_modules/ — a production-only copy of the
//      project's node_modules. The Next.js child process that
//      electron/main.js spawns at runtime resolves `next start` and
//      friends from this tree; bundling the full dev tree (which
//      includes @typescript-eslint, vitest, tailwindcss, …) exhausts
//      macOS's per-process file-descriptor cap during code-signing.
//      Pruning dev deps eliminates the EMFILE crash AND dramatically
//      shrinks the final dmg.
//
// Both artifacts are gitignored. Re-runs are idempotent.

import { copyFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const RUNTIME_DIR = '.build-runtime';

// 1. Rename-copy package.json
copyFileSync('package.json', 'next-runtime-package.json');

// 2. Stage a prod-only node_modules
rmSync(RUNTIME_DIR, { recursive: true, force: true });
mkdirSync(RUNTIME_DIR, { recursive: true });

// Copy the existing node_modules tree (much faster than re-resolving via
// npm install — we're just pruning, not reinstalling).
cpSync('node_modules', join(RUNTIME_DIR, 'node_modules'), { recursive: true });
copyFileSync('package.json', join(RUNTIME_DIR, 'package.json'));
if (existsSync('package-lock.json')) {
  copyFileSync('package-lock.json', join(RUNTIME_DIR, 'package-lock.json'));
}

// Drop everything not declared in `dependencies`. We use --ignore-scripts
// to avoid re-running native module postinstall hooks (keytar, node-pty,
// better-sqlite3) — their already-built .node files come along via cpSync.
execSync('npm prune --omit=dev --ignore-scripts', {
  cwd: RUNTIME_DIR,
  stdio: 'inherit',
});

console.log(`\nRuntime artifacts ready:`);
console.log(`  next-runtime-package.json`);
console.log(`  ${RUNTIME_DIR}/node_modules/`);
