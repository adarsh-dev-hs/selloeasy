import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { BookOpenText } from 'lucide-react';
import { source } from '@/lib/source';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <span className="flex items-center gap-2 font-semibold">
            <BookOpenText className="size-4 text-fd-primary" /> SelloEasy Docs
          </span>
        ),
      }}
      links={[
        { text: 'Open the app', url: '/login' },
        { text: 'API reference (OpenAPI)', url: '/api/docs', external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
