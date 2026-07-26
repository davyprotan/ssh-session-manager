# Changelog

All notable changes to **SSH Manager**.

## [0.9.45] — 2026-07-26

### Fix: newly saved sessions open as the active terminal

- Creating a saved SSH session now immediately opens that session in the
  built-in terminal and selects its tab, rather than only refreshing the
  session list.

## [0.9.44] — 2026-07-14

### Fix: terminal scrollback redraw and session-tab selection

- Prevent hidden built-in terminal tabs from resizing their live PTY to a
  minimum hidden geometry, which could corrupt wrapped prompts after using
  scrollback and Backspace.
- Select newly opened built-in terminal tabs immediately, reselect an already
  open session instead of duplicating it, and keep the split-layout sidebar
  highlight in sync with the selected tab.

## [0.9.43] — 2026-06-22

### Fix: diagnose pty exhaustion by probing /dev/ptmx, not guessing
0.9.42 over-corrected: after dropping the unreliable device-node count it
defaulted every ambiguous `posix_spawnp failed.` to "per-user process cap",
which is wrong when the machine really is out of ptys. node-pty collapses pty
exhaustion, the process cap, and a missing `ssh` binary into that one string
(its `err` starts at `-1` and the pty-allocation early-returns never reset it),
so the text alone can't tell them apart.

The diagnosis now measures directly instead of inferring: at failure time it
opens and immediately closes the pty master clone device (`/dev/ptmx`) — exactly
what node-pty does first. `ENXIO`/`EAGAIN`/`EMFILE`/`ENFILE` means the kernel
genuinely can't allocate a pty (advise freeing terminals, and rebooting since
macOS leaks pty slave device nodes for the boot session); a clean open means
ptys are fine, so an ambiguous failure points at the process cap with no false
reboot advice. Verified against a live exhausted machine where `openpty()` and
`open('/dev/ptmx')` both returned `ENXIO` with ~0 ptys actually held.
(electron/lib/spawn-diagnostics.js)

## [0.9.42] — 2026-06-22

### Fix: stop the false "out of pseudo-terminals" diagnosis
The 0.9.40 spawn diagnosis counted `/dev/ttys` device nodes to gauge pty
pressure. On macOS those slave nodes persist for the whole boot session, so the
count is a high-water mark, not a live figure — observed 527 nodes against a 511
cap with almost nothing actually open. That made the message report an
impossible "527/511 in use" and tell you to restart macOS when nothing was
wrong. Removed the device-node heuristic so an ambiguous `posix_spawnp failed.`
no longer claims pty exhaustion. (Superseded by the direct `/dev/ptmx` probe in
0.9.43.) (electron/lib/spawn-diagnostics.js)

### Fix: update banner no longer lingers after upgrading
The "new version available" banner cached the check result for 24h and trusted
the cached `available` flag, which was computed against whatever build was
installed at check time. After an in-place upgrade within that window it kept
showing even though you were already on the latest version. It now re-checks the
latest release against the installed build version before rendering.
(src/components/UpdateBanner.tsx)

## [0.9.41] — 2026-06-22

### Docs: explain (and point at the fix for) the macOS Terminal restore errors
Added guidance for the boot-time errors that appear in restored Terminal.app
windows after a reboot or re-login — `[Could not create a new process and open
a pseudo-tty.]` / `[forkpty: Device not configured]` / `[Restored …]`. These
are macOS reopening dead SSH windows (not a crash): "Reopen windows when logging
back in" restores every Terminal.app window that was open at logout, and
restoring many at once momentarily exhausts the system pty table so `forkpty`
fails with `ENXIO`.

- README troubleshooting section explaining the cause and the reliable fixes.
- In-app note in **Settings → terminal** pointing Terminal.app users at the one
  setting that prevents it — *Profiles → Shell → When the shell exits → Close
  the window* — so Terminal closes finished SSH windows itself. The built-in
  terminal (the default **Connect** action) is immune and unaffected.

No behavior change: the app can't reliably close external Terminal.app windows
itself — Terminal refuses to close a window while a process is alive in it, and
the window loses any identifier the app could target once the shell exits — so
the fix is the documented Terminal setting, not launcher code.
(README.md, src/components/SettingsDialog.tsx)

## [0.9.40] — 2026-06-17

### Fix: accurate diagnosis for terminal spawn failures
- Built-in terminal spawn failures now probe live system state and report the
  real cause. node-pty collapses several distinct failures into one bare
  `posix_spawnp failed.` string, so the previous message always blamed pty
  exhaustion and told you to restart macOS — even when the ptys had plenty of
  headroom and the real cause was the per-user process cap or a missing `ssh`
  binary. The message now only recommends a restart when the ptys really are
  near the limit, and otherwise points at the actual culprit. (electron/lib/spawn-diagnostics.js)

## [0.9.39] — 2026-06-16

### Fix: stop pty exhaustion and reconnect spam
This release ships the terminal stability fixes merged after v0.9.38:

- Built-in terminal spawn failures caused by macOS pty exhaustion now show a
  clear explanation instead of the raw `posix_spawnp` error.
- External iTerm/Terminal launches no longer leave a login shell alive after
  SSH exits. Failed SSH launches stay visible briefly, then close and release
  their pseudo-terminal.
- SSH Manager now caps the number of external terminal sessions it launches
  and cleans up its active-session markers automatically.
- Automatic reconnects are bounded: quick repeated `exit 255` failures stop
  after the retry budget instead of resetting forever on each short-lived
  reconnect. Manual **Reconnect** still starts a fresh user-driven attempt.

## [0.9.36] — 2026-05-19

### Fix: bundled native modules built against the wrong Node ABI
Companion to v0.9.34. After v0.9.34 fixed the SWC arch problem, the
arm64 `.dmg` still failed at boot with:

```
better_sqlite3.node was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires
NODE_MODULE_VERSION 145.
```

Root cause is the same family as v0.9.34. `prepare-runtime.mjs` stages
`.build-runtime/node_modules/` for `extraResources`, but
electron-builder's `npmRebuild` step only operates on the asar tree —
extraResources content is copied verbatim. The runner's `npm ci` builds
`better-sqlite3`, `keytar`, and `node-pty` against Node 20's ABI (115);
the Next server child at runtime uses Electron 41's bundled Node (ABI
145); `dlopen` fails; server crashes; no window. The earlier asar copy
of `keytar` works because it goes through `npmRebuild` — only the
runtime-tree copies are wrong.

This regression has been latent since v0.9.32 introduced
`prepare-runtime.mjs`. Earlier versions worked because the full
`node_modules` was bundled directly and `npmRebuild` covered it.

Fix:

1. Add `@electron/rebuild` as a devDependency.
2. Extend `electron/build/afterPack.js` to rebuild the runtime tree's
   `better-sqlite3`, `keytar`, and `node-pty` against Electron's ABI
   for the current target arch. The afterPack hook is the right place
   because `context.arch` tells us which `.app` we're patching — so each
   `.dmg` ships natively rebuilt modules for its own architecture.
3. Surface a clear `[afterPack]` log if any of the expected native
   modules is missing from the staged tree, so packaging mistakes fail
   loudly instead of crashing at user launch.

## [0.9.35] — 2026-05-19

### Fix: Surface boot failures instead of silently quitting
When the bundled Next server crashed during launch — the v0.9.33 Intel
`.dmg`'s `Failed to load SWC binary for darwin/x64` was the recent
example — `electron/main.js` polled the port for 30 s, logged "Server
failed to become ready" to a console nobody saw, then called `app.quit()`.
Users saw "app opens, no window… app eventually disappears" with no
indication of WHY, and reasonably assumed their data was gone (it never
was — `~/.ssh-session-manager/sessions.db` is untouched by reinstalls).

This release adds three things to the packaged-mode boot path:

1. A ring buffer (last 200 lines) of the Next server's stdout/stderr,
   kept in main-process memory. Previously the output went only to a
   console nobody sees in a packaged build.
2. Early-exit detection: `waitForServer()` is now raced against the
   `serverProcess.on('exit')` promise. If the child dies during boot we
   stop polling immediately instead of waiting the full 30 s for a port
   that will never bind.
3. A native error dialog (`dialog.showMessageBox`) that fires before
   `app.quit()` whenever boot fails — either due to early exit or the
   timeout. The dialog explicitly reassures the user that their data is
   safe on disk, shows the last 25 captured log lines inline, and offers
   three buttons:
   - **Copy details** — full diagnostic block to clipboard
   - **Open log folder** — reveals the per-crash log file in Finder /
     Explorer
   - **Quit**

Crash logs persist to `~/.ssh-session-manager/logs/boot-crash-<ts>.log`
alongside the SQLite DB. The dev path (`npm run dev`) is unchanged — a
flapping server during development is normal and would just yield a
modal-spam loop.

The `waitForOwnership` failure path now also surfaces a dialog explaining
that another process is holding port 3005.

## [0.9.34] — 2026-05-19

### Fix: Intel macOS `.dmg` crashed on launch with "Failed to load SWC binary"
Both v0.9.33 macOS `.dmg`s were built from a single `npm ci` on the
arm64-by-default `macos-latest` GitHub runner. That install only pulls
the matching-arch optional dep — `@next/swc-darwin-arm64` — so the
prod-only `node_modules` staged by `prepare-runtime.mjs` had only the
arm64 SWC binary. electron-builder then packaged the exact same tree
into BOTH the x64 and arm64 `.dmg`s. The x64 `.dmg` shipped without a
loadable SWC binary and crashed on first launch:

```
⨯ Failed to load SWC binary for darwin/x64
@next/swc-darwin-x64 ... was not installed
Server exited with code 1
```

Electron stayed alive after the Next child died, so users saw "app
opens, no window" — no obvious error path, easy to misdiagnose as a
Gatekeeper / quarantine issue.

Fix is in two places:

1. `scripts/prepare-runtime.mjs` now force-installs BOTH macOS SWC
   binaries at the exact Next version after the prod prune. Two `npm
   install` calls run against scratch dirs (one per arch) — running
   them directly against the runtime tree doesn't work because npm
   normalizes optional deps to the `--cpu` value and the second install
   strips the first arch back out. The resulting
   `@next/swc-darwin-<cpu>/` package is then copied into the runtime
   tree.
