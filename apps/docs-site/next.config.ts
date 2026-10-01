import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output → small production image (apps/docs-site/Dockerfile).
  output: 'standalone',
  // Monorepo: trace files from the workspace root; the content lives in ../../docs.
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  async redirects() {
    // Only the Project section is in the sidebar (app/docs/layout.tsx), so land there.
    return [
      { source: '/', destination: '/docs/project', permanent: false },
      { source: '/docs', destination: '/docs/project', permanent: false },
    ];
  },
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
