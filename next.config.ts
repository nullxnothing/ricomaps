import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow embedding in iframes from any origin for the /embed route
  async headers() {
    return [
      {
        source: '/embed',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
