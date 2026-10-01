import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './global.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'SelloEasy Docs', template: '%s' },
  description: 'Product, architecture, operations and project documentation for SelloEasy.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider search={{ options: { api: '/docs-search' } }}>{children}</RootProvider>
      </body>
    </html>
  );
}
