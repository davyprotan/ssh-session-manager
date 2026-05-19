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

import {
  copyFileSync,
  cpSync,
  readFileSync,
  rmSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

// 3. Force-install BOTH macOS SWC binaries on the macOS runner.
//
// Next.js publishes its native SWC compiler as platform-specific
// optionalDependencies (`@next/swc-darwin-x64`, `@next/swc-darwin-arm64`,
// …). `npm ci` on the macOS runner installs only the runner's own arch.
// electron-builder then packages the same node_modules tree into BOTH
// the x64 and arm64 .dmgs — so the cross-arch dmg ships without a
// loadable SWC binary and `next start` crashes immediately on launch
// with "Failed to load SWC binary for darwin/<other-arch>".
//
// Fix: after the prune, fetch both arch binaries at the exact Next
// version. We can't run two `npm install` calls against the runtime
// tree directly: npm normalizes optional deps to the `--cpu` we pass,
// so the second install prunes the first arch back out. Instead, do
// each install into a throwaway scratch dir and copy just the
// `@next/swc-darwin-<cpu>/` package into the runtime tree. End result:
// both .dmgs contain both binaries and each boots on its target arch.
// Windows is unaffected — we only build win32-x64, which the Windows
// runner installs natively.
if (process.platform === 'darwin') {
  const nextPkg = JSON.parse(
    readFileSync(join(RUNTIME_DIR, 'node_modules/next/package.json'), 'utf8'),
  );
  const nextVersion = nextPkg.version;
  for (const cpu of ['x64', 'arm64']) {
    console.log(`\nFetching @next/swc-darwin-${cpu}@${nextVersion}…`);
    const scratch = mkdtempSync(join(tmpdir(), `swc-${cpu}-`));
    try {
      execSync(
        `npm install --prefix="${scratch}" --no-save --no-package-lock ` +
          `--ignore-scripts --force --cpu=${cpu} --os=darwin ` +
          `@next/swc-darwin-${cpu}@${nextVersion}`,
        { stdio: 'inherit' },
      );
      const src = join(scratch, 'node_modules', '@next', `swc-darwin-${cpu}`);
      const dest = join(RUNTIME_DIR, 'node_modules', '@next', `swc-darwin-${cpu}`);
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(join(RUNTIME_DIR, 'node_modules', '@next'), { recursive: true });
      cpSync(src, dest, { recursive: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

console.log(`\nRuntime artifacts ready:`);
console.log(`  next-runtime-package.json`);
console.log(`  ${RUNTIME_DIR}/node_modules/`);
