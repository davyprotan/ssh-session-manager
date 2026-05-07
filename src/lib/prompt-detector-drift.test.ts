// Cross-checks src/lib/prompt-detector.ts against electron/lib/prompt-detector.js
// to catch drift between the two implementations.

import { describe, it, expect } from "vitest";
import { scanForPrompt as ts_scan, stripAnsi as ts_strip } from "./prompt-detector";

// Use a relative import via require since the CJS module isn't a TS source.
// Vitest's node env supports this directly.

import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const cjs = require_("../../electron/lib/prompt-detector.js") as {
  scanForPrompt: typeof ts_scan;
  stripAnsi: typeof ts_strip;
};

const FIXTURES = [
  { recentOutput: "Password: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Password: ", alreadyInjected: true, hasStoredSecret: true },
  { recentOutput: "PASSWORD: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "user@host's password: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "(davy.tan@switch) Password: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Enter passphrase for key '/Users/x/.ssh/id_rsa': ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "\x1b[33mPassword:\x1b[0m ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Verification code: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Duo push notification sent\nPassword: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Are you sure you want to continue connecting (yes/no/[fingerprint])?", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Touch your yubikey: ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "$ ", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "", alreadyInjected: false, hasStoredSecret: true },
  { recentOutput: "Password: ", alreadyInjected: false, hasStoredSecret: false },
  { recentOutput: "echo 'Password:' from script\n$ ", alreadyInjected: false, hasStoredSecret: true },
];

describe("prompt-detector drift between TS and CJS implementations", () => {
  it("stripAnsi produces identical output", () => {
    for (const f of FIXTURES) {
      expect(cjs.stripAnsi(f.recentOutput), `stripAnsi mismatch on: ${JSON.stringify(f.recentOutput)}`)
        .toBe(ts_strip(f.recentOutput));
    }
  });

  it("scanForPrompt produces identical decisions", () => {
    for (const f of FIXTURES) {
      const a = ts_scan(f);
      const b = cjs.scanForPrompt(f);
      expect(b, `scanForPrompt drift on: ${JSON.stringify(f)}`).toEqual(a);
    }
  });
});
