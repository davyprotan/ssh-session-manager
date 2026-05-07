// Shared helpers for resolving user-supplied SSH key paths.
// Server-only — uses os.homedir() and is not safe to send to the client.

import os from "os";
import path from "path";

/**
 * Resolve a user-supplied path against the home directory and require the
 * result to live inside `~/.ssh/`. Returns an absolute path string or `null`
 * if the input is missing, relative, malformed, or escapes the sandbox.
 *
 * Accepts:
 *   - `~/.ssh/foo`       → `/Users/<u>/.ssh/foo`
 *   - `/Users/<u>/.ssh/foo` (already absolute, must be under ~/.ssh)
 *
 * Rejects:
 *   - relative paths like `.ssh/foo`
 *   - paths under root that aren't in ~/.ssh, e.g. `/etc/passwd`
 *   - paths that try to escape via `..`, e.g. `~/.ssh/../../etc/passwd`
 *   - bare `~`
 */
export function resolveSshPath(input: string): string | null {
  if (!input) return null;
  let p = input;
  if (p === "~") return null;
  if (p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }
  p = path.normalize(p);
  if (!path.isAbsolute(p)) return null;

  const sshDir = path.join(os.homedir(), ".ssh");
  // Require the resolved path to be ~/.ssh itself or strictly underneath it.
  if (p !== sshDir && !p.startsWith(sshDir + path.sep)) return null;
  return p;
}
