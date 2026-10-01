import type { Folder, Root } from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { BookOpenText } from 'lucide-react';
import { source } from '@/lib/source';

/**
 * Sidebar sections shown on the standalone docs site (folder names under docs/). Hidden sections are only
 * commented out: their pages still build, so links from Project pages (to ADRs, concepts…) keep working.
 * The web app's /docs is not affected — it shows every section.
 */
const VISIBLE_SECTIONS = [
  // '(guide)',
  // '(architecture)',
  // 'operations',
  // 'decisions',
  '(project)',
];

/** Individual pages hidden from the sidebar (still built and reachable by link). Delete a line to show it again. */
const HIDDEN_PAGES = ['/docs/changelog'];

function withoutHiddenPages(nodes: Root['children']): Root['children'] {
  return nodes
    .filter((n) => !(n.type === 'page' && HIDDEN_PAGES.includes(n.url)))
    .map((n) => (n.type === 'folder' ? { ...n, children: withoutHiddenPages(n.children) } : n));
}

function sectionOf(node: Root['children'][number]): string | undefined {
  return node.type === 'folder' && node.root ? node.$ref?.folder.split('/').pop() : undefined;
}

function visibleTree(tree: Root): Root {
  const sections = tree.children.filter((n): n is Folder => VISIBLE_SECTIONS.includes(sectionOf(n) ?? ''));
  // One section left → show its pages directly instead of a one-item section dropdown.
  if (sections.length === 1) return { ...tree, children: withoutHiddenPages(sections[0]!.children) };
  return { ...tree, children: withoutHiddenPages(sections) };
}

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={visibleTree(source.getPageTree())}
      nav={{
        url: '/docs/project',
        title: (
          <span className="flex items-center gap-2 font-semibold">
            <BookOpenText className="size-4 text-fd-primary" /> SelloEasy Docs
          </span>
        ),
      }}
      // The app lives on another origin; /go/* resolves WEB_URL at request time (see app/go/[target]/route.ts).
      links={[
        { text: 'Open the app', url: '/go/app', external: true },
        { text: 'API reference (OpenAPI)', url: '/go/api-docs', external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
