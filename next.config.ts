import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep metadata in <head> for every crawler and audit tool. The site-wide
  // settings query is cached, so this avoids crawler-specific differences.
  htmlLimitedBots: /.*/,
  experimental: { cpus: 1 },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/site-media/**",
      },
    ],
    formats: ["image/webp"],
    qualities: [58, 62, 64, 75],
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
