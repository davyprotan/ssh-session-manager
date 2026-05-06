import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeOrigin, assertSafeRead } from './api-guard';

function make(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://127.0.0.1:3005/api/anything', {
    method,
    headers,
  });
}

describe('assertSafeOrigin', () => {
  it('allows POST with matching Origin', () => {
    expect(assertSafeOrigin(make('POST', { origin: 'http://127.0.0.1:3005' }))).toBeNull();
  });

  it('allows POST with matching Referer', () => {
    expect(assertSafeOrigin(make('POST', { referer: 'http://127.0.0.1:3005/profiles' }))).toBeNull();
  });

  it('rejects POST with no origin/referer', () => {
    const r = assertSafeOrigin(make('POST', {}));
    expect(r?.status).toBe(403);
  });

  it('rejects POST with foreign origin', () => {
    const r = assertSafeOrigin(make('POST', { origin: 'http://evil.example.com' }));
    expect(r?.status).toBe(403);
  });

  it('case-insensitive on origin scheme/host', () => {
    expect(assertSafeOrigin(make('POST', { origin: 'HTTP://127.0.0.1:3005' }))).toBeNull();
    expect(assertSafeOrigin(make('POST', { origin: 'http://LocalHost:3005' }))).toBeNull();
  });

  it('accepts IPv6 loopback', () => {
    expect(assertSafeOrigin(make('POST', { origin: 'http://[::1]:3005' }))).toBeNull();
    expect(assertSafeOrigin(make('POST', { referer: 'http://[::1]:3005/x' }))).toBeNull();
  });

  it('case-insensitive on referer', () => {
    expect(assertSafeOrigin(make('POST', { referer: 'HTTP://127.0.0.1:3005/PROFILES' }))).toBeNull();
  });

  it('GET passes without origin', () => {
    expect(assertSafeOrigin(make('GET', {}))).toBeNull();
  });

  it('rejects similar-but-not-equal origin (prefix attack)', () => {
    const r = assertSafeOrigin(make('POST', { origin: 'http://127.0.0.1:30050' }));
    expect(r?.status).toBe(403);
  });

  it('rejects referer that only contains the allowed origin as a substring', () => {
    const r = assertSafeOrigin(make('POST', { referer: 'http://attacker.example.com/?u=http://127.0.0.1:3005/' }));
    expect(r?.status).toBe(403);
  });
});

describe('assertSafeRead', () => {
  it('allows GET with matching Origin', () => {
    expect(assertSafeRead(make('GET', { origin: 'http://127.0.0.1:3005' }))).toBeNull();
  });

  it('rejects GET with no origin/referer', () => {
    const r = assertSafeRead(make('GET', {}));
    expect(r?.status).toBe(403);
  });

  it('case-insensitive', () => {
    expect(assertSafeRead(make('GET', { origin: 'HTTP://127.0.0.1:3005' }))).toBeNull();
  });
});
