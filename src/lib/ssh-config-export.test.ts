import { describe, it, expect } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  generateSshConfigBlock,
  spliceManagedBlock,
  removeManagedBlock,
  slugifyHostAlias,
  type ExportSession,
} from "./ssh-config-export";

const FIXED_TIME = "2026-05-07T12:00:00.000Z";

function gen(sessions: ExportSession[], opts = {}): string {
  return generateSshConfigBlock(sessions, { generatedAt: FIXED_TIME, isMacOS: true, ...opts });
}

describe("slugifyHostAlias", () => {
  it("preserves safe names", () => {
    expect(slugifyHostAlias("Oxidized")).toBe("Oxidized");
    expect(slugifyHostAlias("AR-7050SX348C8")).toBe("AR-7050SX348C8");
  });

  it("replaces spaces and unsafe chars with -", () => {
    expect(slugifyHostAlias("Sohonet Software Repository")).toBe("Sohonet-Software-Repository");
    expect(slugifyHostAlias("foo / bar")).toBe("foo-bar");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugifyHostAlias("  ?? hello ??  ")).toBe("hello");
  });
});

describe("generateSshConfigBlock", () => {
  it("emits the markers and a header", () => {
    const out = gen([]);
    expect(out).toContain(BEGIN_MARKER);
    expect(out).toContain(END_MARKER);
    expect(out).toContain("Generated: " + FIXED_TIME);
  });

  it("emits a Host block for a key-auth session", () => {
    const out = gen([{
      name: "configsync",
      host: "configsync.sohonet.internal",
      port: 22,
      profile: { username: "davytan", auth_type: "key", key_path: "~/.ssh/id_rsa" },
    }]);
    expect(out).toMatch(/^Host configsync configsync\.sohonet\.internal$/m);
    expect(out).toMatch(/^    HostName configsync\.sohonet\.internal$/m);
    expect(out).toMatch(/^    User davytan$/m);
    expect(out).toMatch(/^    IdentityFile ~\/\.ssh\/id_rsa$/m);
    expect(out).toMatch(/^    IdentitiesOnly yes$/m);
    expect(out).not.toMatch(/UseKeychain/);
  });

  it("emits UseKeychain + AddKeysToAgent on macOS for password-auth", () => {
    const out = gen([{
      name: "Oxidized",
      host: "XN-XSVM-S-454-LDPVM-GB",
      port: 22,
      profile: { username: "davy.tan", auth_type: "password" },
    }]);
    expect(out).toMatch(/^    User davy\.tan$/m);
    expect(out).toMatch(/^    UseKeychain yes$/m);
    expect(out).toMatch(/^    AddKeysToAgent yes$/m);
    expect(out).toMatch(/^    PreferredAuthentications publickey,keyboard-interactive,password$/m);
    expect(out).not.toMatch(/IdentityFile/);
  });

  it("omits UseKeychain when not on macOS", () => {
    const out = gen([{
      name: "x",
      host: "h.example.com",
      port: 22,
      profile: { username: "u", auth_type: "password" },
    }], { isMacOS: false });
    expect(out).not.toMatch(/UseKeychain/);
    expect(out).not.toMatch(/AddKeysToAgent/);
    // PreferredAuthentications is still emitted (cross-platform).
    expect(out).toMatch(/^    PreferredAuthentications/m);
  });

  it("emits Port only when non-default", () => {
    const a = gen([{ name: "x", host: "h.example.com", port: 22 }]);
    const b = gen([{ name: "x", host: "h.example.com", port: 2222 }]);
    expect(a).not.toMatch(/^    Port /m);
    expect(b).toMatch(/^    Port 2222$/m);
  });

  it("emits ProxyJump when jump_host is set", () => {
    const out = gen([{
      name: "behind-bastion",
      host: "10.0.0.5",
      port: 22,
      jump_host: "user@bastion.example.com:2222",
    }]);
    expect(out).toMatch(/^    ProxyJump user@bastion\.example\.com:2222$/m);
  });

  it("collapses Host alias when slug equals hostname", () => {
    const out = gen([{ name: "h.example.com", host: "h.example.com", port: 22 }]);
    expect(out).toMatch(/^Host h\.example\.com$/m);
    expect(out).not.toMatch(/^Host h\.example\.com h\.example\.com$/m);
  });

  it("falls back to host as alias when name slugs to empty", () => {
    const out = gen([{ name: "?? !!", host: "h.example.com", port: 22 }]);
    expect(out).toMatch(/^Host h\.example\.com$/m);
  });

  it("skips a session with an unsafe host (defensive)", () => {
    const out = gen([{
      name: "evil",
      host: "host;rm -rf /",
      port: 22,
    }]);
    expect(out).not.toMatch(/host;rm/);
    expect(out).toContain("(no sessions to emit)");
  });

  it("emits compression / forward-agent / keepalive when set on profile", () => {
    const out = gen([{
      name: "tuned",
      host: "tuned.example.com",
      port: 22,
      profile: {
        username: "u", auth_type: "key",
        compression: 1, agent_forwarding: 1, server_alive_interval: 30,
      },
    }]);
    expect(out).toMatch(/^    Compression yes$/m);
    expect(out).toMatch(/^    ForwardAgent yes$/m);
    expect(out).toMatch(/^    ServerAliveInterval 30$/m);
  });

  it("emits multiple sessions in order, separated by blank lines", () => {
    const out = gen([
      { name: "a", host: "a.example.com", port: 22 },
      { name: "b", host: "b.example.com", port: 22 },
    ]);
    const aIdx = out.indexOf("Host a");
    const bIdx = out.indexOf("Host b");
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });
});

