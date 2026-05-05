// Server-only. ssh-keygen and ssh-copy-id helpers.

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const KEYS_DIR = path.join(os.homedir(), ".ssh", "ssh-manager");

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export interface GenerateKeyResult {
  privatePath: string;
  publicPath: string;
  publicKey: string;
  fingerprint?: string;
}

/** Generate an ed25519 SSH key pair under ~/.ssh/ssh-manager/{name}.key (+.pub). */
export async function generateKey(opts: {
  name: string;          // logical name, sanitized
  comment?: string;      // shows up at end of public key — usually user@host
  passphrase?: string;   // empty = no passphrase
}): Promise<GenerateKeyResult> {
  ensureKeysDir();
  if (!SAFE_NAME_RE.test(opts.name)) throw new Error("invalid key name");

  const privatePath = path.join(KEYS_DIR, `${opts.name}.key`);
  const publicPath = `${privatePath}.pub`;

  if (fs.existsSync(privatePath)) {
    // Already exists — return it, don't overwrite.
    const pub = fs.readFileSync(publicPath, "utf8").trim();
    return { privatePath, publicPath, publicKey: pub };
  }

  const args = [
    "-t", "ed25519",
    "-f", privatePath,
    "-N", opts.passphrase || "",
    "-q",
  ];
  if (opts.comment) args.push("-C", opts.comment);

  await execFileAsync("ssh-keygen", args, { timeout: 30_000 });
  fs.chmodSync(privatePath, 0o600);
  fs.chmodSync(publicPath, 0o644);

  const pub = fs.readFileSync(publicPath, "utf8").trim();
  return { privatePath, publicPath, publicKey: pub };
}

export function listManagedKeys(): Array<{ name: string; privatePath: string; publicPath: string }> {
  if (!fs.existsSync(KEYS_DIR)) return [];
  const out: Array<{ name: string; privatePath: string; publicPath: string }> = [];
  for (const f of fs.readdirSync(KEYS_DIR)) {
    if (f.endsWith(".key") && fs.existsSync(path.join(KEYS_DIR, f + ".pub"))) {
      out.push({
        name: f.replace(/\.key$/, ""),
        privatePath: path.join(KEYS_DIR, f),
        publicPath: path.join(KEYS_DIR, f + ".pub"),
      });
    }
  }
  return out;
}

export function getKeysDir() { return KEYS_DIR; }
