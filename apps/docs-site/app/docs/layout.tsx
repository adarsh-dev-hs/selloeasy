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
