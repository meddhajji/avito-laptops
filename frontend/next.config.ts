import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  experimental: {
    staleTimes: {
      dynamic: 3600,
      static: 3600,
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 95],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.avito.ma",
      },
    ],
  },
};

export default nextConfig;
