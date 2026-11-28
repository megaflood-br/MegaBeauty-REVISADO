import type { NextConfig } from "next";

function buildAllowedDevOrigins() {
  const origins = new Set<string>([
    "127.0.0.1",
    "localhost",
    "**.localhost",
    "**.run.app",
    "**.googleusercontent.com",
    "beauty.megaflood.cloud",
    "**.megaflood.cloud",
    "**.megaflood.app",
  ]);
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).hostname);
    } catch {
      // Ignore malformed APP_URL values
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs", "xlsx"],
  allowedDevOrigins: buildAllowedDevOrigins(),
  experimental: {
    cpus: 2,
    webpackMemoryOptimizations: true,
    serverActions: {
      bodySizeLimit: "8mb",
    },
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
