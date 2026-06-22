// Open Terminal/iTerm2 with `ssh-copy-id` so the user types their password ONE LAST TIME.
// After it succeeds, ssh-copy-id installs the public key into the host's authorized_keys.
// We don't try to capture the result — the user clicks "It worked" or "Try again" in the UI.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs";
import { assertSafeOrigin } from "@/lib/api-guard";
import { resolveSshPath } from "@/lib/ssh-paths";

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const KEY_RE = /^[a-zA-Z0-9._/~\-+ ]+$/;

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const host = typeof body.host === "string" ? body.host.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const publicKeyPathRaw = typeof body.public_key_path === "string" ? body.public_key_path.trim() : "";
  const port = Number.isInteger(body.port) ? body.port : (parseInt(String(body.port)) || 22);
  const jumpHost = typeof body.jump_host === "string" ? body.jump_host.trim() : "";

  if (!host || !HOST_RE.test(host)) return NextResponse.json({ error: "invalid host" }, { status: 400 });
  if (!username || !USER_RE.test(username)) return NextResponse.json({ error: "invalid username" }, { status: 400 });
  if (!publicKeyPathRaw || !KEY_RE.test(publicKeyPathRaw)) return NextResponse.json({ error: "invalid public_key_path" }, { status: 400 });
  if (port < 1 || port > 65535) return NextResponse.json({ error: "invalid port" }, { status: 400 });

  const publicKeyPath = resolveSshPath(publicKeyPathRaw);
  if (!publicKeyPath) {
    return NextResponse.json(
      { error: `public key path must live under ~/.ssh/ (got: ${publicKeyPathRaw})` },
      { status: 400 },
    );
  }
  if (!fs.existsSync(publicKeyPath)) {
    return NextResponse.json(
      { error: `public key not found: ${publicKeyPath}` },
      { status: 400 },
    );
  }

  // Build ssh-copy-id command. Each argv element is single-quoted for the shell
  // that iTerm/Terminal will run; quoting protects spaces and metachars in the
  // resolved path (e.g. usernames like "Davy Tan").
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const args: string[] = ["-i", publicKeyPath];
  if (port !== 22) args.push("-p", String(port));
  if (jumpHost) {
    if (!/^(?:[a-zA-Z0-9._-]{1,64}@)?[a-zA-Z0-9._:%\-]+(?::\d{1,5})?$/.test(jumpHost)) {
      return NextResponse.json({ error: "invalid jump_host" }, { status: 400 });
    }
    args.push("-o", `ProxyJump=${jumpHost}`);
  }
  args.push(`${username}@${host}`);

  const cmd = `ssh-copy-id ${args.map(sq).join(" ")}`;
  const display = `# This will install your public key into ${username}@${host}'s authorized_keys.\n# Type your password ONE LAST TIME — after this, no password.\n${cmd}`;

  // The display text is passed to AppleScript as a positional argv argument,
  // not interpolated into the script source. This means the bytes can contain
  // anything (newlines, quotes, AppleScript syntax) without being able to
  // alter the script structure. /api/connect reaches the same goal by a
  // different route: it single-quote-escapes each arg into an executable
  // .command file launched via `open` (no AppleScript on that path).
  const appleScript = `
    on run argv
      set theCmd to item 1 of argv
      tell application "System Events"
        set appList to name of every application process
      end tell
      if appList contains "iTerm2" or appList contains "iTerm" then
        tell application "iTerm"
          set newWindow to (create window with default profile)
          tell current session of newWindow
            write text theCmd
          end tell
          activate
        end tell
      else
        tell application "Terminal"
          do script theCmd
          activate
        end tell
      end if
    end run
  `;

  execFile("osascript", ["-e", appleScript, "--", display], (err) => {
    if (err) console.error("AppleScript error:", err);
  });

  return NextResponse.json({ ok: true, command: cmd });
}
