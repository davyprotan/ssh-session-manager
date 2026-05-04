import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules — keep server-only, never bundle into chunks
  serverExternalPackages: ["keytar", "better-sqlite3"],
  // Electron loads the app from 127.0.0.1; allow it as a dev origin
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
