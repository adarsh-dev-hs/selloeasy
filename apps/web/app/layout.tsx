import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './global.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'SelloEasy — Marketing Intelligence', template: '%s · SelloEasy' },
  description: 'Turn market signals into scored, ready-to-contact leads.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col antialiased">
        {/* RootProvider brings next-themes (shared by /docs and the app) and the docs search dialog. */}
        <RootProvider search={{ options: { api: '/docs-search' } }} theme={{ hotKey: false }}>
          <Providers>{children}</Providers>
        </RootProvider>
      </body>
    </html>
  );
}