describe("spliceManagedBlock", () => {
  it("appends a block to an empty file", () => {
    const out = spliceManagedBlock("", "BLOCK\nLINE\n");
    expect(out).toContain("BLOCK");
  });

  it("appends a block to a file with no markers", () => {
    const existing = "Host my-thing\n    HostName my.example.com\n";
    const block = `${BEGIN_MARKER}\n# stuff\n${END_MARKER}`;
    const out = spliceManagedBlock(existing, block);
    expect(out.startsWith("Host my-thing")).toBe(true);
    expect(out).toContain(BEGIN_MARKER);
    expect(out).toContain(END_MARKER);
    // User content must not be touched.
    expect(out).toContain("HostName my.example.com");
  });

  it("replaces an existing managed block in place", () => {
    const oldBlock = `${BEGIN_MARKER}\n# old\nHost old\n${END_MARKER}`;
    const userPre = "# my own\nHost mine\n    HostName mine.example.com\n\n";
    const userPost = "\n# more of mine\nHost mine2\n    HostName mine2.example.com\n";
    const existing = userPre + oldBlock + userPost;

    const newBlock = `${BEGIN_MARKER}\n# new\nHost new\n${END_MARKER}`;
    const out = spliceManagedBlock(existing, newBlock);

    expect(out).toContain("Host mine");
    expect(out).toContain("Host mine2");
    expect(out).toContain("Host new");
    expect(out).not.toContain("Host old");
    expect(out).not.toContain("# old");
  });

  it("is idempotent — calling twice with the same block returns equivalent text", () => {
    const block = `${BEGIN_MARKER}\nHost x\n${END_MARKER}`;
    const a = spliceManagedBlock("Host pre\n", block);
    const b = spliceManagedBlock(a, block);
    expect(b).toBe(a);
  });
});

describe("removeManagedBlock", () => {
  it("returns existing unchanged when no block present", () => {
    expect(removeManagedBlock("Host x\n")).toBe("Host x\n");
  });

  it("removes the block, preserving user content on both sides", () => {
    const block = `${BEGIN_MARKER}\nHost x\n${END_MARKER}`;
    const text = `Host pre\n\n${block}\n\nHost post\n`;
    const out = removeManagedBlock(text);
    expect(out).toContain("Host pre");
    expect(out).toContain("Host post");
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain("Host x");
  });

  it("returns empty string if the file was only the managed block", () => {
    const block = `${BEGIN_MARKER}\nHost x\n${END_MARKER}\n`;
    expect(removeManagedBlock(block)).toBe("");
  });
});
