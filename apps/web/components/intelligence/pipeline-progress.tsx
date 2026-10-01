'use client';
import type { PipelineProgressEvent, PipelineRunStats, PipelineStatus } from '@selloeasy/shared';
import { Check, CircleAlert, Filter, Layers, Sparkles, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber } from '@/lib/utils';

export const TERMINAL: PipelineStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED'];
export const isTerminal = (s: PipelineStatus) => TERMINAL.includes(s);

/**
 * Subscribe to a run's Server-Sent Events stream. The server sends a snapshot first and closes
 * the stream on COMPLETED / PARTIAL / FAILED — we close too, so EventSource doesn't reconnect.
 */
export function useRunProgress(runId: string | null, onFinished?: (e: PipelineProgressEvent) => void) {
  const [event, setEvent] = useState<PipelineProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  });

  useEffect(() => {
    setEvent(null);
    setConnected(false);
    if (!runId) return;
    const es = new EventSource(`/api/v1/pipeline/runs/${runId}/events`);
    let sawLive = false;
    es.onopen = () => setConnected(true);
    es.onmessage = (m) => {
      let e: PipelineProgressEvent;
      try {
        e = JSON.parse(m.data as string) as PipelineProgressEvent;
      } catch {
        return;
      }
      // Merge stats so partial updates never blank a counter.
      setEvent((prev) => ({ ...e, stats: { ...(prev?.stats ?? {}), ...e.stats } }));
      if (e.stage !== 'snapshot') sawLive = true;
      if (isTerminal(e.status)) {
        es.close();
        setConnected(false);
        // Only notify when we watched it finish (not when opening an already-finished run).
        if (sawLive) finishedRef.current?.(e);
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setConnected(false);
    };
    return () => es.close();
  }, [runId]);

  return { event, connected };
}

const STEPS = [
  { key: 'prefilter', label: 'Prefilter', hint: 'Keywords, industry tags & recency — no LLM', icon: Filter },
  { key: 'match', label: 'LLM match', hint: 'Batches of events × your active signals', icon: Sparkles },
  { key: 'dedupe', label: 'Dedupe & upsert', hint: 'One lead per account, new evidence attached', icon: Layers },
  { key: 'score', label: 'Score', hint: 'BANT+ scoring of touched leads', icon: TrendingUp },
] as const;

/** Map worker stage names onto the 4 user-facing steps: returns [firstActive, lastActive]. */
function activeSteps(stage: string, status: PipelineStatus): [number, number] {
  if (status === 'COMPLETED' || status === 'PARTIAL' || stage === 'done') return [4, 4];
  switch (stage) {
    case 'matching':
      return [1, 2];
    case 'scoring':
      return [3, 3];
    default:
      return [0, 0];
  }
}

export function StageSteps({ stage, status }: { stage: string; status: PipelineStatus }) {
  const [a, b] = activeSteps(stage, status);
  const failed = status === 'FAILED';
  return (
    <ol className="grid gap-2 sm:grid-cols-4">
      {STEPS.map((s, i) => {
        const done = i < a;
        const active = i >= a && i <= b && !failed;
        const Icon = done ? Check : s.icon;
        return (
          <li
            key={s.key}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors',
              active && 'border-primary/40 bg-primary/5',
              done && 'border-success/30 bg-success/5',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
                active && 'bg-primary text-primary-foreground',
                done && 'bg-success/15 text-success',
              )}
            >
              <Icon className={cn('size-3.5', active && 'animate-pulse')} />
            </span>
            <span>
              <span className="block font-medium">
                {i + 1}. {s.label}
              </span>
              <span className="block text-xs text-muted-foreground">{s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StatusBadge({ status }: { status: PipelineStatus }) {
  const map: Record<PipelineStatus, { v: 'secondary' | 'default' | 'success' | 'warning' | 'destructive'; label: string }> = {
    QUEUED: { v: 'secondary', label: 'Queued' },
    RUNNING: { v: 'default', label: 'Running' },
    COMPLETED: { v: 'success', label: 'Completed' },
    PARTIAL: { v: 'warning', label: 'Partial' },
    FAILED: { v: 'destructive', label: 'Failed' },
  };
  const m = map[status];
  return (
    <Badge variant={m.v}>
      {status === 'RUNNING' && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {m.label}
    </Badge>
  );
}

export function formatCost(usd: number | undefined) {
  if (usd === undefined) return '—';
  return usd === 0 ? '$0.00' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function StatsGrid({ stats, budget }: { stats: Partial<PipelineRunStats>; budget: number }) {
  const tiles: [string, React.ReactNode, string?][] = [
    ['Events scanned', formatNumber(stats.eventsScanned ?? 0)],
    ['Passed prefilter', formatNumber(stats.prefiltered ?? 0), stats.eventsScanned ? `${Math.round(((stats.prefiltered ?? 0) / stats.eventsScanned) * 100)}% of scanned` : undefined],
    ['Signal matches', formatNumber(stats.matched ?? 0)],
    ['Leads created', formatNumber(stats.leadsCreated ?? 0)],
    ['Leads updated', formatNumber(stats.leadsUpdated ?? 0)],
    ['LLM calls', `${formatNumber(stats.llmCalls ?? 0)} / ${budget}`, stats.budgetExhausted ? 'Budget reached' : 'per-run budget'],
    ['Cache hits', formatNumber(stats.cacheHits ?? 0)],
    ['LLM cost', formatCost(stats.costUsd)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{value}</dd>
          {hint && <dd className={cn('text-[11px] text-muted-foreground', label === 'LLM calls' && stats.budgetExhausted && 'text-amber-600 dark:text-amber-400')}>{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function ProgressPanel({ event, connected, budget }: { event: PipelineProgressEvent; connected: boolean; budget: number }) {
  const failed = event.status === 'FAILED';
  const finished = isTerminal(event.status);
  const pct = Math.max(0, Math.min(100, event.progress));
  return (
    <section className={cn('mb-8 flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs', !finished && 'border-primary/40', failed && 'border-destructive/40')} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{finished ? 'Run result' : 'Live run'}</h2>
          <StatusBadge status={event.status} />
          {connected && !finished && <span className="text-xs text-muted-foreground">streaming updates…</span>}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{event.runId.slice(0, 8)}</span>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            {failed && <CircleAlert className="size-4 text-destructive" />}
            {event.message ?? (event.status === 'QUEUED' ? 'Waiting for a worker to pick up the run…' : 'Working…')}
          </span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Run progress">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', failed ? 'bg-destructive' : event.status === 'PARTIAL' ? 'bg-warning' : finished ? 'bg-success' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <StageSteps stage={event.stage} status={event.status} />
      <StatsGrid stats={event.stats} budget={budget} />
    </section>
  );
}
