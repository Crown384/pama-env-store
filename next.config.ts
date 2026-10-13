import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Limit parallel static-generation workers for small QA/staging builders.
    cpus: 1,
    webpackMemoryOptimizations: true,
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      ],
    }];
  },
};

export default nextConfig;
