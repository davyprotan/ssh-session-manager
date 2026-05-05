# Security Policy

SSH Manager handles credentials. If you find a security issue, please **do not** open a public GitHub issue.

## How to report

Email the maintainer privately: open a [security advisory](https://github.com/davyprotan/ssh-session-manager/security/advisories/new) on GitHub. This keeps the report private until a fix is shipped.

Please include:

- A description of the issue
- Steps to reproduce, or a proof-of-concept
- The version you're testing (run the app and check the bundle Info.plist, or look at `package.json`)
- Your suggested impact / severity

You'll get an acknowledgment within 7 days.

## Scope

In scope:

- The Next.js API routes (`src/app/api/**`) — auth, validation, command construction
- The Electron wrapper (`electron/main.js`) — IPC, window security, server lifecycle
- The SQLite schema and migrations (`src/lib/db.ts`)
- The macOS Keychain integration (`src/lib/keychain.ts`)
- The SSH command builder (`src/lib/ssh-command.ts`)
- The AppleScript-based terminal launcher in `src/app/api/connect/route.ts`

Out of scope:

- Issues that require physical access to an unlocked machine
- Issues in upstream dependencies (Next.js, Electron, better-sqlite3, keytar) — please report those upstream
- The macOS Keychain itself (report to Apple)
- Compatibility with non-default macOS configurations (e.g. third-party security software intercepting `osascript`)

## Threat model

The app is designed to run **locally** on a single user's machine and bind to `127.0.0.1` only. Defended against:

- Drive-by CSRF from any browser tab on the same machine — origin/referer guard on every API route
- Command injection — argv-based SSH builder with strict regexes; AppleScript via `execFile` (no shell)
- LAN exposure — listener bound to `127.0.0.1`, never `0.0.0.0`
- Plaintext credential leak — passwords go to macOS Keychain by default; `/api/export` strips them unless the user explicitly opts in
- Path traversal / file disclosure — `/api/validate-key` sandboxed to `~/.ssh/`

Out of model:

- Physical attacks
- Compromised host OS or already-compromised user account
- Side channels (timing, network observation of TLS not in scope as we don't speak TLS)

## Past advisories

See [CHANGELOG.md](./CHANGELOG.md) — version 0.3.1 documents a fix-up batch from a security audit.
