import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for the slim Docker runtime image.
  output: 'standalone',
  // Workspace packages ship TS source — transpile the shared helpers.
  transpilePackages: ['@gideon-defender/utils'],
};

export default nextConfig;
