# Changelog

All notable changes to **SSH Manager**.

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
