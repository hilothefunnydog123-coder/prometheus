import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only env vars (FEATHERLESS_*) are intentionally NOT exposed via `env`
  // so they can never leak into the client bundle.
};

export default nextConfig;
