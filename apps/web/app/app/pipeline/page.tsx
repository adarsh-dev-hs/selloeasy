'use client';
import type { Page, PipelineConfig, PipelineProgressEvent, PipelineRun } from '@selloeasy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Workflow, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { formatCost, isTerminal, ProgressPanel, StageSteps, StatusBadge, useRunProgress } from '@/components/intelligence/pipeline-progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Tip } from '@/components/ui/tooltip';
import { ApiError, errorMessage, get, post } from '@/lib/api';
import { Can } from '@/lib/auth';
import { formatDateTime, formatNumber, timeAgo } from '@/lib/utils';

/** Fallback for `PIPELINE_MAX_LLM_CALLS_PER_RUN` until /pipeline/config loads (plan §11.3). */
const DEFAULT_LLM_BUDGET = 60;

function duration(r: PipelineRun): string {
  if (!r.startedAt) return '—';
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(r.startedAt).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TRIGGER_LABEL: Record<PipelineRun['trigger'], string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  ONBOARDING: 'Onboarding',
  DATA_REFRESH: 'New platform data',
};

function PipelinePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlRun = sp.get('run');
  const [page, setPage] = useState(1);
  const pipelineConfig = useQuery({ queryKey: ['pipeline-config'], queryFn: () => get<PipelineConfig>('/pipeline/config'), staleTime: 5 * 60_000 });
  const LLM_BUDGET = pipelineConfig.data?.maxLlmCallsPerRun ?? DEFAULT_LLM_BUDGET;

  const runs = useQuery({
    queryKey: ['pipeline-runs', page],
    queryFn: () => get<Page<PipelineRun>>('/pipeline/runs', { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((r) => !isTerminal(r.status)) ? 5000 : false),
  });

  const activeRun = runs.data?.items.find((r) => !isTerminal(r.status)) ?? null;
  const watchId = urlRun ?? activeRun?.id ?? null;

  const setRunParam = (id: string | null) => router.replace(id ? `${pathname}?run=${id}` : pathname, { scroll: false });

  const onFinished = (e: PipelineProgressEvent) => {
    const s = e.stats;
    if (e.status === 'FAILED') toast.error(`Pipeline run failed${e.message ? `: ${e.message}` : ''}`);
    else
      toast.success(`Run ${e.status === 'PARTIAL' ? 'finished (partial)' : 'complete'} — ${s.leadsCreated ?? 0} new, ${s.leadsUpdated ?? 0} updated leads`, {
        action: { label: 'View leads', onClick: () => router.push('/app/leads?sort=recent') },
      });
    // Keep the finished run's result on screen after history refreshes.
    if (!urlRun) setRunParam(e.runId);
    void qc.invalidateQueries({ queryKey: ['pipeline-runs'] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['signals'] });
    void qc.invalidateQueries({ queryKey: ['icps'] });
  };
  const { event, connected } = useRunProgress(watchId, onFinished);

  const run = useMutation({
    mutationFn: () => post<PipelineRun>('/pipeline/runs'),
    onSuccess: (r) => {
      toast.success('Pipeline run queued');
      setPage(1);
      setRunParam(r.id);
      void qc.invalidateQueries({ queryKey: ['pipeline-runs'] });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // 409 — a run is already in progress: follow it.
      if (e instanceof ApiError && e.status === 409) {
        const id = (e.details as { runId?: string } | undefined)?.runId;
        if (id) setRunParam(id);
      }
    },
  });

  const busy = !!activeRun || (!!event && !isTerminal(event.status));

  return (
    <>
      <PageHeader
        title="Pipeline runs"
        description="Scan market events against your active signals and ICPs, then create and score leads."
        actions={
          <Can permission="pipeline:run">
            <Tip content={busy ? 'A run is already in progress' : 'Start a run now'}>
              <span>
                <Button onClick={() => run.mutate()} loading={run.isPending} disabled={busy}>
                  <Play /> Run pipeline now
                </Button>
              </span>
            </Tip>
          </Can>
        }
      />

      {event ? (
        <>
          {urlRun && isTerminal(event.status) && (
            <div className="-mt-2 mb-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setRunParam(null)}>
                <X /> Close
              </Button>
            </div>
          )}
          <ProgressPanel event={event} connected={connected} budget={LLM_BUDGET} />
        </>
      ) : watchId ? (
        <Skeleton className="mb-8 h-72" />
      ) : (
        <section className="mb-8 rounded-xl border bg-muted/30 p-5">
          <h2 className="mb-1 font-semibold">How a run works</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Each run walks four stages. The cheap keyword prefilter cuts most events before any AI call; the LLM is capped at{' '}
            <span className="font-medium text-foreground">{LLM_BUDGET} calls per run</span> — if the budget is reached the run ends as <em>Partial</em> and the rest is picked up next time. Runs also happen automatically on a schedule.
          </p>
          <StageSteps stage="idle" status="QUEUED" />
        </section>
      )}

      <h2 className="mb-3 text-lg font-semibold">History</h2>
      {runs.error ? (
        <ErrorState error={runs.error} retry={() => runs.refetch()} />
      ) : !runs.data ? (
        <Skeleton className="h-80" />
      ) : runs.data.total === 0 ? (
        <EmptyState icon={Workflow} title="No runs yet" description="Start the first run to turn market events into scored leads." />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <th>Started</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Duration</th>
                <th className="text-right!">Scanned → matched</th>
                <th className="text-right!">Leads</th>
                <th className="text-right!">LLM calls</th>
                <th className="text-right!">Cost</th>
                <th />
              </tr>
            </THead>
            <TBody>
              {runs.data.items.map((r) => (
                <TR key={r.id} className={r.id === watchId ? 'bg-primary/5' : undefined}>
                  <td className="whitespace-nowrap">
                    <span className="text-sm">{formatDateTime(r.startedAt ?? r.createdAt)}</span>
                    <span className="block text-xs text-muted-foreground">{timeAgo(r.startedAt ?? r.createdAt)}</span>
                  </td>
                  <td>
                    <span className="text-sm">{TRIGGER_LABEL[r.trigger]}</span>
                    {r.triggeredBy && <span className="block text-xs text-muted-foreground">{r.triggeredBy}</span>}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={r.status} />
                      {r.stats.budgetExhausted && <Badge variant="warning">Budget reached</Badge>}
                    </div>
                    {r.error && (
                      <Tip content={r.error}>
                        <p className="mt-1 max-w-56 cursor-help truncate text-xs text-destructive">{r.error}</p>
                      </Tip>
                    )}
                  </td>
                  <td className="tabular-nums text-sm">{duration(r)}</td>
                  <td className="text-right text-sm tabular-nums">
                    {formatNumber(r.stats.eventsScanned ?? 0)} → {formatNumber(r.stats.prefiltered ?? 0)} → <span className="font-medium">{formatNumber(r.stats.matched ?? 0)}</span>
                  </td>
                  <td className="text-right text-sm tabular-nums">
                    <span className="font-medium text-success">+{formatNumber(r.stats.leadsCreated ?? 0)}</span>
                    <span className="text-muted-foreground"> / {formatNumber(r.stats.leadsUpdated ?? 0)} upd</span>
                  </td>
                  <td className="text-right text-sm tabular-nums">
                    {formatNumber(r.stats.llmCalls ?? 0)}
                    {!!r.stats.cacheHits && <span className="block text-xs text-muted-foreground">{formatNumber(r.stats.cacheHits)} cached</span>}
                  </td>
                  <td className="text-right text-sm tabular-nums">{formatCost(r.stats.costUsd)}</td>
                  <td className="text-right">
                    {r.id !== watchId && (
                      <Button variant="ghost" size="sm" onClick={() => setRunParam(r.id)}>
                        Details
                      </Button>
                    )}
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="mt-4">
            <Pagination page={runs.data.page} totalPages={runs.data.totalPages} total={runs.data.total} pageSize={runs.data.pageSize} onChange={setPage} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            New leads land in <Link href="/app/leads?sort=recent" className="text-primary hover:underline">Leads</Link> as soon as each batch is scored.
          </p>
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PipelinePage />
    </Suspense>
  );
}
