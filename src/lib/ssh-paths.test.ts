import { describe, it, expect } from "vitest";
import os from "os";
import path from "path";
import { resolveSshPath } from "./ssh-paths";

const HOME = os.homedir();
const SSH = path.join(HOME, ".ssh");

describe("resolveSshPath", () => {
  it("expands ~/ to the home directory", () => {
    expect(resolveSshPath("~/.ssh/id_rsa.pub")).toBe(path.join(SSH, "id_rsa.pub"));
  });

  it("accepts already-absolute paths under ~/.ssh", () => {
    const p = path.join(SSH, "ssh-manager", "foo.key.pub");
    expect(resolveSshPath(p)).toBe(p);
  });

  it("rejects the broken `/.ssh/...` form (legacy bug)", () => {
    // This is the exact malformed input that triggered the fix:
    // SetupPasswordlessDialog used to strip the `~` without expanding it.
    expect(resolveSshPath("/.ssh/id_rsa.pub")).toBeNull();
  });

  it("rejects paths outside ~/.ssh", () => {
    expect(resolveSshPath("/etc/passwd")).toBeNull();
    expect(resolveSshPath("/tmp/key.pub")).toBeNull();
    expect(resolveSshPath(path.join(HOME, "Documents", "key.pub"))).toBeNull();
  });

  it("rejects relative paths", () => {
    expect(resolveSshPath(".ssh/id_rsa.pub")).toBeNull();
    expect(resolveSshPath("id_rsa.pub")).toBeNull();
  });

  it("rejects empty / bare-tilde input", () => {
    expect(resolveSshPath("")).toBeNull();
    expect(resolveSshPath("~")).toBeNull();
  });

  it("rejects ../ traversal attempts via normalization", () => {
    expect(resolveSshPath("~/.ssh/../../etc/passwd")).toBeNull();
    expect(resolveSshPath(path.join(SSH, "..", "..", "etc", "passwd"))).toBeNull();
  });

  it("accepts ~/.ssh itself (the directory)", () => {
    expect(resolveSshPath("~/.ssh")).toBe(SSH);
  });
});
