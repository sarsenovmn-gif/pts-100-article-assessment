import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the Cursor preview proxy (served from 127.0.0.1 / localhost on a
  // different port, and via cursor preview domains) to load dev resources
  // like HMR and client JS chunks. Without this, Next.js blocks cross-origin
  // dev requests and the page renders but never hydrates.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.cursor.sh",
    "*.cursor.com",
  ],
};

export default nextConfig;