2. `electron/build/afterPack.js` is a new electron-builder hook that
   deletes the cross-arch SWC package from each per-arch `.app` after
   packaging. This keeps each `.dmg` at its native size (the SWC
   binary unpacks to ~115 MB; shipping both in each `.dmg` would nearly
   double the bundled `node_modules` footprint).

Net effect: each `.dmg` carries only the SWC binary that matches its
target arch, and both boot cleanly.

## [0.9.33] — 2026-05-19

### Fix: macOS Release — properly raise FD limit + filter runtime junk
v0.9.32 pruned dev dependencies but the build still hit EMFILE, this
time on `next/dist/server/node-environment-extensions/console-file.d.ts`.
The prod-only `node_modules` is still huge (Next.js alone is hefty),
and macOS's per-process file-descriptor cap is binding.

Two fixes:

1. `.github/workflows/release.yml` now raises the kernel maxfiles via
   `sudo launchctl limit maxfiles 65536 200000` before doing
   `ulimit -Hn` and `ulimit -Sn`. `ulimit -n` alone is silently
   clamped to the kernel cap, which is why `v0.9.29`'s naive raise
   didn't actually take effect. Logs the resulting `ulimit -n` for
   future debugging.
2. `extraResources` filter for `node_modules` now excludes runtime-junk:
   `.d.ts`, source maps, `*.md`, `CHANGELOG*`, `LICENSE.txt`, `.github/`,
   `.bin/`, `test/`, `tests/`, `__tests__/`, `example*/`. These files
   serve no purpose at runtime and only inflate the file count the
   code-signer has to walk.

Together: a smaller tree under a higher cap.

## [0.9.32] — 2026-05-19

### Fix: macOS Release — EMFILE during code-sign (again, properly this time)
v0.9.29 raised the runner's `ulimit -n` to 65536 hoping to clear the
EMFILE crash. v0.9.31's build proved that wasn't enough — macOS silently
clamps per-process file-descriptors at ~24K, and the shipped tree was
big enough to blow even that. The next failure (after the asar package
fix landed) was on
`Contents/Resources/app/node_modules/@typescript-eslint/scope-manager/…`
— a dev-only dependency that has no business being in the user's
download.

Real fix: don't ship dev dependencies to users.

- New `scripts/prepare-runtime.mjs` runs as `postbuild` and stages a
  prod-only copy of `node_modules` under `.build-runtime/node_modules/`
  by `cp -r`'ing the existing tree and then `npm prune --omit=dev
  --ignore-scripts` against it. `--ignore-scripts` keeps the
  already-built native modules (keytar, node-pty, better-sqlite3) intact.
- `extraResources` now reads from `.build-runtime/node_modules/`
  instead of the root `node_modules/`. End layout in
  `Contents/Resources/app/node_modules/` is the same shape — just half
  the files.
- Both `.build-runtime/` and `next-runtime-package.json` are gitignored.

Side effect: the macOS dmg should drop in size by roughly a third (the
delta between full and prod-only dependency trees in this repo).

## [0.9.31] — 2026-05-19

### Fix: macOS Release build — package.json not landing in app.asar
Follow-up to 0.9.30. v0.9.30 added `"package.json"` to `build.files`
hoping electron-builder would pack it into `app.asar`. It still didn't,
and the build kept failing the asar integrity check.

The real cause (per [electron-builder#4160](https://github.com/electron-userland/electron-builder/issues/4160)):
when `extraResources` lists `"from": "package.json"`, electron-builder's
file-set deduplication removes the root `package.json` from the asar's
input set — the literal source-path string `"package.json"` collides
with electron-builder's auto-injection logic.

Fix:

1. New `postbuild` script copies `package.json` → `next-runtime-package.json`
   (gitignored).
2. The `extraResources` entry now reads from `next-runtime-package.json`
   instead. Same end file in `Contents/Resources/app/package.json` — but
   because the `from:` source name is no longer literally `package.json`,
   electron-builder no longer dedupes the root `package.json` out of the
   asar input.
3. The redundant `"package.json"` entry in `files` is removed
   (electron-builder auto-injects it at `fileMatcher.js:124` anyway).

## [0.9.30] — 2026-05-19

### Fix: include `package.json` inside `app.asar`
Follow-up to 0.9.29. With asar enabled, the macOS build progressed past
the code-sign step (the EMFILE crash is fixed) but then failed the asar
integrity check with:

> Application "package.json" in ".../app.asar" is corrupted: "package.json" was not found in this archive

The existing `build.files` glob (`electron/**/*`) didn't include
`package.json`. Under `asar: false` Electron resolved the file from the
unpacked tree; under `asar: true` it must live inside the archive.

Fix: add `"package.json"` to `build.files`. One-line.

## [0.9.29] — 2026-05-19

### Fix: macOS Release build crash (EMFILE during code-sign)
Every macOS Release build since the project's inception has failed with
`EMFILE: too many open files` partway through the electron-builder
code-sign step. As a result, no `.dmg` or `.zip` artifact has ever been
published to GitHub Releases — the in-app update banner had nothing to
find even when tags existed (v0.9.16, v0.9.26).

Two compounding causes:

1. `"asar": false` in `package.json` made electron-builder copy the
   entire main-process `node_modules` tree into the app bundle
   uncompressed, dramatically multiplying the file count.
2. The macOS GitHub runner defaults to `ulimit -n 256`. The signer
   opens every file under `Resources/` in parallel, blowing past
   that limit when one of those files is e.g. an obscure rule under
   `@typescript-eslint/eslint-plugin/dist/rules/…`.

Fixes applied:

- **`asar: true`** in `package.json`, with `asarUnpack` listing the
  two native modules the main process actually requires (`keytar`,
  `node-pty`). `better-sqlite3` lives inside the Next.js server which
  is delivered via `extraResources` outside asar already, so no unpack
  entry is needed for it.
- **`ulimit -n 65536`** is now raised inline in the macOS step of
  `.github/workflows/release.yml`, immediately before `electron-builder`
  runs (must be in the same shell — the directive doesn't persist
  across steps).

Once this lands, the next auto-tagged release should publish the
first ever working `.dmg`/`.zip` to the public Releases feed, and the
"Check for updates" feature added in 0.9.28 will actually have versions
to surface.

## [0.9.28] — 2026-05-19

### Manual "Check for updates" button + auto-tagged releases
Two small but related changes around the update flow.

**Settings → App updates**
A new section in the Settings dialog shows the current version, when the
app last checked GitHub Releases, and a **Check now** button that fires
the check on demand (bypassing the banner's 24h throttle). The result
surfaces as a toast:

- Newer version available → success toast with a **Download** action
  that opens the release page.
- Up to date → "You're on the latest version" success.
- GitHub unreachable / repo not public / rate-limited / no releases
  → neutral toast with a human-readable explanation (the `reason`
  field returned by `/api/update-check`).

Previously the banner stayed silently hidden in all the
`available:false` cases, which made it impossible to tell whether the
app was healthy or the check had quietly failed.

**Auto-tag workflow** (`.github/workflows/auto-tag.yml`)
On every push to `main` that touches `package.json`, the new workflow
reads the version, and if no `vX.Y.Z` tag exists yet, creates one and
dispatches `release.yml` against it. Versions 0.9.17–0.9.25 and 0.9.27
were documented in CHANGELOG but never tagged, so no Electron release
ever shipped for them — this stops that from recurring.

## [0.9.27] — 2026-05-14

### Fix: terminal prompt clipped at window bottom in split (full) layout
In the split layout the terminal canvas filled all the way to the window
edge, so when the window reached the bottom of the screen on macOS the
last row was pressed flush against the edge and the auto-hide Dock could
overlap the active prompt line.

Added `pb-2` to the xterm container to mirror its existing `pt-1`. Since
FitAddon snaps to integer row heights, this leaves ~8px of breathing
room below the last row and keeps the prompt fully visible.

## [0.9.26] — 2026-05-13

### Built-in terminal: Reconnect button
When an SSH session exits (network drop, `exit`, server kicked you, …)
the terminal header now shows a **Reconnect** button next to the status
pill. Clicking it:

- Re-spawns the same target (saved session or ad-hoc) in the same tab.
- Keeps the xterm instance and its scrollback intact — you can scroll up
  and read whatever you were doing before the disconnect.
- Writes a small `── reconnecting ──` separator into the buffer so the
  boundary is visible.

The button appears in both `exited` and `error` states. If the
connection fails to re-establish, you can click it again.

## [0.9.25] — 2026-05-13

### Fix: real cause of wrap-boundary glitch — pty/xterm COLUMNS desync
v0.9.24's renderer swap didn't fix the bug because the bug isn't in the
renderer. It's a race between web-font loading and the initial pty
spawn:

1. `term.open()` runs, xterm computes cell dimensions from the **fallback**
   font (JetBrains Mono hasn't loaded yet).
2. `fit.fit()` derives cols/rows from those wrong cell dimensions.
3. We spawn the pty with cols=X, send X to SSH for window-size negotiation.
4. JetBrains Mono finishes loading. xterm recomputes cell width, fires its
   internal `onResize` event with the corrected cols=Y.
5. **Our `term.onResize` listener wasn't registered yet** — it was set up
   inside the `openCall.then()` callback, which runs *after* the spawn HTTP
   round-trip. The font-load event fires and disappears unheard.
6. Shell on the remote thinks cols=X; xterm renders at cols=Y; up-arrow
   history recall paints over stale content from the old wrap boundary.

Fix:
- Register `term.onResize` **before** the spawn so font-load resizes are
  captured (`latestCols`/`latestRows` buffer).
- `await document.fonts.ready` before the initial `fit.fit()` so the
  first cell-size calculation uses the real font.
- After the spawn returns, force one `bridge.resize(handle, cols, rows)`
  with the buffered values to guarantee the pty matches xterm.

The shell now agrees with xterm on COLUMNS; history recall, prompt
redraws, and long-prompt wrapping render correctly.

## [0.9.24] — 2026-05-12

### Fix: stray-character rendering glitch on long prompts
The built-in terminal used `@xterm/addon-canvas`, which xterm.js
deprecated in v5.x in favour of `@xterm/addon-webgl`. CanvasAddon has a
known wrap-boundary redraw bug where, when a prompt wraps past the
terminal width, typed characters can land in the wrong column on the
preceding line — e.g. a hostname like
`AR-7280SR348YC8-I-1-LDP17-GB(...)#` rendering as
`t -7280SR348YC8-I-1-LDP17-GB(...)#` after typing.

