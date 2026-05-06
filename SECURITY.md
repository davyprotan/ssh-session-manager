# Security Policy

SSH Manager handles credentials. If you find a security issue, please **do not** open a public GitHub issue.

For an architectural overview of the protections in place, see the **Security** section of [README.md](./README.md#security).

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

- The Next.js API routes (`src/app/api/**`) — auth, validation, command construction, audit logging
- The Electron wrapper (`electron/main.js`) — IPC, window security, server lifecycle, Hardened Runtime entitlements (`electron/build/entitlements.mac.plist`)
- The SQLite schema and migrations including the deferred plaintext→keychain migration (`src/lib/db.ts`)
- The OS keychain integration (`src/lib/keychain.ts`) — including the refuse-plaintext-fallback policy
- The SSH command builder (`src/lib/ssh-command.ts`) and body validators (`src/lib/validators.ts`)
- The AppleScript-based terminal launcher in `src/app/api/connect/route.ts` (positional-argv invocation)
- The encrypted backup format (`src/lib/backup-crypto.ts` — AES-256-GCM + scrypt)
- The decrypt-attempt rate limiter (`src/lib/rate-limit.ts`)
- The audit log (`src/lib/audit.ts` + `audit_log` table)

Out of scope:

- Issues that require physical access to an unlocked machine
- Issues in upstream dependencies (Next.js, Electron, better-sqlite3, keytar) — please report those upstream
- The OS keychain itself (report to Apple / Microsoft / the libsecret maintainers)
- Compatibility with non-default macOS configurations (e.g. third-party security software intercepting `osascript`)

## Threat model

The app is designed to run **locally** on a single user's machine and bind to `127.0.0.1` only. Defended against:

- **Drive-by CSRF from any browser tab on the same machine** — case-insensitive Origin/Referer guard (allowing `127.0.0.1`, `localhost`, and IPv6 `[::1]` on port 3005) on every API route
- **Cross-site script / asset injection** — Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`) plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`
- **Command injection** — argv-based SSH builder with strict regexes; AppleScript via `execFile` (no shell), with the SSH command passed as a positional argv argument so the script source never contains attacker-influenced bytes
- **LAN exposure** — listener bound to `127.0.0.1`, never `0.0.0.0`
- **Plaintext credential leak** — passwords go to the OS keychain only. The app refuses to fall back to SQLite plaintext if the keychain is unreachable (returns 503). A one-shot startup migration moves any pre-existing plaintext rows out of the database. `/api/export` strips secrets unless the user explicitly opts in or supplies an encryption password
- **Information leak via 404** — sensitive routes return generic 400 "invalid request" for missing rows so resource existence isn't observable
- **Path traversal / file disclosure** — `/api/validate-key` sandboxed to `~/.ssh/`; backup filenames rejected if they contain `..`, `/`, or `\`
- **Online password guessing on encrypted backups** — minimum 12-character password, rate limiter (5 tries / 5 minutes per file) on decrypt
- **Renderer process exploits** — Hardened Runtime active on macOS (V8 JIT only, library validation off only for native modules, network client only); `contextIsolation: true`, `nodeIntegration: false`
- **Audit trail tampering of routine operations** — sensitive ops (profile create/delete, secret reveal, backup export/import/restore, plaintext migration) are written to a local `audit_log` table

Out of model:

- Physical attacks
- Compromised host OS or already-compromised user account
- Side channels (timing, network observation of TLS not in scope as we don't speak TLS)
- Offline brute-force of an encrypted backup whose password an attacker has gained physical access to (the scrypt KDF makes this expensive but not impossible — choose a strong password)

## Past advisories

See [CHANGELOG.md](./CHANGELOG.md) — version **0.8.0** documents a comprehensive security hardening pass; **0.8.1** adds follow-ups (plaintext→keychain migration, audit log UI, hardened-runtime fix); version 0.3.1 documents an earlier audit fix-up batch.
