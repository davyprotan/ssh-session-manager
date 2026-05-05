# Changelog

All notable changes to **SSH Manager**.

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
