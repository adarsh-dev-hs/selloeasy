import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';

/**
 * Documentation source (plan §20). Content lives in the repo-root `docs/` folder so it is readable on
 * GitHub and rendered here at /docs. ```mermaid code blocks become diagrams.
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
