import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';

/**
 * The standalone docs site renders the whole repo-root `docs/` folder — the same source the web app serves at
 * /docs (plan §20). Pages keep the `/docs/...` base URL so every internal link works in both places.
 */
const docs = defineDocs({
  dir: '../../docs',
  docs: {
    schema: pageSchema,
    mdxOptions: applyMdxPreset({ remarkPlugins: (v) => [...v, remarkMdxMermaid] }),
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});
