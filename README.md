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

The app is **ad-hoc signed with Hardened Runtime + entitlements** (not Apple-notarized — notarization requires a paid Apple Developer ID, ~$99/yr). When you download the `.dmg` from a browser, macOS sets the quarantine flag and shows a warning on first launch. The exact wording depends on your macOS version:

- **macOS 15 Sequoia and newer:**
  > "Apple could not verify 'SSH Manager' is free of malware that may harm your Mac or compromise your privacy."
- **macOS 14 Sonoma and earlier:**
  > "SSH Manager.app cannot be opened because Apple cannot check it for malicious software."

#### How to open it anyway

Pick whichever fits your macOS version:

1. **System Settings → Privacy & Security** *(works on every modern macOS, required on Sequoia+)*
   - Try to open the app once — let macOS show the warning, then click **Done**.
   - Open **System Settings → Privacy & Security**, scroll down. You'll see a line like *"SSH Manager was blocked to protect your Mac"* with an **Open Anyway** button.
   - Click it. macOS may prompt for your password / Touch ID, then ask one more time — choose **Open Anyway**.

2. **Right-click → Open** *(macOS 14 Sonoma and earlier only — removed in Sequoia)*
   - In Finder, right-click (or Control-click) **SSH Manager.app**, choose **Open**, then **Open** again in the dialog. One-time bypass for that machine.

3. **Strip the quarantine flag via Terminal** *(works on every version)*
   ```sh
   xattr -dr com.apple.quarantine "/Applications/SSH Manager.app"
   ```
   This removes the "downloaded from the internet" mark so Gatekeeper stops checking the app. Re-run it after each upgrade — every new `.dmg` you download gets a fresh quarantine flag.

You only need to do this **once per installed version**. Subsequent launches of the same `.app` open normally.

If you build it locally (instructions below) the quarantine flag is never set in the first place.

### Keychain prompts

When you save your first password, macOS will ask permission to use the keychain — the dialog says **"SSH Manager wants to use your confidential information stored in 'SSH Manager' in your keychain"**. Click **Always Allow**. This is normal and expected; the app shows a one-time welcome card explaining it on first launch.

#### Why it might re-appear after an upgrade

Because the app is ad-hoc signed (no stable Developer ID), each released `.dmg` has a different code-signing hash. macOS keychain ACLs are bound to that hash, so the **first launch after an upgrade** may show the prompt again. Click **Always Allow** once more — that's macOS protecting your stored credentials.

#### How to make this prompt go away forever

The proper fix is an **Apple Developer ID Application certificate** (~$99/yr through the Apple Developer Program). With a stable signing identity:

- the keychain ACL holds across all versions — the prompt never re-appears after the first **Always Allow**
- the app passes Gatekeeper without the quarantine warning
- notarization becomes available

For now we ship ad-hoc signed (free, but with the per-upgrade prompt). The trade-off is documented; the app's code is unchanged.

#### Future work (potential)

A future release could add a **pre-emptive keychain prime** — on first launch the app deliberately writes a no-op entry so the prompt appears in a controlled moment we can explain *immediately before*, instead of when you happen to save your first profile. Tracked but not implemented yet — the welcome dialog is a lighter-weight alternative.

### Terminal windows reopen with "pseudo-tty" errors after a restart

If, after a reboot or re-login, you see one or more Terminal.app windows showing:

```
[Could not create a new process and open a pseudo-tty.]
[forkpty: Device not configured]
[Restored 22 Jun 2026 at 10:40:42]
```

…that is **macOS, not SSH Manager**. macOS "Reopen windows when logging back in" restores every Terminal.app window that was open at logout. Terminal.app keeps a window around after its shell exits (`[Process completed]`), so SSH windows you opened via **Open in iTerm / Terminal.app** accumulate and get restored all at once. Each restored window asks for a fresh pseudo-terminal, the system pty table is momentarily exhausted, and `forkpty` fails with `ENXIO` — which macOS renders as *"Device not configured."* The windows are harmless (the SSH session is long gone), just alarming.

How to stop it:

- **Use the built-in terminal** (the default **Connect** action). It runs in-app and is never part of macOS window restoration, so it can't hit this. This is the recommended path.
- **If you prefer Terminal.app**, set **Terminal → Settings → Profiles → Shell → "When the shell exits"** to **"Close the window"** (or "Close if the shell exited cleanly"). Terminal then closes the window itself when SSH ends, so dead SSH windows never linger to be restored.
- **Or** turn off restoration entirely: **Terminal → Settings → General → uncheck "Reopen windows when logging back in"** (and/or the system setting in **System Settings → Desktop & Dock**).

The app can't close these windows for you — Terminal.app won't let a window be closed by AppleScript while a process is alive in it, and once the shell exits the window no longer has an identifier the app can target. Letting Terminal close its own windows (the setting above) is the only reliable fix on the Terminal.app side.

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
