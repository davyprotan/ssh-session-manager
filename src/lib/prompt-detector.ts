// Detect SSH password / passphrase prompts in pty output and decide whether
// it's safe to auto-inject a stored credential.
//
// SECURITY: false positives matter. If we mistake a normal command's output
// for a prompt and inject a password, the password ends up in the user's
// shell history (via stdin → typed-but-discarded by the shell?), the remote
// process, possibly logs. Worse, on MFA-enabled hosts, an auto-injected
// password could leak a Verification Code prompt.
//
// Strategy:
//   - Strip ANSI escape sequences (xterm colour, cursor moves) before matching
//   - Only match against the LAST line of output, after trimming whitespace,
//     so multi-line text that happens to contain "Password:" mid-string is
//     ignored
//   - If we detect an MFA-style prompt anywhere in the recent tail, refuse to
//     auto-inject for the rest of this session — better safe than sorry
//   - Never auto-inject more than once per session. If the first password was
//     wrong, the user types the next one themselves (we can't tell the
//     password is wrong, and re-injecting the same wrong one risks lockout)

const ANSI_ESCAPE_RE =
  // CSI sequences: ESC [ ... letter
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|\x1b[\x40-\x5f]/g;

// Server password prompts. Matches things like:
//   "Password: "
//   "user@host's password:"
//   "(davy.tan@switch) Password:"
//   "Login Password:"
//   "PASSWORD:"
//   "your password is required:" — fuzzy
const PASSWORD_PROMPT_RE =
  /(?:^|[\s\)\]])(?:[\w.@\-]+(?:[''`]s)?\s+)?(?:password|passcode|passwd|login\s+password)\s*:\s*$/i;

// Local key passphrase prompts (keep distinct because we may have a
// passphrase stored under uses_keychain too).
const PASSPHRASE_PROMPT_RE =
  /enter\s+passphrase\s+for(?:\s+key)?\s*['"]?[^\n]*?['"]?\s*:\s*$/i;

// MFA / OTP / push-style prompts. If any of these appear in the recent tail,
// we *never* auto-inject. Coverage: Duo, Authy, generic OTP, YubiKey OTP,
// generic verification code, RSA tokens.
const MFA_INDICATORS_RE =
  /(?:verification\s+code|one[\s\-]?time\s+(?:code|password)|otp\s*(?:code)?|2fa\s+code|duo\s+(?:push|prompt|passcode)|authy|yubikey|rsa\s+token|push\s+notification|enter\s+the\s+code)/i;

// PERMIT confirmation prompts ("Are you sure you want to continue connecting (yes/no)?")
// Auto-injecting a password into a yes/no prompt is harmful; explicitly skip.
const YESNO_PROMPT_RE = /\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i;

export interface PromptScanInput {
  /** Recent pty output (we recommend ~4 KB tail max). Bytes already decoded to UTF-8. */
  recentOutput: string;
  /** Has this session already had its password auto-injected? */
  alreadyInjected: boolean;
  /** Whether the active profile actually has a stored secret. */
  hasStoredSecret: boolean;
}

export type PromptScanResult =
  | { kind: "inject_password" }
  | { kind: "inject_passphrase" }
  | { kind: "skip"; reason: string }
  | { kind: "none" };

/** Strip ANSI escapes for matching. We don't strip them from what gets shown to the user. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE_RE, "");
}

/**
 * Decide whether to inject a stored credential based on the recent pty output.
 *
 * - Returns `{kind: "inject_password"}` when the last line of recent output
 *   looks like a password/passcode prompt and no MFA-context is present.
 * - Returns `{kind: "inject_passphrase"}` for ssh key passphrase prompts.
 * - Returns `{kind: "skip", reason}` if we detected something but bail
 *   (MFA, yes/no prompt, already injected, no secret).
 * - Returns `{kind: "none"}` if no prompt was detected at all.
 */
export function scanForPrompt(input: PromptScanInput): PromptScanResult {
  const cleaned = stripAnsi(input.recentOutput);

  // Pull the last non-empty line for the prompt match.
  const lines = cleaned.split(/\r?\n/);
  let lastLine = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].replace(/\s+$/, "");
    // Some prompts come without a trailing newline, on the very last cursor
    // position. Use the last non-empty line as our match target.
    if (t.trim() !== "") { lastLine = t; break; }
  }
  if (!lastLine) return { kind: "none" };

  if (YESNO_PROMPT_RE.test(lastLine)) {
    return { kind: "skip", reason: "yes/no prompt — never auto-inject" };
  }

  // If anywhere in the recent tail there's MFA wording, refuse for the
  // session. This is intentionally aggressive to err on the safe side.
  if (MFA_INDICATORS_RE.test(cleaned)) {
    return { kind: "skip", reason: "MFA / OTP indicator detected" };
  }

  const isPasswordPrompt = PASSWORD_PROMPT_RE.test(lastLine);
  const isPassphrasePrompt = PASSPHRASE_PROMPT_RE.test(lastLine);

  if (!isPasswordPrompt && !isPassphrasePrompt) return { kind: "none" };

  if (input.alreadyInjected) {
    return { kind: "skip", reason: "already auto-injected once this session" };
  }
  if (!input.hasStoredSecret) {
    return { kind: "skip", reason: "no stored secret for this profile" };
  }

  return isPassphrasePrompt
    ? { kind: "inject_passphrase" }
    : { kind: "inject_password" };
}
