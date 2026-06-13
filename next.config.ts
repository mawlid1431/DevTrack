import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const lanHost = process.env.DEV_LAN_HOST;

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Allow phone/other devices on your Wi‑Fi to hit the dev server (set DEV_LAN_HOST in .env.local)
  ...(lanHost ? { allowedDevOrigins: [lanHost] } : {}),
  // Pin Turbopack root to this app — avoids picking up stray lockfiles outside the project
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
