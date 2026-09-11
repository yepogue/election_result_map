import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a compact self-hosting Node bundle for Docker/Koyeb.
  output: "standalone",
};

export default nextConfig;
