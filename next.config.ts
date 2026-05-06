import type { NextConfig } from "next";

// Defense-in-depth CSP. The renderer only ever loads this app's own assets and talks to
// its own /api/* endpoints, so 'self' suffices for everything except styles (Tailwind /
// next/font inject inline <style> at runtime).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
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
