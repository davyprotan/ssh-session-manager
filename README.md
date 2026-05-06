# SSH Manager

A local-first desktop app for managing SSH sessions and credential profiles. Built as a replacement for Termius / Electerm — focused on **clean credential management** and **fast connection launching**, not on being yet another embedded terminal.

When you click Connect, it opens iTerm2 (or Terminal.app as fallback) with the right `ssh` command. Your existing terminal of choice does what it does best; this app handles everything around it.

![themes](https://img.shields.io/badge/themes-10-22d3ee) ![security](https://img.shields.io/badge/CSP%20%2B%20origin%20guards-green) ![storage](https://img.shields.io/badge/Keychain%20only-blue) ![tests](https://img.shields.io/badge/tests-49-success) ![build](https://github.com/davyprotan/ssh-session-manager/actions/workflows/release.yml/badge.svg)

---

## Features

- **Credential profiles** — username + SSH key (or password). Reuse across many sessions. One can be marked as default
- **Color tags** on profiles (cyan / green / amber / purple / pink / rose) — surface the same color on session cards that use them
- **Visual profile picker** — when creating a session, profiles appear as cards (not a dropdown). Inline "+ New profile" — no need to switch tabs
- **Quick Connect** — host + profile picker → connect, no need to save the session
- **Folders** for organizing sessions, with optional color
- **Jump host (ProxyJump)** support per session
- **Per-profile SSH options** — agent forwarding `-A`, compression `-C`, keepalive interval, plus extra `-o Key=Value` flags (allowlisted)
- **Import from `~/.ssh/config`** — preview what'll be imported, cherry-pick which hosts
- **Export / Import JSON** for backups across machines
- **Sort** sessions by name / recently connected / recently added
- **Clone / duplicate** a session as a starting point
- **Live SSH key validation** in the profile editor
- **10 color themes** including a light mode (Daylight)

## Security

Defense-in-depth across credential storage, IPC, and HTTP boundaries.

#### Credential storage
- **Passwords stored in OS keychain only** (macOS Keychain / Windows Credential Vault / libsecret) via `keytar`. The app **refuses** to persist secrets in plaintext — if the keychain is unreachable, profile create/update/import/restore returns 503 instead of falling back to SQLite
- **One-shot migration** moves any legacy plaintext rows into the keychain on next startup (audit-logged as `profile.password_migrated`); the `password` column is then nulled

#### Network / API boundary
- **127.0.0.1 only** — Next.js bound to loopback, never reachable from your LAN
- **CSP + security headers** on every response — `default-src 'self'`, `frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera/mic/geo blocked)
- **Origin guards** on every API route — case-insensitive Origin/Referer match against `127.0.0.1` / `localhost` / `[::1]`. Drive-by CSRF from any other webpage in your browsers is rejected
- **Generic 400 on missing rows** — `/api/connect`, secret reveal, session clone don't leak resource-existence info via 404s

#### Encrypted backups
- **AES-256-GCM** with **scrypt** KDF (`N=2^17, r=8, p=1` — OWASP 2023)
- **12-character minimum** password
- **Rate-limited decrypt**: 5 attempts per 5 minutes, returns 429 with `Retry-After`. Buckets keyed per backup file (restore) or per process (import). Resets on successful decrypt
- **Plain JSON exports do NOT leak Keychain passwords** by default — opt-in via `POST {include_secrets: true}`

#### Command construction
- **Argv-based SSH builder** with strict regexes — hostnames, ports, key paths, usernames each have safe-character allowlists. `extra_args` allowlisted to `-o Key[=Value]` only (valueless flags like `-o VisualHostKey` permitted)
- **AppleScript invoked via `execFile`** (no shell) and **the SSH command is passed as a positional argv argument** to `osascript` (`on run argv`) — never interpolated into the script source, so quote/backslash/newline escaping cannot break out
- **`/api/validate-key`** sandboxed to `~/.ssh/` only

#### Electron
- **`contextIsolation: true`**, **`nodeIntegration: false`**
- **Hardened Runtime** with explicit entitlements (V8 JIT only; library validation off so native modules load; outbound network for the GitHub update check). See `electron/build/entitlements.mac.plist`
- **No `shell: true`** anywhere in the spawn paths

#### Audit log
- Every sensitive operation (profile create/delete, secret reveal, backup export/import/restore, plaintext migration) is recorded in a local `audit_log` SQLite table, viewable in **Settings → Recent activity**

See `src/lib/api-guard.ts`, `src/lib/ssh-command.ts`, `src/lib/validators.ts`, `src/lib/backup-crypto.ts`, `src/lib/rate-limit.ts`, and `src/lib/audit.ts` for the implementations. Test coverage in `src/lib/*.test.ts` (49 tests).

---

## Installation (end users)

Grab the latest installer from [Releases](https://github.com/davyprotan/ssh-session-manager/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `SSH-Manager-X.Y.Z-arm64.dmg` |
| macOS (Intel) | `SSH-Manager-X.Y.Z.dmg` |
| Windows | `SSH-Manager-Setup-X.Y.Z.exe` |

### macOS Gatekeeper note

The app is **ad-hoc signed with Hardened Runtime + entitlements** (not Apple-notarized — notarization requires a paid Apple Developer ID). When you download the `.dmg` from a browser, macOS will set the quarantine flag and complain on first launch:

> "SSH Manager.app cannot be opened because Apple cannot check it for malicious software."

You have two options:

1. **Right-click → Open** (and click Open again in the dialog) — one-time bypass, works for that machine
2. **Strip quarantine via Terminal:**
   ```sh
   xattr -cr "/Applications/SSH Manager.app"
   ```

If you build it locally (instructions below) the quarantine flag is never set in the first place.

### Keychain prompt on version upgrade

Because the app is ad-hoc signed (no stable Developer ID), each released `.dmg` has a different code-signing hash. macOS's keychain access-control list is bound to that hash, so on the **first launch after upgrading** the app may prompt you for your system password to grant the new binary access to the existing entries. Click **Always Allow** and you won't see it again until the next upgrade.

A fresh, never-installed user **does not see this prompt** — the keychain item is created by the same binary that later reads it.

If you want this to go away entirely, the app needs a **Developer ID Application** certificate (~$99/yr Apple Developer Program). The signature is then stable across versions, and as a bonus the app passes Gatekeeper without quarantine warnings.

### Windows SmartScreen note

Same idea — Windows will show "Windows protected your PC". Click **More info → Run anyway**.

---

## How the app works

When you double-click `SSH Manager.app`:

1. The Electron main process checks if port `3005` is already in use
2. If not, it spawns a bundled Next.js server (`next start -p 3005 -H 127.0.0.1`)
3. Once the server responds, it opens a `BrowserWindow` pointing at `http://127.0.0.1:3005`
4. Cmd+Q quits the app and stops the bundled server cleanly

Your data lives in **`~/.ssh-session-manager/sessions.db`** (SQLite). Your passwords (if any) live in the **macOS Keychain** under service `SSH Manager`.

When you click **Connect**, the server runs an AppleScript via `osascript` that opens iTerm2 (or Terminal.app) with the SSH command pre-filled. The actual terminal session lives in your terminal app — scrollback, output, search, etc. are handled there.

---

## Development

Requires Node.js 20+ and npm.

```sh
git clone https://github.com/davyprotan/ssh-session-manager.git
cd ssh-session-manager
npm install
npm run dev
```

Open http://localhost:3005

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on `127.0.0.1:3005` |
| `npm run build` | Production Next.js build (.next folder) |
| `npm start` | Production Next server, no Electron |
| `npm run electron` | Launch Electron pointing at the running server |
| `npm run electron:mac` | Build a `.dmg` for macOS |
| `npm run electron:win` | Build a `.exe` for Windows |
| `npm test` | Run the Vitest suite (unit tests for validators, crypto, rate limiter, origin guard) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint |

### Project layout

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes (sessions, profiles, folders, connect, export, audit, …)
│   ├── layout.tsx
│   ├── page.tsx            # The dashboard
│   └── globals.css
├── components/             # React components (dialogs, cards, picker, theme, …)
└── lib/
    ├── db.ts               # SQLite (server-only) + plaintext→keychain migration
    ├── types.ts            # Shared types (client+server)
    ├── profile-colors.ts   # Color palette constants
    ├── themes.ts           # 10 theme definitions
    ├── keychain.ts         # OS keychain via keytar (server-only)
    ├── ssh-command.ts      # Strict argv builder for the ssh command
    ├── api-guard.ts        # Origin/Referer + token enforcement
    ├── validators.ts       # POST/PUT body validators
    ├── backup-crypto.ts    # AES-256-GCM + scrypt for encrypted backups
    ├── backup.ts           # Backup file read/write
    ├── rate-limit.ts       # In-memory rate limiter (used on decrypt attempts)
    ├── audit.ts            # Audit log writer + reader
    ├── ssh-keygen.ts       # ed25519 key generator
    ├── electerm-import.ts  # Electerm bookmarks importer
    └── ssh-config.ts       # ~/.ssh/config parser

electron/
├── main.js                                # Electron entry — spawns Next, opens BrowserWindow
├── build/icon.icns                        # App icon
└── build/entitlements.mac.plist           # Hardened Runtime entitlements

.github/workflows/release.yml   # Tag-driven CI build & GitHub Release publish
vitest.config.ts                # Test runner config
```

### Tech stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (base-ui flavour)
- **better-sqlite3** for storage
- **keytar** for macOS Keychain
- **Electron 41** for the desktop wrapper
- **electron-builder** for installers

---

## Releasing a new version

GitHub Actions builds and publishes installers automatically when you push a tag matching `v*`.

```sh
# Bump version + commit + tag in one go
npm version patch   # or minor / major
git push --follow-tags
```

In ~10 minutes, a new GitHub Release appears at `https://github.com/davyprotan/ssh-session-manager/releases/tag/vX.Y.Z` with `.dmg`, `.zip`, and `.exe` assets.

The workflow lives at `.github/workflows/release.yml`.

### To get rid of the Gatekeeper / SmartScreen warnings entirely

You'd need:

- **macOS:** Apple Developer ID ($99/yr) → set `mac.identity` in `package.json` + add notarization (`mac.notarize`) with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` GitHub secrets
- **Windows:** EV code signing certificate ($300+/yr from Sectigo, DigiCert, etc.) → wire it into electron-builder's `win.certificateFile` / `win.certificatePassword`

For personal use this is overkill. The current ad-hoc signing is fine.

---

## Architecture decisions

- **Local Next.js server, not pure Electron renderer code.** Keeps SQLite + Keychain access in one process and avoids IPC. Cost: ~5 sec cold start on first launch.
- **No embedded terminal.** Re-implementing xterm.js + node-pty + an SSH client would 5× the surface area of the project. iTerm2 / Terminal.app already do this perfectly. The app generates the right `ssh` command and lets your terminal handle the rest.
- **OS keychain over symmetric encryption with a master password.** OS-level secret storage is harder to misuse and integrates with biometric unlock. The app *refuses* the plaintext fallback path entirely — if the keychain is unreachable, profile saves return 503.
- **AppleScript via positional argv, not string interpolation.** The SSH command is passed to `osascript` as `argv[1]`, never embedded in the script source — eliminates an entire class of escape-bypass bugs.
- **127.0.0.1 binding + CSP + origin guards.** Local apps that listen on the loopback are accessible from any other process or browser tab on the same machine. CSP blocks any external loads, and the origin guard rejects cross-site requests.

---

## License

[**PolyForm Noncommercial License 1.0.0**](./LICENSE).

In short:

- ✅ **Free for personal use, hobby projects, research, education**, and use by charitable, educational, or government organisations.
- ✅ Modify it, share your modifications, contribute back.
- ❌ **Not for commercial use** — you can't sell it, ship it inside a paid product, or use it as part of a for-profit business operation.

If you want a commercial licence, [open a GitHub issue](https://github.com/davyprotan/ssh-session-manager/issues) or contact the maintainer.

## Security

If you find a security issue, please [report it privately](./SECURITY.md) instead of opening a public issue.
