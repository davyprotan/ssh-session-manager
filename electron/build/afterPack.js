// electron-builder afterPack hook.
//
// `scripts/prepare-runtime.mjs` stages BOTH macOS SWC binaries
// (`@next/swc-darwin-x64` and `@next/swc-darwin-arm64`) into
// `.build-runtime/node_modules/`, because the GitHub Actions macOS runner
// only installs the runner's own arch via `npm ci` — leaving the
// cross-arch `.dmg` with no loadable Next.js SWC binary.
//
// Once electron-builder has packaged a per-arch `.app`, we know which arch
// it's for and can delete the OTHER arch's SWC package. This keeps each
// `.dmg` at its native size (the SWC binary is ~115 MB unpacked, so
// shipping both would nearly double the disk footprint of the bundled
// `node_modules/`).
//
// Runs once per arch electron-builder is building.

const path = require('node:path');
const { rmSync, existsSync } = require('node:fs');

const ARCH_NAME = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const arch = ARCH_NAME[context.arch];
  if (arch !== 'x64' && arch !== 'arm64') return;

  const otherArch = arch === 'x64' ? 'arm64' : 'x64';
  const swcDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app',
    'node_modules',
    '@next',
    `swc-darwin-${otherArch}`,
  );

  if (existsSync(swcDir)) {
    rmSync(swcDir, { recursive: true, force: true });
    console.log(`[afterPack] removed cross-arch SWC package: @next/swc-darwin-${otherArch} (arch=${arch})`);
  } else {
    console.log(`[afterPack] no cross-arch SWC to remove at ${swcDir}`);
  }
};
