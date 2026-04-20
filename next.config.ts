import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Use the WASM SWC fallback when the native binary is unavailable
  experimental: {
    swcTraceProfiling: false,
  },
};

export default nextConfig;
