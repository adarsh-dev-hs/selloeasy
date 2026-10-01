import { Activity, ArrowRight, BarChart3, BookOpenText, Radar, ScrollText, ShieldCheck, Sparkles, Target, Workflow } from 'lucide-react';
import Link from 'next/link';

const FEATURES = [
  { icon: Sparkles, title: 'AI knowledge profile', body: 'Upload your website, brochures, policies and pricing. SelloEasy distils them into a profile, ICPs and buyer personas.' },
  { icon: Radar, title: 'Predefined + custom signals', body: 'Industry signal templates (launches, plant expansions, funding, tenders…) plus your own natural-language signals.' },
  { icon: Workflow, title: 'Intelligence pipeline', body: 'Market events are prefiltered, matched to your signals by an LLM, deduplicated per account and turned into leads.' },
  { icon: Target, title: 'BANT+ scoring', body: 'Every lead is scored on Budget, Authority, Need, Timeline, ICP fit and signal strength — with the reasoning shown.' },
  { icon: BarChart3, title: 'CRM & dashboards', body: 'Stages, owners, tasks and an activity timeline. Email, WhatsApp, call scripts and Calendly — funnel and conversion analytics.' },
  { icon: ScrollText, title: 'Audit trail & RBAC', body: 'Five roles, tenant isolation, and an append-only audit log of who did what, when and from where.' },
];

export default function Home() {
  return (
    <div className="app-surface min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          <span className="font-semibold">SelloEasy</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/docs" className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground">Docs</Link>
          <Link href="/login" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90">Sign in</Link>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 text-center sm:pt-20">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" /> Multi-tenant · RBAC · Audit trail · OpenRouter-powered
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn market signals into <span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">scored, ready-to-contact leads</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          When an automaker announces a new SUV, a hospital chain raises funding or a D2C brand opens a fulfilment centre — the right sellers should know first. SelloEasy makes sure they do.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
            Open the demo <ArrowRight className="size-4" />
          </Link>
          <Link href="/docs" className="inline-flex items-center gap-2 rounded-md border bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent">
            <BookOpenText className="size-4" /> Read the docs
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border bg-card p-5 shadow-xs">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <f.icon className="size-4" />
            </span>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">All organizations, companies, people and news in this demo are fictional.</footer>
    </div>
  );
}
