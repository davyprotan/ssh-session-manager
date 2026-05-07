// Generate `~/.ssh/config` Host blocks from saved sessions + profiles.
// Pure function — no fs, no env. Easy to unit-test.

export const BEGIN_MARKER = "# === BEGIN SSH Manager managed block — do not edit between markers, regenerate from app ===";
export const END_MARKER = "# === END SSH Manager managed block ===";

export interface ExportSession {
  name: string;
  host: string;
  port: number;
  jump_host?: string | null;
  profile?: ExportProfile | null;
}

export interface ExportProfile {
  username: string;
  auth_type: "password" | "key" | "key_with_passphrase";
  key_path?: string | null;
  port?: number;
  agent_forwarding?: number;
  compression?: number;
  server_alive_interval?: number;
  extra_args?: string | null;
  uses_keychain?: number;
}

export interface GenerateOptions {
  /** ISO timestamp for the header comment. Defaults to "now". Tests can pin it. */
  generatedAt?: string;
  /** Whether the host machine running ssh is macOS (controls `UseKeychain yes` emission). */
  isMacOS?: boolean;
}

const HOST_ALIAS_RE = /^[a-zA-Z0-9._:%\-]+$/;
const HOST_NAME_RE = /^[a-zA-Z0-9._:%\-]+$/;
const SAFE_VAL_RE = /^[a-zA-Z0-9._/~\-+@:]+$/;

/**
 * Slugify a session name into a usable Host alias. Replaces whitespace and
 * unsafe characters with `-`, collapses repeats, trims `-` from the ends.
 */
export function slugifyHostAlias(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Turn a list of sessions into a single ssh_config managed block. Skips any
 * session whose host fails the safe-character check (defensive — the validator
 * should have caught these on the way into the DB, but we don't want a junk
 * row producing a config-injection vector).
 */
export function generateSshConfigBlock(
  sessions: ExportSession[],
  options: GenerateOptions = {},
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const isMacOS = options.isMacOS ?? true;

  const out: string[] = [
    BEGIN_MARKER,
    `# Generated: ${generatedAt}`,
    `# ${sessions.length} session${sessions.length === 1 ? "" : "s"} from SSH Manager`,
    "#",
    "# Edits inside this block are overwritten on the next sync.",
    "# Add your own entries OUTSIDE the markers — those are preserved.",
  ];

  let emitted = 0;
  for (const s of sessions) {
    if (!HOST_NAME_RE.test(s.host)) continue;

    const alias = slugifyHostAlias(s.name) || s.host;
    if (!HOST_ALIAS_RE.test(alias)) continue;

    out.push("");
    // If the slug equals the host, one Host pattern is enough; otherwise list both
    // so users can ssh by either friendly name or hostname.
    if (alias === s.host) {
      out.push(`Host ${s.host}`);
    } else {
      out.push(`Host ${alias} ${s.host}`);
    }
    out.push(`    HostName ${s.host}`);

    const p = s.profile;
    if (p?.username && SAFE_VAL_RE.test(p.username)) {
      out.push(`    User ${p.username}`);
    }
    if (s.port && s.port !== 22) {
      out.push(`    Port ${s.port}`);
    }
    if (s.jump_host) {
      // jump_host is validated by the body validator, but be defensive
      if (/^(?:[a-zA-Z0-9._-]{1,64}@)?[a-zA-Z0-9._:%\-]+(?::\d{1,5})?$/.test(s.jump_host)) {
        out.push(`    ProxyJump ${s.jump_host}`);
      }
    }

    if (p?.auth_type === "key" || p?.auth_type === "key_with_passphrase") {
      if (p.key_path && SAFE_VAL_RE.test(p.key_path)) {
        out.push(`    IdentityFile ${p.key_path}`);
        out.push(`    IdentitiesOnly yes`);
      }
    } else if (p?.auth_type === "password") {
      // Network gear (Arista, ADVA, Cisco, …) often only accepts passwords.
      // On macOS, `UseKeychain yes` lets the keychain remember the password
      // after one entry — Touch ID supplies it on subsequent connections.
      // On non-macOS the directive is unknown and ssh errors, so skip it.
      if (isMacOS) {
        out.push(`    UseKeychain yes`);
        out.push(`    AddKeysToAgent yes`);
      }
      // Prefer the methods most likely to actually work on network gear, in
      // order. The OS will fall back through them automatically.
      out.push(`    PreferredAuthentications publickey,keyboard-interactive,password`);
    }

    if (p?.compression) out.push(`    Compression yes`);
    if (p?.agent_forwarding) out.push(`    ForwardAgent yes`);
    if (p?.server_alive_interval && p.server_alive_interval > 0) {
      out.push(`    ServerAliveInterval ${p.server_alive_interval}`);
    }

    emitted++;
  }

  if (emitted === 0) {
    out.push("");
    out.push("# (no sessions to emit)");
  }

  out.push("");
  out.push(END_MARKER);
  return out.join("\n");
}

/**
 * Splice a managed block into existing ssh_config text. If the block is
 * already present (delimited by BEGIN_MARKER / END_MARKER), replace it in
 * place. Otherwise append to the end with a single blank line of separation.
 *
 * Pure function — caller does I/O.
 */
export function spliceManagedBlock(existing: string, newBlock: string): string {
  const beginIdx = existing.indexOf(BEGIN_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    // No marker block — append.
    const trimmed = existing.replace(/\s+$/, "");
    if (trimmed === "") return newBlock + "\n";
    return trimmed + "\n\n" + newBlock + "\n";
  }

  // Replace from BEGIN_MARKER through end-of-line of END_MARKER.
  const blockEnd = existing.indexOf("\n", endIdx);
  const before = existing.slice(0, beginIdx).replace(/\s+$/, "");
  const after = blockEnd === -1 ? "" : existing.slice(blockEnd + 1).replace(/^\s+/, "");

  const parts: string[] = [];
  if (before) parts.push(before, "");
  parts.push(newBlock);
  if (after) parts.push("", after);
  return parts.join("\n").replace(/\n*$/, "\n");
}

/** Strip the managed block from existing config, returning what was preserved. */
export function removeManagedBlock(existing: string): string {
  const beginIdx = existing.indexOf(BEGIN_MARKER);
  const endIdx = existing.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return existing;
  const blockEnd = existing.indexOf("\n", endIdx);
  const before = existing.slice(0, beginIdx).replace(/\s+$/, "");
  const after = blockEnd === -1 ? "" : existing.slice(blockEnd + 1).replace(/^\s+/, "");
  if (!before && !after) return "";
  if (!before) return after.replace(/\n*$/, "\n");
  if (!after) return before + "\n";
  return before + "\n\n" + after.replace(/\n*$/, "\n");
}
