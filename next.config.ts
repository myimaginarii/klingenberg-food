import type { NextConfig } from 'next'

import { getServerActionAllowedOrigins } from './lib/config/site'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The framework version is not a secret, but it is also not useful to advertise.
  poweredByHeader: false,
  // Fail the production build on a type error rather than shipping it.
  // (Next 16 no longer runs ESLint during `next build`; CI runs `npm run lint`.)
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: {
      // Derived from lib/config/site.ts — never a hard-coded domain (technical plan §8, §10d).
      allowedOrigins: getServerActionAllowedOrigins(),
    },
  },
}

export default nextConfig
