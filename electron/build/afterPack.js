// electron-builder afterPack hook.
//
// Runs once per arch electron-builder is building. Two responsibilities:
//
//   1. Strip the cross-arch SWC binary that prepare-runtime.mjs staged.
//      `scripts/prepare-runtime.mjs` puts BOTH `@next/swc-darwin-x64` and
//      `@next/swc-darwin-arm64` into `.build-runtime/node_modules/`,
//      because the GitHub Actions macOS runner's single `npm ci` only
//      pulls the runner's own-arch optional dep — leaving the cross-arch
//      `.dmg` with no loadable Next.js SWC binary. Each per-arch `.app`
//      only needs ONE of those (~115 MB unpacked); we delete the other
//      so the `.dmg` stays at native size.
//
//   2. Rebuild the native Node modules in the runtime tree against
//      Electron's Node ABI for THIS arch. `.build-runtime/node_modules/`
//      gets copied verbatim into `Contents/Resources/app/node_modules/`
//      as `extraResources` — which bypasses electron-builder's normal
//      `npmRebuild` hook. The `.node` files it contains were compiled by
//      `npm ci` against the CI runner's Node ABI (currently NODE_MODULE_
//      VERSION 115 = Node 20), but the Next server child runs under
//      Electron's bundled Node (NODE_MODULE_VERSION 145 for Electron 41).
//      Mismatch → `require('better-sqlite3')` fails with ERR_DLOPEN_FAILED
//      → bundled server crashes → app boots with no window. We re-invoke
//      `@electron/rebuild` directly against the staged tree for the
//      target arch + Electron version.

const path = require('node:path');
const fs = require('node:fs');

const ARCH_NAME = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

// Only modules that ship a compiled `.node` need rebuilding. Listing them
// explicitly stops `@electron/rebuild` from walking the whole tree and
// hitting non-native packages it doesn't need to touch.
const NATIVE_MODULES = ['better-sqlite3', 'keytar', 'node-pty'];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const arch = ARCH_NAME[context.arch];
  if (arch !== 'x64' && arch !== 'arm64') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const runtimeTreeRoot = path.join(appPath, 'Contents', 'Resources', 'app');

  // --- 1. Strip the cross-arch SWC package -----------------------------
  const otherArch = arch === 'x64' ? 'arm64' : 'x64';
  const swcDir = path.join(runtimeTreeRoot, 'node_modules', '@next', `swc-darwin-${otherArch}`);

  if (fs.existsSync(swcDir)) {
    fs.rmSync(swcDir, { recursive: true, force: true });
    console.log(`[afterPack] removed cross-arch SWC package: @next/swc-darwin-${otherArch} (arch=${arch})`);
  } else {
    console.log(`[afterPack] no cross-arch SWC to remove at ${swcDir}`);
  }

  // --- 2. Rebuild native modules against Electron's ABI ----------------
  const projectRoot = context.packager.info.projectDir;
  const electronPkgPath = path.join(projectRoot, 'node_modules', 'electron', 'package.json');
  const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;

  // Sanity-check: every native module we plan to rebuild should be present
  // in the staged tree. If one is missing, that's a packaging error
  // upstream worth surfacing now instead of crashing at user launch.
  const presentModules = NATIVE_MODULES.filter((m) =>
    fs.existsSync(path.join(runtimeTreeRoot, 'node_modules', m, 'package.json')),
  );
  const missing = NATIVE_MODULES.filter((m) => !presentModules.includes(m));
  if (missing.length) {
    console.warn(`[afterPack] native modules missing from runtime tree: ${missing.join(', ')}`);
  }
  if (presentModules.length === 0) {
    console.log(`[afterPack] no native modules to rebuild — skipping`);
    return;
  }

  console.log(`[afterPack] rebuilding ${presentModules.join(', ')} for arch=${arch}, electron=${electronVersion}`);
  const { rebuild } = require('@electron/rebuild');
  await rebuild({
    buildPath: runtimeTreeRoot,
    electronVersion,
    arch,
    onlyModules: presentModules,
    force: true,
  });
  console.log(`[afterPack] native module rebuild complete`);
};
