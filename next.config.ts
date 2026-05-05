import type { NextConfig } from "next";

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
};

export default nextConfig;
