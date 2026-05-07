// CommonJS twin of src/lib/prompt-detector.ts. The TS version is the source
// of truth (it has full test coverage). A drift-detector test compares the
// outputs of both modules across fixtures so the two never get out of sync.
//
// IF YOU CHANGE THE REGEXES HERE, ALSO CHANGE src/lib/prompt-detector.ts AND
// VERIFY `npm test` STILL PASSES.

const ANSI_ESCAPE_RE =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|\x1b[\x40-\x5f]/g;

const PASSWORD_PROMPT_RE =
  /(?:^|[\s\)\]])(?:[\w.@\-]+(?:[''`]s)?\s+)?(?:password|passcode|passwd|login\s+password)\s*:\s*$/i;

const PASSPHRASE_PROMPT_RE =
  /enter\s+passphrase\s+for(?:\s+key)?\s*['"]?[^\n]*?['"]?\s*:\s*$/i;

const MFA_INDICATORS_RE =
  /(?:verification\s+code|one[\s\-]?time\s+(?:code|password)|otp\s*(?:code)?|2fa\s+code|duo\s+(?:push|prompt|passcode)|authy|yubikey|rsa\s+token|push\s+notification|enter\s+the\s+code)/i;

const YESNO_PROMPT_RE = /\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i;

function stripAnsi(s) {
  return s.replace(ANSI_ESCAPE_RE, "");
}

function scanForPrompt(input) {
  const cleaned = stripAnsi(input.recentOutput);
  const lines = cleaned.split(/\r?\n/);
  let lastLine = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].replace(/\s+$/, "");
    if (t.trim() !== "") { lastLine = t; break; }
  }
  if (!lastLine) return { kind: "none" };

  if (YESNO_PROMPT_RE.test(lastLine)) {
    return { kind: "skip", reason: "yes/no prompt — never auto-inject" };
  }

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

module.exports = { stripAnsi, scanForPrompt };