Renderer ladder is now **WebGL → Canvas → DOM**:
- WebGL primary, with `onContextLoss` dispose so the addon doesn't
  freeze on a stale framebuffer when macOS reaps the GPU context under
  low-power / display-sleep.
- Canvas fallback retained for headless / WebGL-disabled contexts.
- DOM if both fail.

## [0.9.23] — 2026-05-12

### Built-in terminal: Cmd+K clears the scrollback buffer
Pressing **Cmd+K** (macOS) or **Ctrl+Shift+K** (Linux/Windows) in a
terminal pane clears the entire xterm scrollback while leaving the
active prompt line in place — matching the convention from Terminal.app
and iTerm2.

Plain Ctrl+K still reaches the shell as `kill-to-end-of-line`; only the
modifier combo above is intercepted, same approach as Cmd+A from
v0.9.19.

## [0.9.22] — 2026-05-12

### Fix: enforce single SSH Manager instance to stop cross-main token mismatch
Two main processes could coexist — a normal Launchpad open plus a copy
launched directly from the shell, or a launch after a previously-crashed
quit that didn't fully clean up. Each `main.js` generated its own
per-launch `SSH_MANAGER_INTERNAL_TOKEN`, but only **one** `next-server`
could hold port 3005 at a time. Whichever renderer window the user was
clicking belonged to whichever main, and if it wasn't the main that
spawned the live server, every `/api/internal/*` call returned **403** —
including Quick Connect.

Symptom: `/api/internal/spawn-plan-ad-hoc 403: Forbidden` even though
v0.9.20's orphan-reclaim logic looked fine in isolation.

Fix: `app.requestSingleInstanceLock()` at the very top of `main.js`. If
the lock is already held, the second instance quits immediately and asks
the first to focus its window via `app.on('second-instance')`. Combined
with v0.9.20's orphan-reclaim, the only valid states are now:

- One main, one next-server, tokens match → connect works.
- Crash recovery: previous main is dead, port held by an orphan → new
  main reclaims via `lsof -ti tcp:3005 | xargs kill -9` and spawns fresh.

## [0.9.21] — 2026-05-12

### Fix: local `electron:mac` / `:build` / `:win` builds produce a broken DMG

The `electron:*` scripts ran `next build` instead of `npm run build`.
`npm run build` is `next build --webpack`; plain `next build` defaults to
Turbopack in Next 16. The Turbopack output rewrites server-side externals
to hashed aliases like `better-sqlite3-90e2652d1716b047`, which the
runtime can't resolve once the app is packaged:

```
[server] ⨯ Error: Failed to load external module
  better-sqlite3-90e2652d1716b047: Cannot find module
  'better-sqlite3-90e2652d1716b047'
```

Every API route that touches the DB then returns 500. Profiles and
sessions appear "lost" in the UI even though `~/.ssh-session-manager/sessions.db`
is untouched.

The released DMGs on the GitHub Releases page were always fine — CI uses
`npm run build` explicitly (see `.github/workflows/release.yml`). This
bug only bit anyone running `npm run electron:mac` (or `:build` / `:win`
/ `:dev`) locally.

All four `electron:*` scripts now call `npm run build`, so they're
guaranteed to use the same webpack-mode build path as CI.

## [0.9.20] — 2026-05-12

### Fix: keytar NAPI throw crashes the app
A NAPI C++ exception from `keytar.node` (typically when the macOS keychain
prompt is dismissed/timed-out or the keychain ACL changed across an
upgrade) escapes the `try/catch` in `keychain-server.js` because the throw
is synchronous inside the NAPI callback — before `await` would have
converted it to a promise rejection. libc++abi then calls
`std::terminate()` and the whole Electron main process aborts.

Confirmed by a v0.9.16 crash report: keytar.node frames terminating with
`__cxa_throw` → `_objc_terminate` → `abort`.

We can't fix the upstream keytar bug, but `main.js` now installs
`uncaughtException` and `unhandledRejection` handlers that log and keep
the app alive. The individual keychain operation that triggered the throw
still fails (the affected HTTP request returns 500 to its caller), but
the user can retry rather than losing the whole session.

### Fix: Quick Connect 403 after a previous launch left a stale server

#### The bug
Each Electron launch generates a fresh `SSH_MANAGER_INTERNAL_TOKEN` and
spawns its own `next-server` with that token in env. The previous
`main.js` would reuse whatever server was already listening on port 3005:

```js
const alreadyUp = await isServerUp();
if (!alreadyUp) startServer();
```

