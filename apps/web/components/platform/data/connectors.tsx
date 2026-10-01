'use client';
import {
  connectorSchema,
  FEED_FORMATS,
  type ConnectorDto,
  type ConnectorType,
  type DataPage,
  type DataRowStatus,
  type IngestionProgressEvent,
  type IngestionRunDto,
} from '@selloeasy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Download,
  FlaskConical,
  Pencil,
  Play,
  Plug,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, RunStatusBadge } from '@/components/platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Switch } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { ApiError, del, errorMessage, get, patch, post } from '@/lib/api';
import { Can, useCan } from '@/lib/auth';
import { cn, formatDateTime, formatNumber, timeAgo } from '@/lib/utils';
import { DataPager, hostOf, RowStatusBadge, SectionTitle, useDataParams } from './shared';

const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  DEMO_FEED: 'Demo feed',
  HTTP_FEED: 'HTTP feed',
};
const RUNS_KEY = ['platform', 'data', 'ingestion-runs'];
const CONNECTORS_KEY = ['platform', 'data', 'connectors'];

type TestResult = {
  fetched: number;
  hasMore: boolean;
  rows: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  samples: {
    rowNumber: number;
    status: DataRowStatus;
    title: string;
    issues: { field: string; code: string; message: string; severity: 'error' | 'warning' }[];
  }[];
};

// ── Live progress (SSE) ──────────────────────────────────────────────────────

const TERMINAL = ['COMPLETED', 'PARTIAL', 'FAILED'];

