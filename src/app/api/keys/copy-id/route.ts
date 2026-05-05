// Open Terminal/iTerm2 with `ssh-copy-id` so the user types their password ONE LAST TIME.
// After it succeeds, ssh-copy-id installs the public key into the host's authorized_keys.
// We don't try to capture the result — the user clicks "It worked" or "Try again" in the UI.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { assertSafeOrigin } from "@/lib/api-guard";

const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const KEY_RE = /^[a-zA-Z0-9._/~\-+ ]+$/;

function escAS(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export async function POST(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const host = typeof body.host === "string" ? body.host.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const publicKeyPath = typeof body.public_key_path === "string" ? body.public_key_path.trim() : "";
  const port = Number.isInteger(body.port) ? body.port : (parseInt(String(body.port)) || 22);
  const jumpHost = typeof body.jump_host === "string" ? body.jump_host.trim() : "";

  if (!host || !HOST_RE.test(host)) return NextResponse.json({ error: "invalid host" }, { status: 400 });
  if (!username || !USER_RE.test(username)) return NextResponse.json({ error: "invalid username" }, { status: 400 });
  if (!publicKeyPath || !KEY_RE.test(publicKeyPath)) return NextResponse.json({ error: "invalid public_key_path" }, { status: 400 });
  if (port < 1 || port > 65535) return NextResponse.json({ error: "invalid port" }, { status: 400 });

  // Build ssh-copy-id command
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

  // Open in iTerm2 (write text into a fresh shell so the window stays open after exit)
  // or Terminal as fallback
  const escaped = escAS(display);
  const appleScript = `
    tell application "System Events"
      set appList to name of every application process
    end tell
    if appList contains "iTerm2" or appList contains "iTerm" then
      tell application "iTerm"
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${escaped}"
        end tell
        activate
      end tell
    else
      tell application "Terminal"
        do script "${escaped}"
        activate
      end tell
    end if
  `;

  execFile("osascript", ["-e", appleScript], (err) => {
    if (err) console.error("AppleScript error:", err);
  });

  return NextResponse.json({ ok: true, command: cmd });
}