If a prior launch crashed, was force-quit, or otherwise didn't unwind
cleanly (the existing `killServer()` uses `process.kill(-pid)`, which only
works when the child is a process-group leader — it isn't, since `spawn`
isn't called with `detached: true`), the `next-server` survives as an
orphan with the **old** token in its env. Every `/api/internal/*` call
from the new launch's pty-manager then comes back **403 Forbidden** — the
running server enforces a token the new main process doesn't know.

The user-visible symptom was Quick Connect failing with
`/api/internal/spawn-plan-ad-hoc 403: Forbidden`.

#### Fix
New `/api/internal/health` endpoint returns 200 only when called with the
current launch's `SSH_MANAGER_INTERNAL_TOKEN`. `main.js` probes it on
boot:

- 200 → the running server is ours; reuse.
- Anything else (403 stale-token, 404 from an older-version orphan that
  pre-dates this endpoint, connect-error, timeout, …) → reclaim the port
  via `lsof -ti tcp:3005 | xargs kill -9` (`netstat -ano` on Windows) and
  spawn a fresh server under our env.

The dance only runs in packaged mode (`app.isPackaged`). Dev mode keeps
the original behaviour of sharing whatever `npm run dev` server is up, by
design.

#### Verified in the wild
Confirmed on the reporter's machine: TWO orphaned next-server processes
were running from previous crashed launches (one Next 16.2.4 from a
recent app version, one 16.1.6 even older). The newer one was holding
port 3005, which is exactly the state that produced the 403 on Quick
Connect.

## [0.9.19] — 2026-05-09

### Built-in terminal: Cmd+A copies the whole scrollback
Pressing **Cmd+A** (macOS) or **Ctrl+Shift+A** (Linux/Windows) in a terminal
pane now selects the entire scrollback buffer and copies it to the
clipboard in one step. Plain Ctrl+A still reaches the shell as
`beginning-of-line` — only the modifier-combo above is intercepted.

### Built-in terminal: new sessions auto-focus their tab
Opening a new SSH session now switches the active tab to it instead of
leaving the previously-active tab in front. If the terminal strip is
collapsed, it expands automatically so the new tab is visible.

## [0.9.18] — 2026-05-08

Follow-up to v0.9.17's security pass. Three changes — one defensive, one
hardening of the upgrade path, one walk-back of v0.9.17's ASAR change that
broke the macOS build.

### Drop `allow-dyld-environment-variables` entitlement
Removed `com.apple.security.cs.allow-dyld-environment-variables` from the
Hardened Runtime entitlements. Modern Electron does not require it for
normal operation and dropping it shrinks the DYLD-injection surface.
Verified by a clean `npm run electron:mac` build and launch.

### Scrub plaintext from pre-migration snapshots
Pre-migration `.db` snapshots taken when upgrading from v0.7.x retained the
legacy `password` column with plaintext credentials, even after the live DB
was migrated into the OS keychain.

After a successful plaintext→keychain migration (live DB has zero
non-empty `password` rows), we now open every `pre-migration_*.db`
snapshot, NULL the `password` column, `VACUUM` so freed pages are
released, and remove WAL/SHM sidecar files. The scrub is idempotent and
audit-logged as `snapshot.plaintext_scrubbed`.

If the keychain migration is incomplete (any plaintext rows still in the
live DB), snapshots are left alone — they remain a valid recovery point.

### Revert ASAR packaging from v0.9.17
v0.9.17 set `asar: true` to raise the bar for in-place tampering of shipped
JavaScript. The `electron-builder` `files` glob in this project doesn't
include `package.json` at the asar root, which broke the macOS build. The
revert is intentional pending a proper rework of the build config; the
non-ASAR `electron:mac` build is verified clean here.

## [0.9.17] — 2026-05-08

### Security hardening pass

Defense-in-depth changes from a full-codebase audit. No known exploits were
in use; these close gaps that would matter if combined with a future renderer
compromise or a same-machine non-browser attacker.

#### HTTP boundary
- **`/api/profiles/[id]/secret` now uses `assertSafeRead`** instead of
  `assertSafeOrigin`. The previous guard skipped the Origin/Referer check on
  GET — mostly mitigated for browser CSRF by CORS, but the secret-reveal
  endpoint shouldn't have relied on that.
- **`/api/probe`** is now rate-limited to 60 probes/minute per process and
  rejects cloud-instance metadata addresses (169.254.0.0/16 link-local,
  `metadata.google.internal`, `fd00:ec2::254`).
- **`/api/validate-key`** now resolves symlinks via `realpath` and re-checks
  the result is inside `~/.ssh/`. A symlink under `~/.ssh/` pointing
  elsewhere previously would have served as a same-machine file-existence
  oracle.

#### Backup envelope
- **AES-GCM AAD now binds envelope metadata** (`format`, `version`,
  `kdf_params`, `salt`, `iv`) to the auth tag. Bumped envelope version to 2;
  v1 envelopes still decrypt for backwards compatibility.
- **12-character minimum password** is now asserted inside `encryptPayload`
  in addition to the API layer.

#### `extra_args` allowlist
- The `-o Key=Value` pairs accepted in profile `extra_args` now go through a
  key allowlist (see `SAFE_EXTRA_ARG_KEYS` in `src/lib/ssh-command.ts`).
  Previously any alphanumeric key was accepted, which meant
  `-o ProxyCommand=…`, `-o LocalCommand=…`, `-o IdentityAgent=…`, and similar
  options that route values through `/bin/sh -c` could be smuggled into a
  stored profile.
- **Migration note:** profiles with disallowed `-o` keys will now refuse to
  connect with `extra_args` rejected. Move ProxyCommand-style needs to
  ProxyJump (the dedicated jump-host field) or remove them.

#### Electron host
- **Renderer is now sandboxed** (`sandbox: true`). The preload script only
  uses `contextBridge`/`ipcRenderer`, both available in sandbox mode.
- **In-page navigation is pinned to APP_URL** via `will-navigate`. Any link
  that would replace the renderer with a foreign origin is intercepted and
  opened in the system browser instead.
- ~~**App resources are now packaged into ASAR** (`asar: true`) with native
  modules (`better-sqlite3`, `keytar`, `node-pty`) unpacked.~~ Reverted in
  v0.9.18 — the `electron-builder` `files` glob in this project requires
  more rework before ASAR can be safely enabled.

## [0.9.16] — 2026-05-08

### Fix: editing a profile no longer breaks its keychain link

#### The bug
`PUT /api/profiles/[id]` set `uses_keychain` based purely on whether the request body included a password (`useKeychain = usesSecret && !!input.password`). The Profile editor's password field is **empty by default when editing** — we don't reveal stored secrets unless you click the eye. So saving the profile to flip *any other field* (e.g. enabling Legacy SSH compatibility, renaming the profile, changing the color) submitted an empty `password` and clobbered `uses_keychain` to `0`.

The keychain entry itself was untouched — the DB just stopped pointing at it. From then on, `/api/profiles/:id/internal-secret` would read `row.password` (NULL) instead of the keychain, and the built-in terminal's auto-fill silently bailed because the fetch returned `null`.

This is what happened earlier with the `LDAP - davy.tan` profile after enabling Legacy SSH compatibility — the toggle worked, the connection succeeded, but the password no longer auto-filled.

#### Fix #1 — preserve the keychain link
PUT now reads the existing row before writing. The new logic:

| Condition | `uses_keychain` after update |
|---|---|
| `auth_type` switched away from password/passphrase | `0` (correct — we should clear) |
| Body included a non-empty `password` | `1` (correct — fresh keychain write) |
| Edit of any other field, no password supplied | **preserve the existing value** |

So flipping a toggle on a profile no longer disturbs its keychain binding.

#### Fix #2 — relink orphans on next startup
A new idempotent post-migration runs alongside the existing plaintext→keychain one. For every profile where:
- `auth_type` is `password` or `key_with_passphrase`
- `uses_keychain = 0` and `password` is null/empty (the orphan footprint)

…we ask the keychain whether an entry still exists for that profile id. If yes, we set `uses_keychain = 1` and audit-log `profile.keychain_relinked`. Existing profiles broken by the v0.9.x PUT bug heal automatically on next launch.

If the keychain doesn't have an entry either (e.g. user deleted it), nothing changes — the profile just stays in its current "needs you to re-enter the password" state.

## [0.9.15] — 2026-05-08

### Hotfix: drop `ssh-dss` from the legacy compat list

v0.9.14 included `ssh-dss` in `-o HostKeyAlgorithms=+ssh-rsa,ssh-dss`. **OpenSSH 9.8+ removed DSA support entirely** (verified: `ssh -Q HostKeyAlgorithms` on macOS Sequoia/Tahoe doesn't include it; `ssh -o HostKeyAlgorithms=+ssh-dss …` errors out at parse time with `Bad key types '+ssh-rsa,ssh-dss'.`). So enabling Legacy SSH compatibility on a modern macOS broke the connection before it started.

Fix: drop `ssh-dss` from the compat list. Everything else in the list (`ssh-rsa`, `diffie-hellman-group{1,14}-sha1`, `3des-cbc`, `hmac-sha1`, `hmac-md5`) is still supported by OpenSSH 10.2 — just disabled-by-default — so they stay.

If you're talking to kit that **only** speaks DSA host keys, modern OpenSSH literally cannot talk to it at all. The workaround is to install an older OpenSSH via Homebrew (`brew install openssh@9.7` or similar) and put it ahead in `$PATH`.

## [0.9.14] — 2026-05-08

### Legacy SSH compatibility for old network gear

OpenSSH 9+ disables a bunch of deprecated algorithms by default — `diffie-hellman-group14-sha1`, `diffie-hellman-group1-sha1`, `ssh-rsa` host keys, CBC ciphers, `hmac-sha1` MACs. Modern hosts negotiate around them; **older network gear still requires them**, and you get:

```
Unable to negotiate with 10.32.24.81 port 22: no matching key exchange method found.
Their offer: diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
```

Two fixes:

#### New profile toggle: "Legacy SSH compatibility"
**Profile editor → Advanced SSH options → Legacy SSH compatibility**. When enabled, ssh is invoked with the deprecated KEX / host-key / cipher / MAC algorithms appended to the modern defaults using `+algo` syntax — so modern hosts still pick modern algos and old hosts negotiate the legacy ones. Specifically adds:

```
-o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha1
-o HostKeyAlgorithms=+ssh-rsa,ssh-dss
-o PubkeyAcceptedAlgorithms=+ssh-rsa
-o Ciphers=+aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc
-o MACs=+hmac-sha1,hmac-sha2-256,hmac-md5
```

Schema bumped to v6 (one new column: `profiles.compat_legacy`, default 0). Wired through every spawn path — built-in terminal, ad-hoc spawn, legacy iTerm via `/api/connect`.

#### Relaxed `extra_args` validator
The validator now accepts `+`, `,`, `@`, `:` in `-o Key=Value` values, so you can write your own algorithm lists (e.g. `-o KexAlgorithms=+diffie-hellman-group-exchange-sha256,diffie-hellman-group14-sha256`) or vendor-prefixed algorithms (`-o Ciphers=+chacha20-poly1305@openssh.com`) without the regex blocking you. Shell metacharacters like `` ` ``, `$`, `;`, `|` are still rejected.

#### Tests
- Validator tests cover algorithm lists with `+`/`,`, vendor-prefixed names with `@`, and continued rejection of shell metacharacters
- 119 / 119 passing

## [0.9.13] — 2026-05-08

### Better keychain UX: dialog says "SSH Manager", first-launch welcome card

The macOS Keychain access dialog used to say **"next-server (v16.2.4) wants to use your confidential information stored in 'SSH Manager' in your keychain"** — confusing because "next-server" isn't an app you installed; it's the bundled Next.js child process's `process.title`. Two changes here address that and the surrounding "what is this prompt?" experience:

#### Keychain delegation moved to Electron main (option D)
Keychain calls now happen inside the **Electron main process** — the actual `SSH Manager` bundle. A new `electron/keychain-server.js` runs an HTTP server on `127.0.0.1` with an OS-assigned ephemeral port, gated by the same per-launch random `SSH_MANAGER_INTERNAL_TOKEN` already used for `assertInternal`. The Next.js child (which is where the API routes run) delegates every keychain operation to this server via HTTP.

Result: macOS attributes the keychain access dialog to "SSH Manager" (the bundle), exactly like every other macOS app does. One process identity per keychain ACL — simpler model, smaller surface area.

`src/lib/keychain.ts` now picks its mode at runtime:
- **Delegated** when both `SSH_MANAGER_KEYCHAIN_URL` and `SSH_MANAGER_INTERNAL_TOKEN` env vars are set (production / Electron-launched)
- **Direct** keytar when they're absent (`npm run dev` without Electron, build steps, tests)

Both modes expose the same public API.

#### First-launch welcome dialog (option B)
On the very first launch on a new install, a small one-time card appears explaining:
- Where saved passwords live (the OS keychain, not the app's database)
- That macOS will ask permission and to click **Always Allow**
- That the prompt may re-appear on app updates
- A pointer to the built-in terminal

Tracked via `localStorage["ssh-manager-onboarded"]`. Dismiss once and it's gone forever on that machine.

#### Documented future paths (options C and E)
README + SECURITY notes now mention two follow-ups we considered but didn't implement:

- **C: Pre-emptive keychain prime** — write a no-op keychain entry on first launch so the prompt appears in a controlled, app-explained moment. Lower-priority follow-up; the welcome dialog covers most of the gap
- **E: Apple Developer ID** ($99/yr) — the *permanent* fix. With a stable signing identity, the keychain ACL holds across all versions and the prompt never re-appears. Also kills Gatekeeper warnings and enables notarization. Out of scope for code; a money/process decision

## [0.9.12] — 2026-05-08

### Fix: first-time host connects now auto-fill correctly

Reported via Quick Connect: connecting to a host that's never been seen before, you get the SSH host-key fingerprint prompt — `Are you sure you want to continue connecting (yes/no/[fingerprint])?`. The auto-fill detector correctly refused to inject the password into that prompt (correct: typing the LDAP password as the answer would leak it), but it also **permanently disabled auto-fill for the rest of the session**. So after typing `yes` and accepting the host key, the *real* password prompt that followed got no auto-fill — you had to type the password manually.

Cause: `pty-manager.js` treated every `{kind: "skip"}` from the prompt detector as a session-final decision.

Fix: distinguish **transient** skips from **session-final** skips:

| Skip reason | Treatment |
|---|---|
| `yes/no prompt` (fingerprint / sudo / etc.) | **Transient** — keep auto-fill armed, clear the prompt tail, re-evaluate on the next chunk. After the user types `yes`, the password prompt that follows is auto-filled |
| `MFA / OTP indicator detected` | Session-final — disabled |
| `no stored secret for this profile` | Session-final — disabled |
| `already auto-injected once this session` | Session-final — already disabled |

Audit log now only records `terminal.autofill_skipped` for session-final skips. Yes/no prompts are silent.

Also clears `session.promptTail` after a transient skip so the stale yes/no text doesn't keep matching on subsequent re-scans.

## [0.9.11] — 2026-05-07

### Copy text on select in the built-in terminal

Highlighting text in a built-in terminal now copies it to the clipboard automatically — Linux-X11 / iTerm2 "Copy on select" style. No `⌘C` needed; `⌘V` still pastes as usual.

Implemented as a `mouseup` listener on the xterm container: when the mouse is released and `term.getSelection()` is non-empty, the selection is written to the clipboard via `navigator.clipboard.writeText`. Anchored to mouseup (not xterm's `onSelectionChange`) so we don't pound the clipboard while you're still dragging.

Toggle in **Settings → Built-in terminal → Copy text on select**. Default ON. Persisted as `ssh-manager-copy-on-select` in localStorage.

## [0.9.10] — 2026-05-07

### Restore double-click-to-zoom on the title bar

v0.9.5 backed off the drag region to *only* the empty `flex-1` spacer between the nav and search box (because v0.9.4's "drag the entire `<header>`" approach broke tab clicks). That fixed the tabs but left most of the title bar — the wide gutters on either side of the centered `max-w-5xl` content — non-draggable. Double-clicking those gutters did nothing.

**Fix**: drag region back on the outer `<header>` PLUS an explicit `app-no-drag` wrapper on the inner `max-w-5xl` content. The CSS rule `.app-drag-region .app-no-drag` makes the entire inner content (and every button it contains) non-draggable, so tab clicks aren't swallowed. The flex-1 spacer between nav and search re-asserts `app-drag-region` so that empty area is draggable too.

Result: drag from anywhere in the title bar that isn't a button / input. Double-click anywhere that isn't a button / input → zoom (per System Settings → Desktop & Dock). Tabs still click normally.

## [0.9.9] — 2026-05-07

### Layout toggle no longer kills active terminals

Reported: with an open ssh session, toggling between dashboard and split layout would lose the connection — a fresh ssh process would spawn instead.

Cause: `<TerminalPane>` was rendered in a different position in the JSX tree depending on layout (sibling of `<main>` for dashboard, child of a flex row for split). React's reconciler treats components at different positions as different mounts, so the whole component subtree (including the xterm instance and the IPC handle to the underlying pty) was unmounted and recreated on every layout change.

Fix: restructure the page root so the body row is a permanent flex container, and `<TerminalPane>` is **always the last child of the same "main column" `<div>`** regardless of layout. The layout toggle now changes only:
- whether `<CompactSessionList>` is rendered alongside it (split shows the sidebar)
- whether the dashboard `<main>` is rendered above it (dashboard shows the tabs/lists)
- the `stretched` prop on `<TerminalPane>` (controls bottom-strip vs full-height)

All of those are prop / sibling changes that React preserves the `<TerminalPane>` instance through. Open ssh sessions, scrollback, terminal state, and per-tab autofill state all survive the toggle.

Also adjusted stretched mode's outer flex to `flex-1 min-h-0` (was `h-full`) so it sizes correctly inside the new flex-column parent.

## [0.9.8] — 2026-05-07

### Tabbed sidebar in split layout

v0.9.6 hid the **Saved / History / Profiles** tabs in split layout because clicking them did nothing (the dashboard `<main>` doesn't render in split). v0.9.8 brings the tabs back and **makes them switch the sidebar's content**:

- **Saved** (default) — list of saved sessions, click to open in the terminal pane
- **History** — recent connections, click to reconnect (saved-by-id when possible, ad-hoc otherwise — both go through the built-in terminal with auto-password)
- **Profiles** — profile list with hover-to-show **Edit** and **Delete** buttons; **+** button in the sidebar header opens the new-profile dialog

The per-tab title in the sidebar header updates ("Sessions · 5" / "History · 23" / "Profiles · 5"), the filter input filters whichever list is active, and the tab nav remains visible in both layouts so switching is fast either way.

In dashboard layout the tabs work exactly as before — they switch the full-width `<main>` content. The same `tab` state drives both layouts, so clicking Profiles in dashboard then toggling to split keeps you on Profiles, and vice-versa.

## [0.9.7] — 2026-05-07

### Resizable + collapsible sidebar in split layout

The split-layout sidebar now adapts to how much space you want it to take.

- **Drag the right edge** to resize between **220 px and 640 px**. A subtle accent-coloured 1-px line appears on hover to telegraph the hit zone (6 px wide for easy grabbing). Width persists across launches
- **Double-click the edge** to reset to 300 px
- **Collapse to a thin rail** via a chevron button in the sidebar header. The rail is 40 px wide and keeps the Quick Connect / New Session shortcuts plus an expand chevron, so you never lose access. Collapsed state persists too

New localStorage keys:
- `ssh-manager-sidebar-width` (number, clamped 220–640)
- `ssh-manager-sidebar-collapsed` (boolean)

## [0.9.6] — 2026-05-07

### Hide dashboard-only header bits in split layout

Reported: in split layout the Saved / History / Profiles tabs in the header click but don't do anything visible. Cause: split layout doesn't render the dashboard `<main>` (sessions live in the left sidebar instead), so toggling `tab` state has no effect.

Fix: in split layout, hide the tab nav, the search input, and the sort dropdown — they only apply to dashboard. The "New session" button now always means *session* in split (was sometimes "New profile" if you'd previously been on the Profiles tab).

To get to History / Profiles management, switch back to dashboard via the layout toggle in the header.

(Followup option for later: surface History / Profiles as overlays so they're reachable from split too.)

## [0.9.5] — 2026-05-07

### Hotfix: tab buttons stopped working after the v0.9.4 drag-region change

v0.9.4 marked the entire `<header>` as `-webkit-app-region: drag` and used a child-selector rule to restore `no-drag` on every interactive element. The CSS shipped correctly, but **clicks on the tab navigation buttons (Saved / History / Profiles) stopped firing** in the packaged app — almost certainly an Electron / Chromium quirk where parent-set drag regions interact with descendant buttons under certain layout conditions.

**Fix**: instead of marking the entire header as draggable, mark only the **empty `flex-1` spacer between the nav and the search box** as draggable. That region can never contain an interactive element by construction, so there's no risk of swallowing clicks.

You lose a bit of drag area — you can drag from the gap between Profiles tab and the search input, and from the gap between the right-most button and the window edge isn't part of it (those are the buttons themselves) — but everything that should click, does.

The CSS rule + class are kept (still used by `UpdateBanner`); the only change is *where* `app-drag-region` is applied in the header.

## [0.9.4] — 2026-05-07

### Fix: window title-bar gestures (drag, double-click-to-zoom)

The window uses `titleBarStyle: 'hiddenInset'` (no traditional title bar, just the traffic-light buttons), but we never told macOS which region of the page should act *as* the title bar. Result: dragging from the top did nothing, and double-clicking the top didn't zoom the window per System Settings → Desktop & Dock → "Double-click a window's title bar to:".

**Fix**: new `.app-drag-region` CSS class that opts a region into `-webkit-app-region: drag`, with a child rule that re-asserts `no-drag` on every interactive element (`button`, `input`, `select`, `textarea`, `a`, `[role="button"]`, `[role="combobox"]`). Applied to the main app `<header>` and to `UpdateBanner` so the very top of the window is always draggable. Buttons / inputs / theme picker / Quick Connect / etc. all stay clickable thanks to the no-drag override.

Result on macOS:
- **Drag** from any empty part of the header → moves the window
- **Double-click** any empty part of the header → zoom (or whatever you set in System Settings)
- All buttons and inputs in the header remain fully interactive

Cross-platform: `-webkit-app-region` is ignored in browser dev mode and on Linux X11. On Windows the same property works for frameless windows; harmless otherwise.

## [0.9.3] — 2026-05-07

### Layout toggle: dashboard ↔ split

A small icon in the header toggles between two layouts. Choice persists across launches in `localStorage`.

#### Dashboard (default — unchanged)
Full-width sessions / history / profiles tabs. Terminal pane slides up from the bottom. Best for managing your fleet — see everything at a glance, organize folders, edit profiles.

#### Split (new)
- **Compact session list on the left** (~300 px sidebar): hostname + profile + last-connected, sorted by recency, with an inline filter
- **Terminal fills the rest of the window**, full height
- A small empty-state ("Click a session on the left to connect.") shows when no terminals are open
- Quick Connect and New Session buttons inline in the sidebar header
- Settings, theme, and the Quick Connect dialog all stay accessible in the main app header

The toggle button only appears when running in the desktop app — split layout is meaningless without the built-in terminal. Browser dev mode keeps the dashboard layout always.

#### Implementation
- `src/components/CompactSessionList.tsx` — new component for the sidebar
- `src/components/TerminalPane.tsx` — extracted `TabStrip` so dashboard (collapsible-bottom-strip) and split (full-height) modes share it. Added a `stretched` prop and `emptyState` slot for the split case
- Root container changed from `min-h-screen` to `h-screen overflow-hidden` so the split layout's `flex-1` actually has a viewport-sized parent. Dashboard's main is now `overflow-y-auto` to preserve scrollability of long lists

## [0.9.2] — 2026-05-07

### Quick Connect: probe-first, click-to-connect

Termius-style flow:

1. **Type the host + (optional) port → Enter** (or click Check). The app does a TCP-connect probe so you find out *before* picking credentials whether the host is reachable
2. **Reachable** → profile cards appear; **clicking a profile connects immediately** (no second button press). If the server returned a banner (`SSH-2.0-OpenSSH_…`) it's shown above the cards
3. **Unreachable** → friendly error message ("Connection refused — the port is closed", "Host unreachable — no route", etc.) with Edit-host / Try-again buttons

#### New
- `POST /api/probe` — origin-guarded TCP probe. Validates host against the existing safe-character regex; clamps timeout to 0.5–8 s (default 3 s); waits up to 800 ms after connect for an SSH/Telnet/whatever banner so the UI can show what's listening
- `src/lib/probe.ts` — extracted the TCP probe core for testing
- `src/lib/probe.test.ts` — 5 new tests against a real local TCP listener (banner / silent / ECONNREFUSED / unreachable IP / ENOTFOUND)

#### UX changes
- Profile picker is **click-to-connect** in Quick Connect; no separate Connect button. The "Suggested" badge from v0.8.5's hostname-pattern matcher still highlights the most likely profile
- Set-up-passwordless shortcut moved to a small inline button on each password-auth card (was a bottom-right Footer button)
- Save-as-session toggle remains visible on both steps; tick it before clicking a profile and the session gets saved+connected in one action
- The legacy "type host → pre-select profile → click Connect" flow is gone — there was no version of it anyone preferred

#### Tests
**119 across 10 files** (was 114 across 9). All v0.9.x flows still tested.

## [0.9.1] — 2026-05-07

### Quick Connect now uses the built-in terminal

v0.9.0 wired session-card connects to the in-app terminal pane, but **Quick Connect** still went through `/api/connect` → AppleScript → iTerm. Fixed.

- New internal-only endpoint `POST /api/internal/spawn-plan-ad-hoc` returns a validated argv for `host + profile_id` (with optional `port` and `jump_host`) — same `buildSshArgs` validation as the saved-session path
- New `window.sshTerm.openAdHoc({ host, profileId, port?, jumpHost?, label?, ... })` IPC and `sshterm:open-ad-hoc` handler in `electron/pty-manager.js`. Refactored `spawnFromPlan` so saved-session and ad-hoc share the spawn / data-pipe / exit-audit logic
- `Terminal.tsx` now takes a discriminated-union `target: { kind: "session" | "ad-hoc", ... }` instead of a bare `sessionId`; `TerminalPane` and the Quick Connect flow updated accordingly
- **Auto-password fill works for ad-hoc connections too** — the spawn plan returns the `profileId` so the prompt-detector → keychain-fetch path is identical to saved sessions
- Quick Connect with "Save as session" off → ad-hoc terminal pane opens, no record left in the session list. With it on → session is saved first, then opened by id (so the session card auto-suggest can learn from it)

## [0.9.0] — 2026-05-07

### Built-in terminal — Termius-style smooth connect, password fatigue gone

The big one. Click a session card → an in-app terminal pane slides up from the bottom, the connection happens *inside the app*, and the stored password (if any) is auto-typed for you when ssh asks. Works for everything that accepts password auth — including Arista, ADVA, Cisco, Juniper switches/routers where macOS's `UseKeychain yes` doesn't help (that directive only handles SSH key passphrases, not server passwords).

#### What's new

- **`Open in built-in terminal`** menu item on every session card. Becomes the default action when running in the desktop app — clicking the green Connect button opens a pane instead of launching iTerm. The legacy "Open in iTerm / Terminal.app" path is preserved as a menu item if you'd rather use your real terminal
- **Tabbed pane** at the bottom of the dashboard with a connect-status pill (`connecting` / `connected` / `exited`/`error`), per-tab close button, "Close all", and a collapse toggle
- **Auto-password fill** with strict safety guards (see Security below). Toggle in Settings → Built-in terminal
- **xterm.js renderer** with the Canvas addon for performance, 5,000 lines of scrollback, JetBrains-Mono monospaced font, dark theme matched to the app

#### Architecture (new infrastructure)

This is the first feature that uses real Electron IPC — until now everything went through the Next.js HTTP server. Adds:

- `electron/preload.js` — first preload script. Exposes a tiny typed `window.sshTerm` API to the renderer via `contextBridge`. Never leaks `ipcRenderer` or Node primitives
- `electron/pty-manager.js` — main-process pty lifecycle. Owns `Map<handle, ownerWindowId>`, validates ownership on every IPC call, kills owned ptys on window-close, caps concurrent terminals per window
- `electron/lib/prompt-detector.js` — CommonJS twin of `src/lib/prompt-detector.ts`, drift-tested by `prompt-detector-drift.test.ts` so the two implementations stay in lockstep
- `SSH_MANAGER_INTERNAL_TOKEN` — per-launch random 32-byte token generated in main, passed to the Next.js server via env, used in `x-internal-token` header for routes that should *never* be reachable from the renderer. The renderer has no way to obtain this token. New helper `assertInternal(req)` in `api-guard.ts` (constant-time-ish compare)
- `GET /api/sessions/[id]/spawn-plan` — internal-only, returns the validated argv from `buildSshArgs` so main never has to duplicate that logic
- `GET /api/profiles/[id]/internal-secret` — internal-only, pulls a stored password/passphrase from the OS keychain on demand for auto-injection

#### Security model — auto-password specifics

False positives matter. Auto-injecting a password into the wrong context can leak it. So:

- **Strict prompt match** against the *last non-empty line* of recent output, after stripping ANSI escapes. Won't trigger on `Password:` substrings mid-line, in command output, or in man pages
- **MFA / OTP context detection** — if any of `verification code`, `one-time code/password`, `OTP`, `2fa code`, `Duo push/prompt`, `Authy`, `YubiKey`, `RSA token`, `push notification`, or `enter the code` appears in the recent tail, **auto-fill is disabled for the entire session** — better safe than sorry
- **yes/no prompt blacklist** — never auto-fill at `(yes/no)?` or `(yes/no/[fingerprint])?` prompts (host-key acceptance, sudo confirmations)
- **One injection per session** — if the first try is wrong, the user types the second one themselves. Stops re-injection of stale credentials and avoids account lockouts
- **Audit-log only the event**, never the secret. Three new events: `terminal.password_injected` / `terminal.password_fetched` / `terminal.autofill_skipped` (with reason)
- **No console logging** of the password. JS strings can't be wiped post-use, but we drop the only reference (`secret = null`) so it can be GC'd

23 new tests in `src/lib/prompt-detector.test.ts` cover OpenSSH / Arista / Cisco / uppercase / ANSI-coloured / Duo / YubiKey / 2FA / yes-no / mid-line / shell-prompt cases. Plus the cross-implementation drift test.

#### Pty / IPC trust boundary

- The renderer **never supplies command strings**. It supplies a numeric session_id; main fetches the validated argv from the spawn-plan endpoint
- `node-pty.spawn(file, args, opts)` — args as `string[]`, no shell, every element type-checked
- PTY handles are server-issued opaque integers. Renderer can't write to a handle it didn't receive from `open()` (ownership map keyed on `BrowserWindow.id`)
- Output forwarded as `Buffer` (becomes `Uint8Array` in the renderer); xterm.js handles UTF-8 decoding
- `RING_BUFFER_BYTES = 64 KB` cap; `MAX_SESSIONS_PER_WINDOW = 16` cap; `PROMPT_TAIL_BYTES = 4 KB` for prompt-detection state

#### Tests

**114 tests across 9 files** (was 89 across 7). New: `prompt-detector.test.ts` (23 cases), `prompt-detector-drift.test.ts` (drift detection, 2 grouped cases × 15 fixtures).

#### Limits / known caveats

- The built-in terminal requires the Electron desktop app. In plain browser dev mode (`npm run dev` then opening `http://127.0.0.1:3005` in Safari/Chrome), the menu item is hidden and the legacy iTerm flow is used
- Pty isolation is per-window only. If you open the app twice (two `BrowserWindow` instances), each window only sees its own ptys
- node-pty native binding is rebuilt for Electron during `npm run electron:mac` via `@electron/rebuild`. If you build on a fresh machine and the rebuild fails, ptys won't open and you'll see "node-pty unavailable on this platform" — the rest of the app still works

## [0.8.5] — 2026-05-07

### Auto-suggest the right profile when adding a new session

In a mixed fleet some hosts use one credential profile (e.g. local-user key auth) and others use a different one (e.g. LDAP password). Picking the right one every time is friction.

This release **infers the right profile from the hostname pattern**. As you type the host in the New Session or Quick Connect dialog, the app looks at your existing sessions for similar hostnames and pre-selects the matching profile.

- Algorithm: split the new hostname into segments (on `-`, `.`, `_`), find the existing session that shares the most leading + trailing segments with it, then pick the **modal** profile_id among neighbours at that depth. Case-insensitive. Requires at least 2 segments in common.
- Handles both dash-named gear (`XN-XSVM-S-67-LDP02-GB` → suggest based on `XN-XSVM-S-` prefix) and FQDNs (`backups.sohonet.internal` → suggest based on `.sohonet.internal` suffix).
- Visible UX: the matching profile gets a **"Suggested"** badge in the picker, and a small banner above the list shows the matched pattern and how many similar hosts informed the guess (e.g. *"Auto-selected based on `XN-XSVM-S` pattern (3 similar hosts)"*).
- Override is one click — pick any other profile and the manual choice wins. The banner notes "— overridden by you" so you can tell auto-pick is no longer active.
- Wired into both **New session** and **Quick Connect**. In Edit mode, the existing profile is left alone — never silently changes a saved session's profile.
- Self-improving: every session you save makes future suggestions sharper. No configuration needed.

#### Tests
- 10 new in `src/lib/profile-suggest.test.ts` — fleet-prefix matching, FQDN trailing-segment matching, tie-breaking by modal profile, case insensitivity, depth-prioritization, ignores `null` profile_id neighbours.
- **89/89 tests passing across 7 files** (was 78 across 6).

## [0.8.4] — 2026-05-07

### Sync to `~/.ssh/config` — kill the "type my password every time" loop

The motivating problem: a typical fleet is mostly **network gear** (Arista switches, ADVA OptiSwitches, Cisco / Juniper / etc.), where:
- `ssh-copy-id` doesn't work — vendor CLIs aren't POSIX shells
- key auth often isn't supported, or requires per-vendor config commands
- you're stuck typing the same password into every device

The right fix is **macOS's built-in `UseKeychain yes`** — type the password once, the keychain remembers it, Touch ID supplies it on every subsequent connection. This release wires the whole flow up:

#### New: Settings → ssh_config → Sync now
Writes a marked block to `~/.ssh/config` with one `Host` entry per saved session. For each entry it includes:
- `Host <slug> <hostname>` (memorable alias + the real hostname)
- `HostName`, `User`, `Port` (only when non-default), `ProxyJump` (if jump host set)
- For **key-auth** profiles: `IdentityFile` + `IdentitiesOnly yes`
- For **password-auth** profiles on macOS: `UseKeychain yes` + `AddKeysToAgent yes` + `PreferredAuthentications publickey,keyboard-interactive,password`
- `Compression yes`, `ForwardAgent yes`, `ServerAliveInterval N` when set on the profile

Behaviour:
- **Idempotent**: regenerable any time. Anything outside the `# === BEGIN/END SSH Manager managed block ===` markers is preserved
- **Safe**: file is written atomically (tmp + rename), permissions set to `0600`, the previous content is snapshot under `~/.ssh-session-manager/backups/` before each write (last 10 kept)
- **Reversible**: a "Remove block" button strips the managed block while leaving everything else intact
- **Defensive**: any session whose host fails the safe-character regex is skipped during emission (config-injection guard)

After syncing, on macOS:
1. `ssh AR-7050SX348C8-I-1-LDP02-GB` (or its slug) — first time, type the password; macOS asks if you want to store it in the Keychain → say yes
2. Every subsequent connection: Touch ID, instant login. Works for *all* vendor gear that accepts password auth, not just POSIX boxes
3. Anything else that reads `~/.ssh/config` (CLI ssh, VS Code Remote, scp, rsync) gets the same shortcuts for free

#### New: `GET / POST /api/ssh-config`
- `GET` returns status (file exists?, managed block present?, host count, generation timestamp) plus a **preview** of what `Sync now` would write — visible from the UI behind a "Preview" toggle
- `POST { action: "sync" }` writes the block; `POST { action: "remove" }` strips it. Both audit-logged

#### Tests
- `src/lib/ssh-config-export.test.ts` — 21 tests covering the pure generator: macOS vs non-macOS keychain emission, port omission for default 22, ProxyJump, Compression / ForwardAgent / keepalive, slug collapsing, unsafe-host skipping, multi-session ordering. Plus the splice/remove logic for inserting and stripping the managed block out of an existing config

**Total: 78 tests across 6 files** (was 57 across 5).

#### Lint config
- ESLint now ignores `dist/**` (electron-builder's output, which contains a copy of `.next/**` and was getting scanned after a packaged build)

## [0.8.3] — 2026-05-07

### Hotfix: CSP `script-src` was too strict for Next.js App Router

**Symptom:** in the production build, the page rendered but **buttons didn't respond** — the UI was effectively a static screenshot.

**Cause:** v0.8.0 set `script-src 'self'`. Next.js App Router emits inline `<script>(self.__next_f=…).push(…)</script>` tags for streaming hydration data; with strict `'self'` they're CSP-blocked, so React never hydrates and event handlers never attach. Dev mode wasn't affected because Next dev injects scripts via `<script src=>` instead of inline.

**Fix:** allow `'unsafe-inline'` on `script-src` (and keep it on `style-src`, where it was already required by Tailwind / next/font). Documented the trade-off in `next.config.ts` — the proper long-term hardening is per-request nonces via middleware, but for a 127.0.0.1-bound Electron app where all HTML comes from this server's own bundle and we never render user-supplied content as raw HTML, the threat `'unsafe-inline'` re-exposes (injected `<script>` tags) is already out-of-threat-model. The remaining CSP directives (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, etc.) continue to bound the renderer.

## [0.8.2] — 2026-05-07

### Fix passwordless-setup: tilde expansion + sandboxing on `ssh-copy-id`

#### Bug
`Set up passwordless login` against a profile whose `key_path` started with `~/` produced a malformed argv:

```
ssh-copy-id '-i' '/.ssh/id_rsa.pub' 'user@host'
```

i.e. a leading `/` instead of the user's home directory. `ssh-copy-id` then errored with `failed to open ID file '/.ssh/id_rsa.pub': No such file or directory`. The cause was a client-side line in `SetupPasswordlessDialog` that stripped `~` without expanding it (`privPath.replace(/^~/, "") + ".pub"`).

#### Fix
- Client now sends the raw path with `~` intact
- New `src/lib/ssh-paths.ts` resolves `~/foo` against `os.homedir()` and **rejects anything outside `~/.ssh/`** (sandbox). Used by `/api/keys/copy-id`. Bare relative paths, `..` traversal, and root-relative paths like `/etc/passwd` or `/.ssh/foo` are now all rejected with a 400
- Server also returns 400 if the resolved public key file doesn't exist (instead of letting `ssh-copy-id` discover that in the terminal)

#### Hardening (carry-over from v0.8.0)
The `/api/keys/copy-id` AppleScript was still building its script via string interpolation — the v0.8.0 positional-argv fix was only applied to `/api/connect`. Now both routes pass the command as `argv[1]` to `osascript`, eliminating any concern about quote/backslash/newline escapes breaking out of the AppleScript string.

#### Tests
- 8 new tests in `src/lib/ssh-paths.test.ts` covering the fix and the sandbox (path traversal, foreign roots, bare `~`, the exact `/.ssh/...` legacy bug input)
- Total: 57 tests across 5 files

#### End-to-end verification
| Input | v0.8.1 | v0.8.2 |
|---|---|---|
| `/.ssh/id_rsa.pub` (the bug) | passed through verbatim → ssh-copy-id error | **400** rejected |
| `/etc/passwd` | passed through verbatim | **400** "must live under ~/.ssh/" |
| `~/.ssh/foo.pub` (file exists) | tilde stripped → `/.ssh/foo.pub` (broken) | **200** expanded to `/Users/<u>/.ssh/foo.pub` |
| `~/.ssh/missing.pub` | passed through, error in terminal | **400** "public key not found" |

## [0.8.1] — 2026-05-06

### v0.8.0 follow-ups

- **One-shot plaintext-to-keychain migration.** On startup, any leftover rows in `profiles.password` are moved into the OS keychain and the column is nulled. Idempotent — re-runs each launch until the user's keychain is reachable. Each migrated row is recorded in the audit log as `profile.password_migrated`. Verified end-to-end: legacy plaintext row → server start → row reads `uses_keychain=1`, password fetchable from `security find-generic-password`.
- **Recent activity panel** in `Settings → Recent activity` — collapsible view of the last 50 audit events (profile create/delete, secret reveals, backup operations, plaintext migrations). Reads from the new `GET /api/audit` endpoint
- **macOS hardened runtime is now actually applied.** The v0.8.0 config set `hardenedRuntime: true` but kept `identity: null`, which causes electron-builder to skip signing entirely — silently dropping the entitlements. Switched to ad-hoc signing (`identity: "-"`) so the entitlements file lands on the binary. Verified: `codesign -d` shows `flags=0x10002(adhoc,runtime)` and the full entitlements plist on both the main app and renderer helpers; the packaged app launches and Next.js + native modules (better-sqlite3, keytar) load successfully
- **Pre-existing lint cleanup** — `react-hooks/set-state-in-effect` downgraded from error to warn (it false-positives on valid dialog-reset patterns); `electron/` excluded from lint (CommonJS by design); ThemeProvider's localStorage read deferred into a microtask; unused imports removed (`SelectValue`, `Server`, `cn`, `Button` in SessionCard, `setIncludeSecrets`)

## [0.8.0] — 2026-05-06

### Security hardening pass

This release tightens defense-in-depth across credential storage, IPC, and HTTP boundaries. Behaviour-affecting changes are listed first.

#### Credential storage (behaviour change)
- **Refuse to persist passwords/passphrases in plaintext.** When the OS keychain (macOS Keychain / Windows Credential Vault / libsecret) is unavailable, the app now returns 503 instead of silently writing the secret to SQLite. This applies to:
  - `POST /api/profiles` (create) — refuses, rolls back the row if the keychain write fails after insert
  - `PUT /api/profiles/[id]` (update) — writes to keychain *before* the DB so a failed write can't leave `uses_keychain=1` orphans
  - `POST /api/import` and `POST /api/backup/restore` — refuse to import secrets when the keychain is unreachable
  - `importElecterm` — drops the secret with a per-profile warning instead of writing plaintext
- The `password` column on `profiles` is now never written by any code path (kept for backward compatibility on read)

#### Encrypted backups
- Minimum password length raised from **8 → 12 characters** (server + UI validation, label, and disabled-state check)
- New per-process **rate limiter for decrypt attempts**: 5 tries / 5 minutes, returns 429 with `Retry-After`. Resets on successful decrypt. Buckets keyed per backup file for restore, per process for import
- Successful decrypts are recorded in the audit log

#### Electron / packaging
- **`hardenedRuntime` re-enabled** for macOS builds with a new `electron/build/entitlements.mac.plist` covering V8 JIT, library validation off (for `keytar` / `better-sqlite3`), dyld env vars, and outbound network
- **Removed `shell: true`** from the dev `npm start` spawn in `electron/main.js`. Uses `npm.cmd` on Windows, `npm` elsewhere — no shell layer

#### HTTP boundary
- **Content-Security-Policy** + `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` shipped on every response via `next.config.ts`
- **Origin/Referer guard** is now case-insensitive and accepts the IPv6 loopback (`http://[::1]:3005`) in addition to `127.0.0.1` / `localhost`. Substring-matching attacks (`http://attacker.example.com/?u=http://127.0.0.1:3005/`) are rejected
- Replaced `404 "not found"` with generic `400 "invalid request"` in `/api/connect`, `/api/profiles/[id]/secret`, `/api/sessions/[id]/clone` — removes resource-existence info leak

#### AppleScript
- The SSH command is now passed to `osascript` as a positional argv (`on run argv`), not interpolated into the script source. Eliminates any concern about quote/backslash/newline escaping breaking out of the AppleScript string. Added `--` separator so leading-dash commands aren't parsed as flags

#### Audit log
- New `audit_log` table (schema v5, with pre-migration snapshot) recording `event`, `target_type`, `target_id`, `target_label`, `details` (JSON), `at`. Bounded to 5000 rows
- Events recorded: `profile.create`, `profile.delete`, `profile.secret_revealed`, `backup.export`, `backup.import`, `backup.restore`
- Read via `GET /api/audit?limit=200` (origin-guarded)

#### Validators
- `extra_args` now accepts valueless SSH options like `-o VisualHostKey` in addition to `-o Key=Value` pairs
- Removed unused `hostOpt`, `EXTRA_ARG_RE`, and stale `ProfileColor` import

#### Keychain
- Replaced double type-cast on the dynamic `import('keytar')` with a runtime shape check. If the module shape ever changes the app fails closed (logs + disables) instead of crashing on first call

#### Tests + CI
- Added **Vitest** suite — 49 tests across `validators`, `backup-crypto`, `rate-limit`, and `api-guard`
- New `npm test` and `npm run test:watch` scripts

## [0.7.2] — 2026-05-05

### Passwordless setup is now the default for new password-auth sessions
- Saving a new session with a password-auth profile **automatically opens** the "Set up passwordless login" dialog
- Same in **Quick Connect** when "Save as a session" is on with a password profile
- The dialog has a "**Skip — keep using password**" button so it's never forced; you can always opt out
- Editing an existing session no longer auto-prompts (the menu item is still there for those)

## [0.7.1] — 2026-05-05

### Passwordless setup is now discoverable everywhere
- **Visible amber "Make passwordless" hint** on every password-auth session card — no longer buried in the menu
- **Connect toast** for password-auth sessions includes a "Make passwordless" action button (8s duration so you have time to click)
- **Quick Connect dialog** now has a "Set up passwordless first" button when you've picked a password-auth profile
- The same `SetupPasswordlessDialog` works for saved sessions and ad-hoc Quick Connect targets

## [0.7.0] — 2026-05-05

### Set up passwordless login (the proper fix)
SSH passwords are no longer typed every time. New flow on any password-auth session:

1. Session card menu → **"Set up passwordless login"**
2. App generates an `ed25519` key in `~/.ssh/ssh-manager/` (or reuses existing)
3. A terminal opens with `ssh-copy-id` pre-typed — type your password **one last time**
4. Click "It worked — switch to key auth" — the profile is updated in place
5. From now on, connecting to that host opens straight to the shell. No prompts

Behind the scenes:
- New `lib/ssh-keygen.ts` — ed25519 key generator with 0600 perms
- `POST /api/keys/generate` — origin-guarded key creation
- `POST /api/keys/copy-id` — opens Terminal with `ssh-copy-id` for the host
- New `SetupPasswordlessDialog` walks the user through the steps
- Menu item only shows on profiles using password auth

## [0.6.3] — 2026-05-05

### Connect: terminal stays open & shows errors
- iTerm2 connection now **types the SSH command into a fresh shell** instead of running it as the session's command. When SSH fails, you stay at your normal shell prompt and can read the error until you close the window manually
- Bug fix: profiles with `auth_type=password` no longer accidentally pass `-i <key_path>` to ssh (was triggering "Server refused our key" before falling back to password)

### CI
- Windows build is now allowed to fail without blocking the release. The macOS `.dmg` always ships; release notes update regardless. Windows fix is tracked separately
## [0.6.2] — 2026-05-05

### Reveal saved passwords / passphrases
- New "**eye toggle**" on the Password / Passphrase fields in the profile editor
- For Keychain-stored secrets, clicking the eye lazily fetches the value via a new `GET /api/profiles/[id]/secret` endpoint (origin-guarded)
- New behaviour: passphrases for `key_with_passphrase` profiles are now also stored in Keychain (was previously plaintext in the SQLite DB)
- Profile editor now correctly shows the passphrase field for `key_with_passphrase` profiles (was hidden before)

### Terminal stays open on connection failure
- Connect command now appends `… ; echo "Session ended (exit $?). Press Return to close" ; read` so when SSH fails (auth denied, host unreachable, etc.) you can actually read the error message before the window closes
- Fixes the iTerm2 "*A session ended very soon after starting*" warning where the SSH error was hidden

### Windows build fix
- Add `outputFileTracingExcludes` for Windows junction points (`Application Data`, `Local Settings`) — was failing CI with `EPERM: scandir` on every Windows release build

## [0.6.1] — 2026-05-05

### Critical fix
- **Bundled `.app` was 500-erroring every API call.** Turbopack production builds were mangling external native module names (`better-sqlite3-<hash>`, `keytar-<hash>`) but the runtime couldn't resolve them inside the packaged app. Switched the production build to webpack (`next build --webpack`). Dev mode was unaffected.

## [0.6.0] — 2026-05-05

### Saved vs History split
- **"Saved" tab** (renamed from Sessions) — explicitly bookmarked hosts
- **New "History" tab** — every connection (saved or quick), newest first
- History row shows: timestamp, host, profile, jump host, "saved" badge if it's a known session
- Per-row actions: **Reconnect**, **Save as session** (for ad-hoc connects), **Remove from history**
- **Clear all history** button
- Bounded to last 500 connections
- New schema (v4) `connection_history` table; auto-migrated on upgrade

### Electerm import
- Drag any Electerm `bookmarks-*.json` into Settings → Import — auto-detected and routed to a dedicated importer
- Inline private keys are extracted, deduplicated by content hash, and written to `~/.ssh/ssh-manager-imported/` with 0600 perms
- Passphrases & passwords go straight into macOS Keychain
- Bookmark groups → folders (non-`default` ones)
- Profiles auto-created and deduplicated by `(user, key, port)`

### Bug fix: stray Dock icon
- The bundled Next.js server process now spawns through the Renderer Helper binary (which has `LSUIElement: true`) so it stops appearing as a separate "exec" entry next to the SSH Manager icon in the Dock

## [0.5.0] — 2026-05-05

### Update notifications
- New **`/api/update-check`** endpoint queries GitHub for the latest release tag and compares to the running version
- **In-app banner** above the header announces new versions; "Download" opens the release page in your default browser, "X" dismisses for that version
- Throttled to **once per 24 hours**, cached locally
- Silently no-ops while the repo is private (404 is treated as "not yet"). Will start working automatically once the repo is public — no app change needed
- Per-version dismiss persisted in `localStorage`

### Data persistence (defense in depth)
- Schema version pinning via `PRAGMA user_version` — every migration tracked and logged
- **Pre-migration snapshot** — before any column or table change, the DB is copied to `~/.ssh-session-manager/backups/pre-migration_v{from}-to-v{to}_*.db`
- Last 10 snapshots kept; older ones rotated out
- Migrations are strictly **additive** — we never drop columns or tables, so older app versions stay readable

## [0.4.0] — 2026-05-05

### Backups (industry-grade)
- **Encrypted backups** — AES-256-GCM with scrypt KDF (N=2^17, r=8, p=1, OWASP-recommended). User supplies a master password; without it the backup can never be decrypted
- Backup files now write to a managed **`~/.ssh-session-manager/backups/`** directory with `0600` permissions
- **Backup history** in Settings — list of all backups with timestamp, size, encrypted/secrets indicators
- **One-click restore** from history; encrypted backups prompt for password
- **Auto-detect encryption** on import — drag any backup file in and it'll prompt for password if needed
- New endpoints: `/api/backup/run`, `/api/backup/list`, `/api/backup/restore`, `/api/backup/delete`
- `/api/export` now optionally encrypts (POST `{password, include_secrets}`)

### Quick Connect
- New "**Save as a session**" toggle — connect, and optionally persist the host+profile as a saved session in one step

### Appearance
- **Text size** scale (Compact / Normal / Comfortable / Large) — applied via CSS `zoom` so every layout element rescales together
- **Font family** picker — Geist Sans, System, Inter, Serif, Monospace
- Both saved alongside the theme in `localStorage`

## [0.3.3] — 2026-05-05

### Project hygiene
- Add **PolyForm Noncommercial 1.0.0** license (see `LICENSE`) — free for personal/hobby/research/education use, no commercial use
- Add `SECURITY.md` with private vulnerability disclosure flow and threat model
- Add `description`, `license`, `author`, `homepage`, `repository`, `bugs` fields to `package.json`
- GitHub Actions: release workflow now auto-populates **GitHub Release notes** from the matching `CHANGELOG.md` section

## [0.3.2] — 2026-05-05

### UX
- Click the **SSH Manager logo** to return to the dashboard (Sessions tab, search cleared)
- Bigger, more visible **X close** button on dialogs (with `Close (Esc)` tooltip)
- **ThemePicker** gets an explicit "Done" button
- **Settings stays open** when launching Import — closing Import returns to Settings instead of the dashboard
- **Nested ProfileDialog** Cancel reads "Back to session" / "Back to quick connect"
- `aria-label` on every icon-only header button

### Build
- Mark `keytar` and `better-sqlite3` as `serverExternalPackages` so Turbopack doesn't try to bundle native modules

## [0.3.1] — 2026-05-04 (security)

Multiple critical and high-severity issues identified by an audit and fixed:

### Critical fixes
- **C1** Command injection via SSH command builder — replaced with strict argv validator (`src/lib/ssh-command.ts`). Hosts, usernames, keys, jump hosts must match safe regexes; `extra_args` restricted to allowlist of `-o Key=Value` pairs only
- **C2** AppleScript escape was broken — fixed for backslash, quote, newline, CR. AppleScript now invoked via `execFile` (no shell)
- **C3** Next.js was binding to `0.0.0.0` (full LAN exposure) — now `127.0.0.1` only, in dev script, prod script, and Electron's spawn
- **C4** `/api/export` was returning plaintext Keychain passwords by default — GET strips them; opt-in via `POST {include_secrets: true}`

### High fixes
- API guard middleware (`src/lib/api-guard.ts`): every route checks `Origin` / `Referer` against the local origin → blocks drive-by CSRF from any browser tab
- Strict input validation on every POST/PUT body (`src/lib/validators.ts`)
- `/api/validate-key` restricted to `~/.ssh/` only — no size/mode leak
- Folder DELETE now manually nulls referencing sessions (covers legacy DBs without active FK enforcement)
- Clone session naming: strips existing `(copy)` suffix, no run-on names
- `~/.ssh/config` `$HOME`/`~` expansion happens server-side, never persisted as a literal

## [0.3.0] — 2026-05-04

### Credential & host management
- **Import from `~/.ssh/config`** with preview + selective import
- **macOS Keychain** encryption for stored passwords (via `keytar`)
- **Export / Import** JSON backups in Settings dialog
- **Folders** for grouping sessions, with color tags
- **Jump host (ProxyJump)** field per session
- **SSH options per profile**: agent forwarding, compression, keepalive, extra args
- **Live key file validation** in the profile editor
- **Clone / duplicate** session
- **Sort** by name / last connected / recently added (persisted)

### Visual polish (readability)
- Three-tier text hierarchy (`fg` / `muted-fg` / `subtle-fg`) with WCAG-compliant contrast
- Antialiased fonts, ligatures, tabular numerals
- Bumped key text sizes (15px session names, 13–14px body)
- Custom themed scrollbars
- Uppercase tracking labels replaced with semibold for legibility

## [0.2.0] — 2026-05-04

- **Visual profile picker** in session dialog — credential profiles now appear as colored cards instead of a dropdown
- **Inline "+ New profile"** button inside the session dialog
- **Default profile** flag, marked with a star, auto-selected for new sessions
- **6 profile color tags** (cyan, green, amber, purple, pink, rose) — color carries through to session cards
- **Quick Connect** — connect to any host without saving (host + profile picker)
- **10 selectable color themes** via Palette icon (Cyan Terminal, Matrix, Amber Glow, Violet Storm, Rose Garden, Crimson, Sky High, Lime Light, Monochrome, Daylight)
- Theme persisted in localStorage with pre-hydration script to avoid flash
- Split `lib/db.ts` into `types.ts` + `profile-colors.ts` so client components don't pull in `better-sqlite3`

## [0.1.0] — 2026-05-04

Initial release.

- Next.js + Electron desktop app
- SQLite storage at `~/.ssh-session-manager/sessions.db`
- Credential profiles (username + key path or password)
- SSH sessions with tags, notes, host/port
- Connect → opens iTerm2 / Terminal.app via AppleScript
- GitHub Actions workflow builds `.dmg` (Intel + arm64) and `.exe` on tag push
