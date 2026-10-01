import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output → small production image (apps/web/Dockerfile).
  output: 'standalone',
  // Monorepo: trace files from the workspace root; docs live in ../../docs (plan §20).
  outputFileTracingRoot: root,
  turbopack: { root },
  transpilePackages: ['@selloeasy/shared'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

const withMDX = createMDX();
export default withMDX(config);
