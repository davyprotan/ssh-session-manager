// Lightweight, dependency-free body validators.
// Each parser returns a typed object or throws ValidationError.

export class ValidationError extends Error {
  status = 400;
}

function s(v: unknown, max = 256): string {
  if (typeof v !== 'string') throw new ValidationError('expected string');
  if (v.length > max) throw new ValidationError('string too long');
  return v;
}
function sOpt(v: unknown, max = 256): string | null {
  if (v == null || v === '') return null;
  return s(v, max);
}
function num(v: unknown, min: number, max: number, def?: number): number {
  if (v == null || v === '') {
    if (def !== undefined) return def;
    throw new ValidationError('expected number');
  }
  const n = typeof v === 'number' ? v : parseInt(String(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError('number out of range');
  return n;
}
function bool(v: unknown, def = false): number {
  if (v === undefined || v === null) return def ? 1 : 0;
  return v ? 1 : 0;
}
function id(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v));
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError('invalid id');
  return n;
}
function arr<T>(v: unknown, max = 50, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) return [];
  if (v.length > max) throw new ValidationError('array too long');
  return v.map(item);
}

const COLOR_VALS = new Set(['cyan', 'green', 'amber', 'purple', 'pink', 'rose']);
function color(v: unknown, def = 'cyan'): string {
  if (v == null || v === '') return def;
  const c = s(v, 16);
  if (!COLOR_VALS.has(c)) throw new ValidationError('invalid color');
  return c;
}

const AUTH_TYPES = new Set(['key', 'key_with_passphrase', 'password']);
function authType(v: unknown): string {
  const t = s(v, 32);
  if (!AUTH_TYPES.has(t)) throw new ValidationError('invalid auth_type');
  return t;
}

// Hostname / IP — same rules as the SSH builder
const HOST_RE = /^[a-zA-Z0-9._:%\-]+$/;
function host(v: unknown): string {
  const h = s(v, 253);
  if (!HOST_RE.test(h)) throw new ValidationError('invalid host');
  return h;
}
// Jump host — user@host[:port]
const JUMP_RE = /^(?:[a-zA-Z0-9._-]{1,64}@)?[a-zA-Z0-9._:%\-]+(?::\d{1,5})?$/;
function jumpHost(v: unknown): string | null {
  if (v == null || v === '') return null;
  const j = s(v, 256);
  if (!JUMP_RE.test(j)) throw new ValidationError('invalid jump_host');
  return j;
}

// Username
function username(v: unknown): string {
  const u = s(v, 64);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(u)) throw new ValidationError('invalid username');
  return u;
}

// Key path — keep permissive but reject obvious metacharacters
function keyPath(v: unknown): string | null {
  if (v == null || v === '') return null;
  const p = s(v, 4096);
  if (/[;|&<>$`"\n\r]/.test(p)) throw new ValidationError('invalid key_path');
  return p;
}

// Extra args — allowlist of `-o Key=Value` pairs only
function extraArgs(v: unknown): string | null {
  if (v == null || v === '') return null;
  const t = s(v, 1024).trim();
  if (!t) return null;
  if (!/^(\s*-o\s+[A-Za-z0-9]+(?:=[A-Za-z0-9._\-/+,@:]*)?)+\s*$/.test(t)) {
    throw new ValidationError('extra_args must be one or more "-o Key=Value" pairs');
  }
  return t;
}

export function parseProfile(body: unknown) {
  if (!body || typeof body !== 'object') throw new ValidationError('expected object');
  const b = body as Record<string, unknown>;
  return {
    name: s(b.name, 128).trim(),
    username: username(b.username),
    auth_type: authType(b.auth_type),
    password: sOpt(b.password, 4096),
    key_path: keyPath(b.key_path),
    port: num(b.port, 1, 65535, 22),
    color: color(b.color),
    is_default: bool(b.is_default),
    agent_forwarding: bool(b.agent_forwarding),
    compression: bool(b.compression),
    server_alive_interval: num(b.server_alive_interval, 0, 86400, 0),
    extra_args: extraArgs(b.extra_args),
    compat_legacy: bool(b.compat_legacy),
  };
}

export function parseSession(body: unknown) {
  if (!body || typeof body !== 'object') throw new ValidationError('expected object');
  const b = body as Record<string, unknown>;
  return {
    name: s(b.name, 128).trim(),
    host: host(b.host),
    port: num(b.port, 1, 65535, 22),
    profile_id: id(b.profile_id),
    folder_id: id(b.folder_id),
    jump_host: jumpHost(b.jump_host),
    tags: arr(b.tags, 20, (x) => s(x, 64)),
    notes: sOpt(b.notes, 4096),
  };
}

export function parseFolder(body: unknown) {
  if (!body || typeof body !== 'object') throw new ValidationError('expected object');
  const b = body as Record<string, unknown>;
  return {
    name: s(b.name, 64).trim(),
    color: color(b.color),
  };
}