/** Subscribes to an ingestion run's SSE stream; mirrors the org pipeline progress hook. */
function useIngestionProgress(runId: string | null, onFinished?: (e: IngestionProgressEvent) => void) {
  const [event, setEvent] = useState<IngestionProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  });
  useEffect(() => {
    setEvent(null);
    setConnected(false);
    if (!runId) return;
    const es = new EventSource(`/api/v1/platform/data/ingestion-runs/${runId}/events`);
    let sawLive = false;
    es.onopen = () => setConnected(true);
    es.onmessage = (m) => {
      let e: IngestionProgressEvent;
      try {
        e = JSON.parse(m.data as string) as IngestionProgressEvent;
      } catch {
        return;
      }
      setEvent((prev) => ({ ...e, stats: { ...(prev?.stats ?? {}), ...e.stats } }));
      if (e.stage !== 'snapshot') sawLive = true;
      if (TERMINAL.includes(e.status)) {
        es.close();
        setConnected(false);
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

const STAGES = [
  { key: 'fetching', label: 'Fetch', hint: 'Pull new rows from the feed', icon: Download },
  { key: 'validating', label: 'Validate', hint: 'Schema, quality & duplicate checks', icon: ShieldCheck },
  { key: 'inserting', label: 'Insert', hint: 'Upsert events and directory rows', icon: Upload },
  { key: 'fanout', label: 'Fan-out', hint: 'Notify matching organizations', icon: Radio },
] as const;

function RunProgress({ runId, onClose }: { runId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ['platform', 'data', 'ingestion-run', runId],
    queryFn: () => get<IngestionRunDto>(`/platform/data/ingestion-runs/${runId}`),
  });
  const { event, connected } = useIngestionProgress(runId, (e) => {
    if (e.status === 'FAILED') toast.error(`Ingestion failed${e.message ? `: ${e.message}` : ''}`);
    else
      toast.success(
        `Ingestion ${e.status === 'PARTIAL' ? 'finished with warnings' : 'completed'} — ${formatNumber(e.stats.inserted)} events inserted`,
      );
    void qc.invalidateQueries({ queryKey: ['platform', 'data'] });
  });
  const status = event?.status ?? (run.data?.status === 'QUEUED' ? 'RUNNING' : run.data?.status);
  const stats = event?.stats ?? run.data?.stats;
  const done = !!status && TERMINAL.includes(status);
  const stageIdx = done
    ? STAGES.length
    : Math.max(
        0,
        STAGES.findIndex((s) => s.key === event?.stage),
      );
  const progress = done ? 100 : (event?.progress ?? 0);

  return (
    <Card aria-labelledby="run-title">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle id="run-title" className="flex flex-wrap items-center gap-2">
            Ingestion run {run.data ? `· ${run.data.connector.name}` : ''}
            {status && <RunStatusBadge status={status as IngestionRunDto['status']} />}
            {connected && (
              <Badge variant="outline" className="gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden /> Live
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {run.data?.startedAt ? `Started ${formatDateTime(run.data.startedAt)}` : 'Queued'}
            {run.data?.batchId && (
              <>
                {' · '}
                <Link
                  href={`/platform/data?tab=imports&batch=${run.data.batchId}`}
                  className="text-primary hover:underline"
                >
                  View batch
                </Link>
              </>
            )}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X /> Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Ingestion progress"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              status === 'FAILED' ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <ol className="grid gap-2 sm:grid-cols-4" aria-live="polite">
          {STAGES.map((s, i) => {
            const state =
              status === 'FAILED' && i === stageIdx
                ? 'failed'
                : i < stageIdx
                  ? 'done'
                  : i === stageIdx && !done
                    ? 'active'
                    : 'idle';
            const Icon = state === 'done' ? Check : state === 'failed' ? CircleAlert : s.icon;
            return (
              <li
                key={s.key}
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3',
                  state === 'active' && 'border-primary bg-primary/5',
                  state === 'done' && 'border-success/40',
                  state === 'failed' && 'border-destructive/40 bg-destructive/5',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full',
                    state === 'done'
                      ? 'bg-success/15 text-success'
                      : state === 'active'
                        ? 'bg-primary/15 text-primary'
                        : state === 'failed'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className={cn('size-4', state === 'active' && 'animate-pulse')} aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium">
                    {s.label}
                    <span className="sr-only"> — {state}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {event?.message && <p className="text-sm text-muted-foreground">{event.message}</p>}
        {run.data?.error && (
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <XCircle className="size-4" aria-hidden /> {run.data.error}
          </p>
        )}
        {stats && (
          <dl className="grid grid-cols-3 gap-3 sm:grid-cols-7">
            {(
              [
                ['Fetched', stats.fetched],
                ['Valid', stats.valid],
                ['Warnings', stats.warnings],
                ['Invalid', stats.invalid],
                ['Duplicates', stats.duplicates],
                ['Inserted', stats.inserted],
                ['Orgs notified', stats.orgsNotified],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-muted/30 p-2.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-semibold tabular-nums">{formatNumber(v ?? 0)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// ── Connectors tab ───────────────────────────────────────────────────────────

export function ConnectorsTab() {
  const p = useDataParams();
  const qc = useQueryClient();
  const can = useCan();
  const canManage = can('platform:data:manage');
  const runId = p.get('run');
  const q = useQuery({
    queryKey: CONNECTORS_KEY,
    queryFn: () => get<ConnectorDto[]>('/platform/data/connectors'),
    refetchInterval: (query) => (query.state.data?.some((c) => c.runningRunId) ? 5000 : false),
  });
  const [editing, setEditing] = useState<ConnectorDto | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'disable'; c: ConnectorDto } | null>(null);
  const [testing, setTesting] = useState<{ c: ConnectorDto; result?: TestResult; error?: string } | null>(
    null,
  );

  const setEnabled = useMutation({
    mutationFn: ({ c, enabled }: { c: ConnectorDto; enabled: boolean }) =>
      patch<ConnectorDto>(`/platform/data/connectors/${c.id}`, { enabled }),
    onSuccess: (c) => {
      toast.success(`${c.name} ${c.enabled ? 'enabled' : 'disabled'}`);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: CONNECTORS_KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (c: ConnectorDto) => del(`/platform/data/connectors/${c.id}`),
    onSuccess: () => {
      toast.success('Connector deleted');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: CONNECTORS_KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const runNow = useMutation({
    mutationFn: (c: ConnectorDto) => post<IngestionRunDto>(`/platform/data/connectors/${c.id}/run`),
    onSuccess: (r) => {
      toast.success(`Ingestion started for ${r.connector.name}`);
      p.set({ run: r.id });
      void qc.invalidateQueries({ queryKey: CONNECTORS_KEY });
      void qc.invalidateQueries({ queryKey: RUNS_KEY });
    },
    onError: (e) => {
      const running =
        e instanceof ApiError ? (e.details as { runId?: string } | undefined)?.runId : undefined;
      if (running) {
        toast.info('A run is already in progress — showing it');
        p.set({ run: running });
      } else toast.error(errorMessage(e));
    },
  });
  const test = useMutation({
    mutationFn: (c: ConnectorDto) => post<TestResult>(`/platform/data/connectors/${c.id}/test`),
    onMutate: (c) => setTesting({ c }),
    onSuccess: (result, c) => setTesting({ c, result }),
    onError: (e, c) => setTesting({ c, error: errorMessage(e) }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Connectors pull records from feeds on a schedule or on demand. Every row goes through the same
          validation as file imports; test a connector to preview 5 rows without inserting anything.
        </p>
        <Can permission="platform:data:manage">
          <Button onClick={() => setEditing('new')}>
            <Plus /> New connector
          </Button>
        </Can>
      </div>

      {runId && <RunProgress runId={runId} onClose={() => p.set({ run: null })} />}

      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No connectors yet"
          description="Add the demo feed to try ingestion end-to-end, or an HTTPS feed that serves CSV / JSONL / JSON in template v1."
          action={
            canManage && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> New connector
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <th>Connector</th>
              <th>Type</th>
              <th>URL host</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>Enabled</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </THead>
          <TBody>
            {q.data.map((c) => (
              <TR key={c.id}>
                <td>
                  <p className="font-medium">{c.name}</p>
                  {!c.fanOut && <Badge variant="outline">No fan-out</Badge>}
                </td>
                <td className="whitespace-nowrap">{CONNECTOR_TYPE_LABELS[c.type]}</td>
                <td className="text-muted-foreground">{hostOf(c.config.url) ?? '—'}</td>
                <td>
                  {c.schedule ? (
                    <code className="text-xs">{c.schedule}</code>
                  ) : (
                    <span className="text-muted-foreground">Manual</span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  {c.runningRunId ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => p.set({ run: c.runningRunId })}
                    >
                      <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> Running
                      — watch
                    </Button>
                  ) : c.lastRunAt ? (
                    <span className="flex items-center gap-2">
                      {c.lastStatus &&
                      ['COMPLETED', 'PARTIAL', 'FAILED', 'RUNNING', 'QUEUED'].includes(c.lastStatus) ? (
                        <RunStatusBadge status={c.lastStatus as IngestionRunDto['status']} />
                      ) : (
                        c.lastStatus && <Badge variant="secondary">{c.lastStatus}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground" title={formatDateTime(c.lastRunAt)}>
                        {timeAgo(c.lastRunAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never run</span>
                  )}
                </td>
                <td>
                  <Switch
                    checked={c.enabled}
                    disabled={!canManage || setEnabled.isPending}
                    label={`${c.enabled ? 'Disable' : 'Enable'} ${c.name}`}
                    onCheckedChange={(v) =>
                      v ? setEnabled.mutate({ c, enabled: true }) : setConfirm({ kind: 'disable', c })
                    }
                  />
                </td>
                <td className="whitespace-nowrap text-right">
                  <Can permission="platform:data:manage">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        onClick={() => runNow.mutate(c)}
                        disabled={!c.enabled || !!c.runningRunId}
                        loading={runNow.isPending && runNow.variables?.id === c.id}
                        title={!c.enabled ? 'Enable the connector to run it' : undefined}
                      >
                        <Play /> Run now
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => test.mutate(c)}
                        loading={test.isPending && test.variables?.id === c.id}
                      >
                        <FlaskConical /> Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${c.name}`}
                        className="text-destructive"
                        onClick={() => setConfirm({ kind: 'delete', c })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </Can>
                </td>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <RunHistory onOpen={(id) => p.set({ run: id })} />

      {editing && (
        <ConnectorDialog connector={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      <TestDialog state={testing} pending={test.isPending} onClose={() => setTesting(null)} />
      <ConfirmDialog
        open={confirm?.kind === 'disable'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Disable ${confirm?.c.name ?? 'connector'}?`}
        description="Scheduled runs stop and it can't be run manually until you enable it again. Data it already ingested stays."
        confirmLabel="Disable"
        loading={setEnabled.isPending}
        onConfirm={() => confirm && setEnabled.mutate({ c: confirm.c, enabled: false })}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.c.name ?? 'connector'}?`}
        description="The connector and its schedule are removed. Batches and events it ingested stay in the data source (roll back a batch to retract them)."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.c)}
      />
    </div>
  );
}

function TestDialog({
  state,
  pending,
  onClose,
}: {
  state: { c: ConnectorDto; result?: TestResult; error?: string } | null;
  pending: boolean;
  onClose: () => void;
}) {
  const r = state?.result;
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Test {state?.c.name}</DialogTitle>
          <DialogDescription>
            Fetches up to 5 rows and validates them — nothing is inserted.
          </DialogDescription>
        </DialogHeader>
        {pending && !r && !state?.error ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <Skeleton className="h-16" />
            <Skeleton className="h-32" />
            <span className="sr-only">Testing connection…</span>
          </div>
        ) : state?.error ? (
          <p
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.error}
          </p>
        ) : r ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-success" aria-hidden /> Connected — fetched{' '}
              {formatNumber(r.fetched)} rows{r.hasMore ? ' (more available)' : ''}.
            </p>
            <dl className="grid grid-cols-4 gap-3">
              {(
                [
                  ['Valid', r.valid],
                  ['Warnings', r.warnings],
                  ['Invalid', r.invalid],
                  ['Duplicates', r.duplicates],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-muted/30 p-2.5">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(v)}</dd>
                </div>
              ))}
            </dl>
            {r.samples.length === 0 ? (
              <EmptyState className="p-6" title="The feed returned no new rows" />
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {r.samples.map((s) => (
                  <li key={s.rowNumber} className="space-y-1 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{s.title || `Row ${s.rowNumber}`}</p>
                      <RowStatusBadge status={s.status} />
                    </div>
                    {s.issues.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {s.issues.map((i, n) => (
                          <li key={n} className="flex items-start gap-1.5">
                            {i.severity === 'error' ? (
                              <XCircle
                                className="mt-0.5 size-3 shrink-0 text-destructive"
                                aria-label="Error"
                              />
                            ) : (
                              <AlertTriangle
                                className="mt-0.5 size-3 shrink-0 text-amber-600"
                                aria-label="Warning"
                              />
                            )}
                            <span>
                              <code>{i.field}</code> {i.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create / edit ────────────────────────────────────────────────────────────

type Form = {
  name: string;
  type: ConnectorType;
  url: string;
  format: string;
  sinceParam: string;
  authHeader: string;
  authEnvVar: string;
  maxRowsPerRun: string;
  batchSize: string;
  schedule: string;
  enabled: boolean;
  fanOut: boolean;
};

function toForm(c: ConnectorDto | null): Form {
  return {
    name: c?.name ?? '',
    type: c?.type ?? 'DEMO_FEED',
    url: c?.config.url ?? '',
    format: c?.config.format ?? '',
    sinceParam: c?.config.sinceParam ?? '',
    authHeader: c?.config.authHeader ?? '',
    authEnvVar: c?.config.authEnvVar ?? '',
    maxRowsPerRun: c?.config.maxRowsPerRun?.toString() ?? '',
    batchSize: c?.config.batchSize?.toString() ?? '',
    schedule: c?.schedule ?? '',
    enabled: c?.enabled ?? true,
    fanOut: c?.fanOut ?? true,
  };
}

function ConnectorDialog({ connector, onClose }: { connector: ConnectorDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(connector));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isHttp = form.type === 'HTTP_FEED';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      connector
        ? patch<ConnectorDto>(`/platform/data/connectors/${connector.id}`, body)
        : post<ConnectorDto>('/platform/data/connectors', body),
    onSuccess: (c) => {
      toast.success(connector ? `${c.name} updated` : `${c.name} created`);
      void qc.invalidateQueries({ queryKey: CONNECTORS_KEY });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors?.length) {
        const fe: Record<string, string> = {};
        for (const f of e.fieldErrors)
          fe[
            f.path
              .replace(/^body\.?/, '')
              .split('.')
              .pop() ?? ''
          ] = f.message;
        setErrors(fe);
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = (s: string) => (s.trim() ? Number(s) : undefined);
    const str = (s: string) => s.trim() || undefined;
    const config = Object.fromEntries(
      Object.entries({
        url: isHttp ? str(form.url) : undefined,
        format: isHttp ? str(form.format) : undefined,
        sinceParam: isHttp ? str(form.sinceParam) : undefined,
        authHeader: isHttp ? str(form.authHeader) : undefined,
        authEnvVar: isHttp ? str(form.authEnvVar) : undefined,
        maxRowsPerRun: num(form.maxRowsPerRun),
        batchSize: num(form.batchSize),
      }).filter(([, v]) => v !== undefined),
    );
    const body = {
      name: form.name.trim(),
      type: form.type,
      config,
      schedule: form.schedule.trim(),
      enabled: form.enabled,
      fanOut: form.fanOut,
    };
    const parsed = connectorSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = String(i.path[i.path.length - 1] ?? '');
        fe[k] ??= i.message;
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    if (connector) {
      const { type: _type, ...rest } = body;
      save.mutate(rest);
    } else save.mutate(body);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{connector ? `Edit ${connector.name}` : 'New connector'}</DialogTitle>
            <DialogDescription>
              Feeds must serve template-v1 records. Secrets are never stored here — reference a{' '}
              <code>CONNECTOR_*</code> environment variable instead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={80}
                autoFocus
                aria-invalid={!!errors.name}
                placeholder="Business wire (demo)"
              />
            </Field>
            <Field label="Type" hint={connector ? 'The type cannot be changed after creation.' : undefined}>
              <NativeSelect
                value={form.type}
                disabled={!!connector}
                onChange={(e) => set('type', e.target.value as ConnectorType)}
              >
                <option value="DEMO_FEED">
                  {CONNECTOR_TYPE_LABELS.DEMO_FEED} — synthetic records, no network
                </option>
                <option value="HTTP_FEED">{CONNECTOR_TYPE_LABELS.HTTP_FEED} — fetch an HTTPS URL</option>
              </NativeSelect>
            </Field>
          </div>
          {isHttp && (
            <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">HTTP feed</legend>
              <Field
                label="Feed URL"
                error={errors.url}
                hint="https:// only; private and loopback hosts are refused."
                className="sm:col-span-2"
              >
                <Input
                  type="url"
                  value={form.url}
                  onChange={(e) => set('url', e.target.value)}
                  placeholder="https://feeds.example.com/events.jsonl"
                  aria-invalid={!!errors.url}
                />
              </Field>
              <Field label="Format" error={errors.format}>
                <NativeSelect value={form.format} onChange={(e) => set('format', e.target.value)}>
                  <option value="">Auto-detect</option>
                  {FEED_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Since parameter (optional)"
                error={errors.sinceParam}
                hint="Query param that receives the last cursor, e.g. since"
              >
                <Input
                  value={form.sinceParam}
                  onChange={(e) => set('sinceParam', e.target.value)}
                  placeholder="since"
                  aria-invalid={!!errors.sinceParam}
                />
              </Field>
              <Field
                label="Auth header (optional)"
                error={errors.authHeader}
                hint="Header name, e.g. Authorization"
              >
                <Input
                  value={form.authHeader}
                  onChange={(e) => set('authHeader', e.target.value)}
                  placeholder="Authorization"
                  aria-invalid={!!errors.authHeader}
                />
              </Field>
              <Field
                label="Auth secret env var (optional)"
                error={errors.authEnvVar}
                hint="Must be named CONNECTOR_*"
              >
                <Input
                  value={form.authEnvVar}
                  onChange={(e) => set('authEnvVar', e.target.value.toUpperCase())}
                  placeholder="CONNECTOR_NEWSWIRE_TOKEN"
                  aria-invalid={!!errors.authEnvVar}
                />
              </Field>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Schedule (cron, optional)"
              error={errors.schedule}
              hint="5 fields, e.g. 0 */6 * * *. Empty = manual only."
            >
              <Input
                value={form.schedule}
                onChange={(e) => set('schedule', e.target.value)}
                placeholder="0 */6 * * *"
                aria-invalid={!!errors.schedule}
                className="font-mono"
              />
            </Field>
            <Field label="Max rows per run" error={errors.maxRowsPerRun} hint="1–5000">
              <Input
                type="number"
                min={1}
                max={5000}
                value={form.maxRowsPerRun}
                onChange={(e) => set('maxRowsPerRun', e.target.value)}
                aria-invalid={!!errors.maxRowsPerRun}
              />
            </Field>
            <Field label="Batch size" error={errors.batchSize} hint="1–100 rows per insert chunk">
              <Input
                type="number"
                min={1}
                max={100}
                value={form.batchSize}
                onChange={(e) => set('batchSize', e.target.value)}
                aria-invalid={!!errors.batchSize}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} label="Enabled" />
              <span>Enabled</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.fanOut}
                onCheckedChange={(v) => set('fanOut', v)}
                label="Notify organizations after each run"
              />
              <span>Notify organizations after each run (fan-out)</span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {connector ? 'Save changes' : 'Create connector'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Run history ──────────────────────────────────────────────────────────────

function duration(a: string | null, b: string | null) {
  if (!a || !b) return '—';
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function RunHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const p = useDataParams();
  const page = Math.max(1, Number(p.get('rpage')) || 1);
  const q = useQuery({
    queryKey: [...RUNS_KEY, { page }],
    queryFn: () => get<DataPage<IngestionRunDto>>('/platform/data/ingestion-runs', { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((r) => r.status === 'RUNNING' || r.status === 'QUEUED') ? 4000 : false,
  });
  return (
    <section className="space-y-3" aria-labelledby="runs-heading">
      <SectionTitle className="text-base">
        <span id="runs-heading">Run history</span>
      </SectionTitle>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No ingestion runs yet" description="Run a connector to see its history here." />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th>Connector</th>
                <th>Status</th>
                <th>Trigger</th>
                <th className="!text-right">Fetched</th>
                <th className="!text-right">Inserted</th>
                <th className="!text-right">Invalid</th>
                <th className="!text-right">Dup.</th>
                <th className="!text-right">Orgs notified</th>
                <th>Started</th>
                <th>Duration</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((r) => (
                <TR key={r.id}>
                  <td className="font-medium">{r.connector.name}</td>
                  <td>
                    <span className="flex flex-col items-start gap-0.5">
                      <RunStatusBadge status={r.status} />
                      {r.error && (
                        <span className="max-w-48 truncate text-xs text-destructive" title={r.error}>
                          {r.error}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="text-muted-foreground">
                    {r.trigger.charAt(0) + r.trigger.slice(1).toLowerCase()}
                    {r.triggeredBy ? ` · ${r.triggeredBy}` : ''}
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(r.stats.fetched)}</td>
                  <td className="text-right tabular-nums">{formatNumber(r.stats.inserted)}</td>
                  <td className="text-right tabular-nums">{formatNumber(r.stats.invalid)}</td>
                  <td className="text-right tabular-nums">{formatNumber(r.stats.duplicates)}</td>
                  <td className="text-right tabular-nums">{formatNumber(r.stats.orgsNotified)}</td>
                  <td
                    className="whitespace-nowrap text-muted-foreground"
                    title={formatDateTime(r.startedAt ?? r.createdAt)}
                  >
                    {timeAgo(r.startedAt ?? r.createdAt)}
                  </td>
                  <td className="tabular-nums">{duration(r.startedAt, r.finishedAt)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => onOpen(r.id)}>
                      Details
                    </Button>
                    {r.batchId && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/platform/data?tab=imports&batch=${r.batchId}`}>Batch</Link>
                      </Button>
                    )}
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} noun="runs" onChange={(n) => p.set({ rpage: n })} />
        </>
      )}
    </section>
  );
}
