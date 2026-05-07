# Changelog

All notable changes to **SSH Manager**.

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
