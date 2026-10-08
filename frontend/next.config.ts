import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (set in frontend/Dockerfile)
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  compress: true,
  experimental: {
    staleTimes: {
      dynamic: 3600,
      static: 3600,
    },
  },
};

export default nextConfig;
