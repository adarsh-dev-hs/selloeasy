'use client';
import type { OnboardingState, OrgDetail } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Coffee,
  FileText,
  Globe,
  Package,
  PartyPopper,
  Radar,
  Rocket,
  ScrollText,
  Sparkles,
  StickyNote,
  Target,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PlansManager, PoliciesManager, ProductsManager } from '@/components/knowledge/catalog';
import { IcpStep } from '@/components/knowledge/icp-step';
import { OrgBasicsForm } from '@/components/knowledge/org-basics';
import { ProfilePanel } from '@/components/knowledge/profile';
import { Callout, ConfirmDialog, KQ, VisibilityNote } from '@/components/knowledge/shared';
import { SignalStep } from '@/components/knowledge/signal-step';
import {
  DocumentUploader,
  SourcesTable,
  TextSourceDialog,
  WebsiteSourceForm,
  useSources,
} from '@/components/knowledge/sources';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, post } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';

type StepKey = keyof OnboardingState | 'review';
type StepDef = {
  key: StepKey;
  title: string;
  short: string;
  description: string;
  icon: typeof Building2;
  required?: boolean;
  optional?: boolean;
};

const STEPS: StepDef[] = [
  {
    key: 'basics',
    title: 'Company basics',
    short: 'Basics',
    description: 'Tell us who you are, where you operate and how big you are.',
    icon: Building2,
  },
  {
    key: 'website',
    title: 'Website',
    short: 'Website',
    description: 'We crawl your public site to learn what you sell.',
    icon: Globe,
  },
  {
    key: 'documents',
    title: 'Documents',
    short: 'Documents',
    description: 'Brochures, case studies, price lists, playbooks — anything that describes your offer.',
    icon: FileText,
  },
  {
    key: 'products',
    title: 'Products & plans',
    short: 'Products & plans',
    description: 'Structured facts about what you sell — used to match signals and ground outreach.',
    icon: Package,
  },
  {
    key: 'policies',
    title: 'Policies',
    short: 'Policies',
    description: 'Warranty, compliance, SLAs and certifications, so outreach never over-promises.',
    icon: ScrollText,
    optional: true,
  },
  {
    key: 'profile',
    title: 'AI knowledge profile',
    short: 'AI profile',
    description: 'The AI reads everything you added and drafts your positioning. Review and edit it.',
    icon: Sparkles,
    required: true,
  },
  {
    key: 'icps',
    title: 'Ideal customer profiles',
    short: 'ICPs',
    description: 'Who you want to sell to. Accept AI suggestions or define your own.',
    icon: Target,
  },
  {
    key: 'signals',
    title: 'Buying signals',
    short: 'Signals',
    description: 'Market events that indicate buying intent. Turn on the ones that matter to you.',
    icon: Radar,
    required: true,
  },
  {
    key: 'review',
    title: 'Review & activate',
    short: 'Activate',
    description: 'Check everything and start your first intelligence run.',
    icon: Rocket,
  },
];

