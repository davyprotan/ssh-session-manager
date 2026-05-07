import type { NextConfig } from "next";

// Defense-in-depth CSP. The renderer only ever loads this app's own assets and talks to
// its own /api/* endpoints, so `'self'` covers nearly everything.
//
// `'unsafe-inline'` is required on `script-src` because Next.js App Router emits inline
// `<script>(self.__next_f=...).push(...)</script>` tags for streaming hydration data;
// without it the page renders but is non-interactive (buttons don't respond). Same goes
// for inline `<style>` tags injected by Tailwind / next/font. The proper hardening is
// per-request nonces via middleware, but for a 127.0.0.1-bound Electron app where:
//   - all HTML comes from this server's own bundle,
//   - the renderer is contextIsolated and nodeIntegration=false,
//   - we never render user-supplied content as raw HTML,
// the threat that `'unsafe-inline'` exposes (XSS injecting <script>) is already
// out-of-model. The remaining directives still meaningfully bound the renderer.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Native modules — keep server-only, never bundle into chunks
  serverExternalPackages: ["keytar", "better-sqlite3"],
  // Electron loads the app from 127.0.0.1; allow it as a dev origin
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Disable output file tracing — we ship node_modules wholesale via electron-builder's
  // extraResources, so Next's tracing pass is wasted work and breaks on Windows runners
  // (junction points like C:\Users\<u>\Application Data throw EPERM during scan).
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "*": [
      "**/Application Data/**",
      "**/Local Settings/**",
      "**/AppData/Local/Temp/**",
      "C:\\Users\\*\\Application Data\\**",
      "C:\\Users\\*\\Local Settings\\**",
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
