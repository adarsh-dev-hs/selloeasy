import { Activity } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-surface grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          <span className="font-semibold">SelloEasy</span>
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-xs text-muted-foreground">
          Synthetic demo data · <Link href="/docs" className="underline-offset-2 hover:underline">Documentation</Link>
        </p>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_45%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="text-3xl font-semibold leading-tight">Every market signal,<br />turned into a lead you can act on.</p>
          <p className="mt-4 max-w-md text-white/80">
            SelloEasy watches launches, investments, expansions and tenders — matches them to your ICPs and signals — and hands your team BANT-scored leads with the evidence attached.
          </p>
        </div>
      </div>
    </div>
  );
}