function useStep(org: OrgDetail | undefined): [StepKey, (k: StepKey) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get('step');
  const fromUrl = STEPS.find((s) => s.key === raw)?.key;
  const firstIncomplete = org
    ? (STEPS.find((s) => s.key !== 'review' && !org.onboarding[s.key as keyof OnboardingState])?.key ??
      'review')
    : 'basics';
  const step = fromUrl ?? firstIncomplete;
  // Pin the resumed step in the URL so completing it doesn't auto-jump the view.
  const orgLoaded = !!org;
  useEffect(() => {
    if (orgLoaded && !fromUrl) router.replace(`${pathname}?step=${firstIncomplete}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgLoaded]);
  const set = (k: StepKey) => {
    router.replace(`${pathname}?step=${k}`, { scroll: false });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return [step, set];
}

function isDone(org: OrgDetail, k: StepKey) {
  return k === 'review' ? org.status === 'ACTIVE' : org.onboarding[k];
}

// ────────────────────────────────────────────────────────────────────────────
// Step navigation
// ────────────────────────────────────────────────────────────────────────────

function StepList({
  org,
  step,
  onSelect,
}: {
  org: OrgDetail;
  step: StepKey;
  onSelect: (k: StepKey) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const list = listRef.current;
    // Keep the active step visible in the horizontal (mobile) step strip without scrolling the page.
    if (el && list && list.scrollWidth > list.clientWidth) list.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' });
  }, [step]);
  return (
    <nav aria-label="Onboarding steps">
      <ol ref={listRef} className="relative flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {STEPS.map((s, i) => {
          const done = isDone(org, s.key);
          const current = s.key === step;
          return (
            <li key={s.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  current
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    done
                      ? 'border-success bg-success text-white'
                      : current
                        ? 'border-primary text-primary'
                        : 'border-border',
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="whitespace-nowrap lg:whitespace-normal">{s.short}</span>
                <span className="sr-only">{done ? '(complete)' : '(not complete)'}</span>
                {s.required && !done && (
                  <Badge variant="warning" className="ml-auto hidden px-1.5 text-[10px] lg:inline-flex">
                    Required
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Progress({ org }: { org: OrgDetail }) {
  const keys = Object.keys(org.onboarding) as (keyof OnboardingState)[];
  const done = keys.filter((k) => org.onboarding[k]).length;
  const pct = Math.round((done / keys.length) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {done} of {keys.length} steps complete
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepFooter({
  step,
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled,
}: {
  step: StepKey;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-4">
      {onBack && step !== 'basics' ? (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel} <ArrowRight />
        </Button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Steps
// ────────────────────────────────────────────────────────────────────────────

function WebsiteStep({ org }: { org: OrgDetail }) {
  const host = (() => {
    try {
      return org.websiteUrl ? new URL(org.websiteUrl).hostname : '';
    } catch {
      return '';
    }
  })();
  return (
    <div className="space-y-5">
      <WebsiteSourceForm defaultUrl={org.websiteUrl} />
      <div className="grid gap-3 md:grid-cols-2">
        <Callout title="How the crawl works">
          <p>
            We fetch up to 25 pages, two levels deep, on the same domain — respecting robots.txt — strip menus
            and footers, and index the readable text. It usually takes under a minute.
          </p>
        </Callout>
        <Callout icon={TriangleAlert} tone="warning" title="Demo domains aren’t reachable">
          <p>
            Addresses ending in <code className="rounded bg-muted px-1 text-xs">.example</code>
            {host.endsWith('.example') && (
              <>
                {' '}
                (like <code className="rounded bg-muted px-1 text-xs">{host}</code>)
              </>
            )}{' '}
            are placeholders and can’t be crawled. Skip this step or paste your website copy as text in the
            next step.
          </p>
        </Callout>
      </div>
      <SourcesTable
        canWrite
        filter={(s) => s.type === 'WEBSITE'}
        emptyTitle="No website added yet"
        emptyDescription="Enter your website above to start the crawl."
      />
    </div>
  );
}

function DocumentsStep() {
  const [paste, setPaste] = useState(false);
  return (
    <div className="space-y-5">
      <VisibilityNote />
      <DocumentUploader />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Your documents</h3>
        <Button variant="outline" size="sm" onClick={() => setPaste(true)}>
          <StickyNote /> Paste text instead
        </Button>
      </div>
      <SourcesTable
        canWrite
        filter={(s) => s.type !== 'WEBSITE'}
        emptyTitle="No documents yet"
        emptyDescription="Upload a brochure or case study, or paste text. At least one ready document completes this step."
      />
      <TextSourceDialog open={paste} onOpenChange={setPaste} />
    </div>
  );
}

function ProfileStep() {
  const sources = useSources();
  const ready = sources.data?.filter((s) => s.status === 'READY').length;
  const busy = sources.data?.filter((s) => s.status === 'PENDING' || s.status === 'PROCESSING').length ?? 0;
  return (
    <div className="space-y-4">
      {busy > 0 && (
        <Callout title={`${busy} source${busy > 1 ? 's are' : ' is'} still processing`}>
          <p>
            You can generate now, but the profile will only use sources that are Ready. Regenerate later to
            include the rest.
          </p>
        </Callout>
      )}
      <ProfilePanel canWrite readySources={ready} />
    </div>
  );
}

function ReviewStep({ org, goTo }: { org: OrgDetail; goTo: (k: StepKey) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const ready = org.onboarding.profile && org.onboarding.signals;
  const activate = useMutation({
    mutationFn: () => post<OrgDetail & { pipelineRunId: string }>('/org/activate'),
    onSuccess: (r) => {
      toast.success('You’re live! Your first intelligence run has started.');
      qc.setQueryData(KQ.org, r);
      void qc.invalidateQueries({ queryKey: KQ.me });
      router.push(`/app/pipeline?run=${r.pipelineRunId}`);
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(errorMessage(e));
    },
  });

  return (
    <div className="space-y-5">
      <ul className="divide-y rounded-xl border">
        {STEPS.filter((s) => s.key !== 'review').map((s) => {
          const done = isDone(org, s.key);
          return (
            <li key={s.key} className="flex items-center gap-3 px-4 py-3">
              {done ? (
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Complete" />
              ) : s.required ? (
                <TriangleAlert
                  className="size-5 shrink-0 text-amber-600 dark:text-amber-300"
                  aria-label="Required"
                />
              ) : (
                <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Not complete" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">
                  {done
                    ? 'Done'
                    : s.required
                      ? 'Required before activation'
                      : 'Recommended — improves lead quality'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(s.key)}>
                {done ? 'Review' : 'Complete'}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className={cn('rounded-xl border p-5', ready ? 'border-primary/30 bg-primary/5' : 'bg-muted/30')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{ready ? 'Ready to activate' : 'Almost there'}</p>
            <p className="text-sm text-muted-foreground">
              {ready
                ? 'Activation scans the latest market events against your signals and builds your first scored lead list.'
                : 'Generate your AI profile and activate at least one signal to continue.'}
            </p>
          </div>
          <Button size="lg" disabled={!ready} onClick={() => setConfirm(true)} className="shrink-0">
            <Rocket /> Activate organization
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Activate your organization?"
        description="Your team gets access to leads and dashboards, and the first intelligence run starts right away. You can keep editing your knowledge, ICPs and signals afterwards."
        confirmLabel="Activate & start run"
        destructive={false}
        loading={activate.isPending}
        onConfirm={() => activate.mutate()}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// States for non-admins / already-active orgs
// ────────────────────────────────────────────────────────────────────────────

function AdminSettingUp({ orgName }: { orgName?: string }) {
  return (
    <>
      <PageHeader title="Getting set up" />
      <EmptyState
        icon={Coffee}
        title="Your admin is setting things up"
        description={`${orgName ?? 'Your organization'} is still being onboarded. Once your Org Admin finishes adding company knowledge and signals, your leads and dashboards will appear here.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/docs">Read the docs meanwhile</Link>
          </Button>
        }
      />
    </>
  );
}

function AllSet() {
  const links: [string, string, typeof Target][] = [
    ['/app/dashboard', 'Dashboard', Building2],
    ['/app/leads', 'Leads', Target],
    ['/app/knowledge', 'Knowledge profile', Sparkles],
    ['/app/signals', 'Signals', Radar],
    ['/app/icps', 'ICPs', ClipboardCheck],
    ['/app/pipeline', 'Pipeline runs', Rocket],
  ];
  return (
    <>
      <PageHeader title="Onboarding" />
      <Card className="mx-auto max-w-2xl text-center">
        <CardHeader className="items-center pt-8">
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <PartyPopper className="size-6" />
          </span>
          <CardTitle className="text-xl">You’re all set</CardTitle>
          <CardDescription>
            Your organization is active. Keep your knowledge, ICPs and signals fresh to improve lead quality.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 pb-8 sm:grid-cols-3">
          {links.map(([href, label, Icon]) => (
            <Button key={href} variant="outline" asChild className="justify-start">
              <Link href={href}>
                <Icon /> {label}
              </Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

function OnboardingWizard() {
  const me = useMe();
  const can = useCan();
  const canWrite = can('org:profile:write');
  const org = useQuery({ queryKey: KQ.org, queryFn: () => get<OrgDetail>('/org'), enabled: canWrite });
  const [step, setStep] = useStep(org.data);

  if (!canWrite) return me.org?.status === 'ACTIVE' ? <AllSet /> : <AdminSettingUp orgName={me.org?.name} />;
  if (org.error)
    return (
      <>
        <PageHeader title="Set up your organization" />
        <ErrorState error={org.error} retry={() => org.refetch()} />
      </>
    );
  if (!org.data)
    return (
      <>
        <PageHeader title="Set up your organization" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <Skeleton className="h-80" />
          <Skeleton className="h-96" />
        </div>
      </>
    );
  const o = org.data;
  if (o.status === 'ACTIVE') return <AllSet />;

  const idx = STEPS.findIndex((s) => s.key === step);
  const def = STEPS[idx]!;
  const back = idx > 0 ? () => setStep(STEPS[idx - 1]!.key) : undefined;
  const next = idx < STEPS.length - 1 ? () => setStep(STEPS[idx + 1]!.key) : undefined;
  const nextLabel =
    def.key === 'review'
      ? undefined
      : isDone(o, def.key)
        ? 'Continue'
        : def.required
          ? 'Continue'
          : 'Skip for now';
  const Icon = def.icon;

  return (
    <>
      <PageHeader
        title="Set up your organization"
        description={`Teach SelloEasy about ${o.name}. Every step saves as you go — come back any time.`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Progress org={o} />
          <StepList org={o} step={step} onSelect={setStep} />
        </aside>
        <Card className="min-w-0">
          <CardHeader className="flex-row items-start gap-3 border-b pb-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">
                Step {idx + 1} of {STEPS.length}
                {def.required && ' · Required'}
                {def.optional && ' · Optional'}
              </p>
              <CardTitle className="mt-0.5 text-lg">{def.title}</CardTitle>
              <CardDescription className="mt-1">{def.description}</CardDescription>
            </div>
            {def.key !== 'review' && isDone(o, def.key) && (
              <Badge variant="success" className="shrink-0">
                <Check className="size-3" /> Done
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            {step === 'basics' && (
              <OrgBasicsForm
                key={o.id}
                org={o}
                canWrite
                submitLabel="Save & continue"
                onSaved={() => next?.()}
              />
            )}
            {step === 'website' && <WebsiteStep org={o} />}
            {step === 'documents' && <DocumentsStep />}
            {step === 'products' && (
              <>
                <VisibilityNote compact />
                <ProductsManager canWrite compact />
                <PlansManager canWrite compact />
              </>
            )}
            {step === 'policies' && (
              <>
                <VisibilityNote compact />
                <PoliciesManager canWrite compact />
              </>
            )}
            {step === 'profile' && <ProfileStep />}
            {step === 'icps' && <IcpStep canWrite={can('icps:write')} hasProfile={o.onboarding.profile} />}
            {step === 'signals' && <SignalStep canWrite={can('signals:write')} />}
            {step === 'review' && <ReviewStep org={o} goTo={setStep} />}
            {step !== 'basics' && (
              <StepFooter step={step} onBack={back} onNext={next} nextLabel={nextLabel} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <OnboardingWizard />
    </Suspense>
  );
}
