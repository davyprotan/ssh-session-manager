import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electron loads the app from 127.0.0.1; allow it as a dev origin
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
