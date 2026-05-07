import { describe, it, expect } from "vitest";
import { scanForPrompt, stripAnsi } from "./prompt-detector";

const SECRET = { hasStoredSecret: true, alreadyInjected: false } as const;

describe("stripAnsi", () => {
  it("strips CSI sequences", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m")).toBe("error");
    expect(stripAnsi("\x1b[2K\x1b[1G$ ")).toBe("$ ");
  });
  it("strips OSC sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07hello")).toBe("hello");
  });
  it("leaves plain text alone", () => {
    expect(stripAnsi("Password:")).toBe("Password:");
  });
});

describe("scanForPrompt — password prompts", () => {
  it("matches OpenSSH 'Password:'", () => {
    expect(scanForPrompt({ recentOutput: "Password: ", ...SECRET }))
      .toEqual({ kind: "inject_password" });
  });

  it("matches 'user@host's password:'", () => {
    expect(scanForPrompt({ recentOutput: "davy.tan@switch.example.com's password: ", ...SECRET }))
      .toEqual({ kind: "inject_password" });
  });

  it("matches Arista-style '(user@host) Password:'", () => {
    expect(scanForPrompt({
      recentOutput: "** WARNING: ...\n(davy.tan@ar-7050sx348c8-i-1-ldp02-gb) Password: ",
      ...SECRET,
    })).toEqual({ kind: "inject_password" });
  });

  it("matches uppercased 'PASSWORD:'", () => {
    expect(scanForPrompt({ recentOutput: "PASSWORD: ", ...SECRET }))
      .toEqual({ kind: "inject_password" });
  });

  it("matches 'Login Password:'", () => {
    expect(scanForPrompt({ recentOutput: "Login Password: ", ...SECRET }))
      .toEqual({ kind: "inject_password" });
  });

  it("works through ANSI colour codes", () => {
    expect(scanForPrompt({
      recentOutput: "\x1b[33m\x1b[1mPassword:\x1b[0m ",
      ...SECRET,
    })).toEqual({ kind: "inject_password" });
  });
});

describe("scanForPrompt — passphrase prompts", () => {
  it("matches OpenSSH 'Enter passphrase for key '/path':'", () => {
    expect(scanForPrompt({
      recentOutput: "Enter passphrase for key '/Users/davytan/.ssh/id_rsa': ",
      ...SECRET,
    })).toEqual({ kind: "inject_passphrase" });
  });

  it("matches without 'key' word", () => {
    expect(scanForPrompt({
      recentOutput: "Enter passphrase for /Users/davytan/.ssh/foo.pub: ",
      ...SECRET,
    })).toEqual({ kind: "inject_passphrase" });
  });
});

describe("scanForPrompt — refuses on MFA", () => {
  it("skips when 'verification code' anywhere in tail", () => {
    const r = scanForPrompt({
      recentOutput: "Verification code:\n\nPassword: ", // password follows, but we still skip
      ...SECRET,
    });
    expect(r.kind).toBe("skip");
  });

  it("skips on 'Duo push'", () => {
    const r = scanForPrompt({
      recentOutput: "Duo push notification sent\nPassword: ",
      ...SECRET,
    });
    expect(r.kind).toBe("skip");
  });

  it("skips on YubiKey hint", () => {
    const r = scanForPrompt({
      recentOutput: "Touch your yubikey: ",
      ...SECRET,
    });
    expect(r.kind).toBe("skip");
  });

  it("skips on '2fa code'", () => {
    const r = scanForPrompt({
      recentOutput: "Enter 2fa code: ",
      ...SECRET,
    });
    expect(r.kind).toBe("skip");
  });
});

describe("scanForPrompt — never injects on fingerprint or yes/no", () => {
  it("skips 'continue connecting (yes/no)?'", () => {
    const r = scanForPrompt({
      recentOutput: "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
      ...SECRET,
    });
    expect(r.kind).toBe("skip");
  });
});

describe("scanForPrompt — already-injected guard", () => {
  it("refuses second injection in same session", () => {
    const r = scanForPrompt({
      recentOutput: "Password: ",
      alreadyInjected: true,
      hasStoredSecret: true,
    });
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toMatch(/already/i);
  });
});

describe("scanForPrompt — no stored secret", () => {
  it("returns skip when there's nothing to inject", () => {
    const r = scanForPrompt({
      recentOutput: "Password: ",
      alreadyInjected: false,
      hasStoredSecret: false,
    });
    expect(r.kind).toBe("skip");
  });
});

describe("scanForPrompt — false-positive guards", () => {
  it("does NOT match 'Password:' mid-line", () => {
    const r = scanForPrompt({
      recentOutput: "Documentation says: 'set the Password:foo' as ENV.\n$ ",
      ...SECRET,
    });
    expect(r.kind).toBe("none");
  });

  it("does NOT match a man-page line ending with 'password:'", () => {
    const r = scanForPrompt({
      recentOutput: "see also: ssh_config(5) password:\n$ ", // last line is "$ "
      ...SECRET,
    });
    expect(r.kind).toBe("none");
  });

  it("requires the prompt at the end of the LAST non-empty line", () => {
    // Trailing newlines are fine — last non-empty line is the password prompt.
    const r = scanForPrompt({ recentOutput: "Password: \n", ...SECRET });
    expect(r.kind).toBe("inject_password");
  });

  it("returns none for empty input", () => {
    expect(scanForPrompt({ recentOutput: "", ...SECRET }).kind).toBe("none");
    expect(scanForPrompt({ recentOutput: "    \n  \n", ...SECRET }).kind).toBe("none");
  });

  it("returns none for an ordinary shell prompt", () => {
    expect(scanForPrompt({ recentOutput: "davytan@MacBook ~ % ", ...SECRET }).kind).toBe("none");
  });
});
