import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Next infers the root by walking up
  // for a lockfile, and a stray package-lock.json in the home directory made it
  // guess ~ instead — which widens filesystem watching and can resolve modules
  // from outside the project.
  turbopack: {
    root: __dirname,
  },

  // Use the WASM SWC fallback when the native binary is unavailable
  experimental: {
    swcTraceProfiling: false,
  },
};

export default nextConfig;
