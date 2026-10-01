'use client';
import {
  DATA_BATCH_KINDS,
  DATA_ROW_STATUSES,
  type DataBatchDetail,
  type DataBatchDto,
  type DataBatchRowDto,
  type DataPage,
  type DataRowStatus,
} from '@selloeasy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Info,
  Loader2,
  Undo2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, Switch } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { ApiError, errorMessage, get, post } from '@/lib/api';
import { Can, useCan } from '@/lib/auth';
import { cn, formatDateTime, formatNumber, timeAgo } from '@/lib/utils';
import {
  BATCH_BUSY,
  BatchStatusBadge,
  DATA_API,
  DataPager,
  DistributionView,
  DownloadLink,
  FilterField,
  RowStatusBadge,
  SectionTitle,
  useDataParams,
} from './shared';

const ACCEPT = '.csv,.jsonl,.ndjson,.json';
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 1 : 0)}%`;

/** Multipart upload (fields before the file so the API sees `fanOut` alongside the part). */
async function uploadImport(file: File, fanOut: boolean, retried = false): Promise<DataBatchDto> {
  const fd = new FormData();
  fd.append('fanOut', String(fanOut));
  fd.append('file', file, file.name);
  const res = await fetch(`${DATA_API}/imports`, { method: 'POST', body: fd, credentials: 'same-origin' });
  if (res.status === 401 && !retried) {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' }).catch(
      () => null,
    );
    if (r?.ok) return uploadImport(file, fanOut, true);
  }
  if (!res.ok) {
    let body: {
      title?: string;
      code?: string;
      details?: unknown;
      errors?: { path: string; message: string }[];
    } = {};
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, body.title ?? res.statusText, body.code, body.details, body.errors);
  }
  return (await res.json()) as DataBatchDto;
}

export function TemplateDownloads() {
  return (
    <div className="flex flex-wrap gap-2">
      <DownloadLink href={`${DATA_API}/template.csv`}>CSV template</DownloadLink>
      <DownloadLink href={`${DATA_API}/template.schema.json`}>JSON Schema</DownloadLink>
      <DownloadLink href={`${DATA_API}/samples/sampleData.csv`}>sampleData.csv</DownloadLink>
      <DownloadLink href={`${DATA_API}/samples/sampleData.invalid.csv`}>sampleData.invalid.csv</DownloadLink>
    </div>
  );
}

export function ImportsTab() {
  const p = useDataParams();
  const batchId = p.get('batch');
  const openBatch = (id: string | null) => p.set({ batch: id, rowStatus: null, rowPage: null, page: p.page });

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                1
              </span>{' '}
              Download the template
            </CardTitle>
            <CardDescription>
              Records follow template v1 — see the Template tab for every field and rule. Try{' '}
              <code className="text-xs">sampleData.csv</code> (10 valid rows) or the invalid sample to see
              each validation layer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateDownloads />
          </CardContent>
        </Card>
        <Can
          permission="platform:data:import"
          fallback={
            <Card>
              <CardHeader>
                <CardTitle>Upload</CardTitle>
                <CardDescription>
                  You need the platform:data:import permission to upload files.
                </CardDescription>
              </CardHeader>
            </Card>
          }
        >
          <UploadCard onUploaded={(b) => openBatch(b.id)} />
        </Can>
      </div>

      {batchId && <BatchPanel id={batchId} onClose={() => openBatch(null)} />}

      <BatchHistory activeId={batchId} onOpen={(id) => openBatch(id)} />
    </div>
  );
}

function UploadCard({ onUploaded }: { onUploaded: (b: DataBatchDto) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fanOut, setFanOut] = useState(true);
  const [drag, setDrag] = useState(false);

  const upload = useMutation({
    mutationFn: () => uploadImport(file!, fanOut),
    onSuccess: (b) => {
      toast.success(`${b.label} uploaded — validating ${formatNumber(b.stats.rows)} rows`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded(b);
      void qc.invalidateQueries({ queryKey: ['platform', 'data', 'batches'] });
    },
    onError: (e) => {
      const failed =
        e instanceof ApiError ? (e.details as { batch?: DataBatchDto } | undefined)?.batch : undefined;
      toast.error(failed ? `File rejected: ${e.message}` : errorMessage(e));
      if (failed) {
        onUploaded(failed);
        void qc.invalidateQueries({ queryKey: ['platform', 'data', 'batches'] });
      }
    },
  });

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(csv|jsonl|ndjson|json)$/i.test(f.name)) {
      toast.error('Choose a .csv, .jsonl or .json file');
      return;
    }
    setFile(f);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
            2
          </span>{' '}
          Upload a file
        </CardTitle>
        <CardDescription>
          CSV, JSONL or JSON (format auto-detected). Nothing reaches the data source until you review and
          commit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose an import file: drop it here or press Enter to browse"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            drag ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40',
          )}
        >
          {file ? (
            <>
              <FileSpreadsheet className="size-6 text-primary" aria-hidden />
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB — click to choose another file
              </p>
            </>
          ) : (
            <>
              <UploadCloud className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">
                {drag ? 'Drop to select' : 'Drop a file here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">.csv · .jsonl · .json</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => pick(e.target.files)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={fanOut} onCheckedChange={setFanOut} label="Notify organizations after commit" />
            <span>Notify organizations after commit (fan-out)</span>
          </label>
          <Button onClick={() => upload.mutate()} disabled={!file} loading={upload.isPending}>
            <UploadCloud /> Upload & validate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: 'success' | 'warning' | 'destructive' | 'muted';
}) {
  const cls = {
    success: 'text-success',
    warning: 'text-amber-600 dark:text-amber-300',
    destructive: 'text-destructive',
    muted: 'text-muted-foreground',
  }[tone ?? 'muted'];
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-semibold tabular-nums', tone && cls)}>{formatNumber(value ?? 0)}</dd>
    </div>
  );
}

function BatchPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const q = useQuery({
    queryKey: ['platform', 'data', 'batch', id],
    queryFn: () => get<DataBatchDetail>(`/platform/data/batches/${id}`),
    refetchInterval: (query) =>
      query.state.data && BATCH_BUSY.includes(query.state.data.status) ? 1500 : false,
  });
  const b = q.data;
  const [fanOut, setFanOut] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'rollback' | null>(null);

  // When the batch leaves a busy state, refresh everything that depends on it.
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!b) return;
    if (prev.current && prev.current !== b.status) {
      void qc.invalidateQueries({ queryKey: ['platform', 'data', 'batches'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'data', 'rows', id] });
      if (b.status === 'COMMITTED' || b.status === 'ROLLED_BACK') {
        void qc.invalidateQueries({ queryKey: ['platform', 'data', 'overview'] });
        void qc.invalidateQueries({ queryKey: ['platform', 'data', 'events'] });
        void qc.invalidateQueries({ queryKey: ['platform', 'data', 'companies'] });
        void qc.invalidateQueries({ queryKey: ['platform', 'data', 'contacts'] });
      }
      if (b.status === 'COMMITTED')
        toast.success(`${b.label} committed — ${formatNumber(b.stats.inserted)} events inserted`);
      if (b.status === 'VALIDATED') toast.info(`${b.label} validated — review the report`);
    }
    prev.current = b.status;
  }, [b, id, qc]);

  const onDone = (msg: string) => {
    toast.success(msg);
    setConfirm(null);
    void qc.invalidateQueries({ queryKey: ['platform', 'data'] });
  };
  const commit = useMutation({
    mutationFn: () =>
      post<DataBatchDto>(`/platform/data/batches/${id}/commit`, { fanOut: fanOut ?? b?.fanOut }),
    onSuccess: () => onDone('Commit started'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => post<DataBatchDto>(`/platform/data/batches/${id}/discard`),
    onSuccess: () => onDone('Batch discarded'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rollback = useMutation({
    mutationFn: () => post<DataBatchDto>(`/platform/data/batches/${id}/rollback`),
    onSuccess: () => onDone('Batch rolled back — its events are retracted'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError)
    return (
      <Card>
        <CardContent className="pt-5">
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        </CardContent>
      </Card>
    );
  if (!b) return <Skeleton className="h-64" />;

  const s = b.stats;
  const busy = BATCH_BUSY.includes(b.status);
  const invalidRatio = s.rows ? s.invalid / s.rows : 0;
  const flagged = s.invalid + s.warnings + s.duplicates;
  const hasRows =
    !['UPLOADED', 'VALIDATING'].includes(b.status) && !(b.status === 'FAILED' && b.fileIssues.length > 0);
  const effectiveFanOut = fanOut ?? b.fanOut;

  return (
    <Card aria-labelledby="batch-title">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle id="batch-title" className="flex flex-wrap items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
              3
            </span>
            {b.label} <BatchStatusBadge status={b.status} />
          </CardTitle>
          <CardDescription>
            {b.kind === 'IMPORT' ? 'File import' : b.kind === 'INGESTION' ? 'Connector ingestion' : 'Seed'}
            {b.format ? ` · ${b.format.toUpperCase()}` : ''} · uploaded {formatDateTime(b.createdAt)}
            {b.validatedAt ? ` · validated ${timeAgo(b.validatedAt)}` : ''}
            {b.committedAt ? ` · committed ${timeAgo(b.committedAt)}` : ''}
            {b.rolledBackAt ? ` · rolled back ${timeAgo(b.rolledBackAt)}` : ''}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X /> Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {busy && (
          <p
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            {b.status === 'COMMITTING'
              ? 'Committing rows to the data source…'
              : 'Validating rows — schema, quality, consistency and duplicate checks…'}
          </p>
        )}
        {b.status === 'FAILED' && (
          <div
            className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            role="alert"
          >
            <p className="flex items-center gap-2 font-medium text-destructive">
              <XCircle className="size-4" aria-hidden /> {b.error ?? 'The file was rejected'}
            </p>
            {b.fileIssues.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-6 text-muted-foreground">
                {b.fileIssues.map((i, n) => (
                  <li key={n}>
                    {i.field && <code className="text-xs">{i.field}</code>} {i.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Rejected files never create staging rows. Fix the file and upload it again.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatBox label="Rows" value={s.rows} />
          <StatBox label="Valid" value={s.valid} tone="success" />
          <StatBox label="Warnings" value={s.warnings} tone="warning" />
          <StatBox label="Invalid" value={s.invalid} tone="destructive" />
          <StatBox label="Duplicates" value={s.duplicates} />
        </dl>
        {['COMMITTED', 'ROLLED_BACK'].includes(b.status) && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="Events inserted" value={s.inserted} tone="success" />
            <StatBox label="Companies created" value={s.companiesCreated} />
            <StatBox label="Companies updated" value={s.companiesUpdated} />
            <StatBox label="Contacts created" value={s.contactsCreated} />
          </dl>
        )}

        {b.status === 'VALIDATED' && (
          <section className="space-y-3 rounded-lg border p-4" aria-labelledby="commit-heading">
            <SectionTitle className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                4
              </span>
              <span id="commit-heading">Commit or discard</span>
            </SectionTitle>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Invalid rows: <strong className="text-foreground">{pct(invalidRatio)}</strong>
                </span>
                <span>Limit: {pct(b.maxInvalidRatio)}</span>
              </div>
              <div
                className="relative h-2 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`Invalid ratio ${pct(invalidRatio)} of a ${pct(b.maxInvalidRatio)} limit`}
              >
                <div
                  className={cn(
                    'h-full rounded-full',
                    invalidRatio > b.maxInvalidRatio ? 'bg-destructive' : 'bg-success',
                  )}
                  style={{ width: `${Math.min(100, invalidRatio * 100)}%` }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/60"
                  style={{ left: `${Math.min(100, b.maxInvalidRatio * 100)}%` }}
                  aria-hidden
                />
              </div>
            </div>
            {b.committable ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                Committing inserts {formatNumber(s.valid + s.warnings)} rows (valid + warning). Invalid and
                duplicate rows are skipped.
              </p>
            ) : (
              <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {invalidRatio > b.maxInvalidRatio
                  ? `${formatNumber(s.invalid)} of ${formatNumber(s.rows)} rows (${pct(invalidRatio)}) are invalid — above the ${pct(b.maxInvalidRatio)} limit. Fix the file and upload it again.`
                  : 'Nothing to commit — the file has no valid rows.'}
              </p>
            )}
            <Can permission="platform:data:import">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={effectiveFanOut}
                    onCheckedChange={setFanOut}
                    label="Notify organizations after commit"
                  />
                  <span>Notify organizations after commit</span>
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setConfirm('discard')}>
                    Discard
                  </Button>
                  <Button
                    onClick={() => commit.mutate()}
                    disabled={!b.committable}
                    loading={commit.isPending}
                    aria-describedby="commit-heading"
                  >
                    Commit {formatNumber(s.valid + s.warnings)} rows
                  </Button>
                </div>
              </div>
            </Can>
          </section>
        )}
        {b.status === 'FAILED' && can('platform:data:import') && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setConfirm('discard')}>
              Discard batch
            </Button>
          </div>
        )}

        {['COMMITTED', 'ROLLED_BACK'].includes(b.status) && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Pushed to organizations</SectionTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/platform/data?tab=events&batchId=${b.id}&retracted=include`}>
                    View events
                  </Link>
                </Button>
                {b.status === 'COMMITTED' && (
                  <Can permission="platform:data:manage">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setConfirm('rollback')}
                    >
                      <Undo2 /> Roll back
                    </Button>
                  </Can>
                )}
              </div>
            </div>
            {b.distribution ? (
              <DistributionView d={b.distribution} />
            ) : (
              <p className="text-sm text-muted-foreground">No distribution data.</p>
            )}
          </section>
        )}

        {hasRows && s.rows > 0 && <BatchRows batchId={b.id} flagged={flagged} />}
      </CardContent>

      <ConfirmDialog
        open={confirm === 'discard'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Discard this import?"
        description="The staged rows are deleted and nothing is written to the data source. You can upload the file again later."
        confirmLabel="Discard"
        loading={discard.isPending}
        onConfirm={() => discard.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'rollback'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Roll back this batch?"
        description={
          <>
            Its {formatNumber(s.inserted)} events (and directory rows that exist only because of this batch)
            are retracted, so future org pipeline runs skip them. Leads that organizations already created are
            kept.
          </>
        }
        confirmLabel="Roll back"
        loading={rollback.isPending}
        onConfirm={() => rollback.mutate()}
      />
    </Card>
  );
}

function BatchRows({ batchId, flagged }: { batchId: string; flagged: number }) {
  const p = useDataParams();
  const status = p.get('rowStatus') as DataRowStatus | '';
  const page = Math.max(1, Number(p.get('rowPage')) || 1);
  const q = useQuery({
    queryKey: ['platform', 'data', 'rows', batchId, { status, page }],
    queryFn: () =>
      get<DataPage<DataBatchRowDto>>(`/platform/data/batches/${batchId}/rows`, {
        status,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const setStatus = (s: string) => p.set({ rowStatus: s, rowPage: null, page: p.page });

  return (
    <section className="space-y-3" aria-labelledby="rows-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>
          <span id="rows-heading">Validation report</span>
        </SectionTitle>
        {flagged > 0 && (
          <DownloadLink href={`${DATA_API}/batches/${batchId}/errors.csv`}>Download issues CSV</DownloadLink>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter rows by status">
        {(['', ...DATA_ROW_STATUSES] as const).map((s) => (
          <Button
            key={s || 'all'}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
          </Button>
        ))}
      </div>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState className="p-6" title={status ? `No ${status.toLowerCase()} rows` : 'No rows'} />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th className="!text-right">Row</th>
                <th>Status</th>
                <th className="min-w-64">Title / company</th>
                <th className="min-w-72">Issues</th>
                <th>Event</th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((r) => (
                <TR key={r.rowNumber} className="align-top">
                  <td className="text-right tabular-nums text-muted-foreground">{r.rowNumber}</td>
                  <td>
                    <RowStatusBadge status={r.status} />
                  </td>
                  <td>
                    <p className="line-clamp-2">{String(r.raw.title ?? '—')}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(r.raw.subject_company_name ?? '')}
                    </p>
                  </td>
                  <td>
                    {r.issues.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No issues</span>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {r.issues.map((i, n) => (
                          <li key={n} className="flex items-start gap-1.5">
                            {i.severity === 'error' ? (
                              <XCircle
                                className="mt-0.5 size-3.5 shrink-0 text-destructive"
                                aria-label="Error"
                              />
                            ) : (
                              <AlertTriangle
                                className="mt-0.5 size-3.5 shrink-0 text-amber-600"
                                aria-label="Warning"
                              />
                            )}
                            <span>
                              {i.field && <code className="mr-1 rounded bg-muted px-1">{i.field}</code>}
                              {i.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {r.insertedEventId ? (
                      <Link
                        href={`/platform/data?tab=events&event=${r.insertedEventId}&retracted=include`}
                        className="text-primary hover:underline"
                      >
                        Inserted event
                      </Link>
                    ) : r.duplicateOfEventId ? (
                      <Link
                        href={`/platform/data?tab=events&event=${r.duplicateOfEventId}&retracted=include`}
                        className="text-primary hover:underline"
                      >
                        Duplicate of…
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} onChange={(n) => p.set({ rowPage: n, page: p.page })} />
        </>
      )}
    </section>
  );
}

function BatchHistory({ activeId, onOpen }: { activeId: string; onOpen: (id: string) => void }) {
  const p = useDataParams();
  const kind = p.get('kind');
  const page = Math.max(1, Number(p.get('hpage')) || 1);
  const q = useQuery({
    queryKey: ['platform', 'data', 'batches', { kind, page }],
    queryFn: () => get<DataPage<DataBatchDto>>('/platform/data/batches', { kind, page, pageSize: 10 }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((b) => BATCH_BUSY.includes(b.status)) ? 3000 : false,
  });

  return (
    <section className="space-y-3" aria-labelledby="history-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="history-heading" className="flex items-center gap-2 text-base font-semibold">
          <History className="size-4 text-primary" aria-hidden /> Batch history
        </h2>
        <FilterField label="Kind">
          <NativeSelect
            value={kind}
            onChange={(e) => p.set({ kind: e.target.value, hpage: null, page: p.page })}
          >
            <option value="">All kinds</option>
            {DATA_BATCH_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0) + k.slice(1).toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </FilterField>
      </div>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={Info}
          title="No batches yet"
          description="Uploads and connector runs appear here."
        />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th>Batch</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="!text-right">Rows</th>
                <th className="!text-right">Valid</th>
                <th className="!text-right">Warn.</th>
                <th className="!text-right">Invalid</th>
                <th className="!text-right">Dup.</th>
                <th className="!text-right">Inserted</th>
                <th>Created</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((b) => (
                <TR key={b.id} className={b.id === activeId ? 'bg-primary/5' : undefined}>
                  <td className="max-w-60">
                    <p className="truncate font-medium" title={b.label}>
                      {b.label}
                    </p>
                    {!b.fanOut && <Badge variant="outline">No fan-out</Badge>}
                  </td>
                  <td className="text-muted-foreground">
                    {b.kind.charAt(0) + b.kind.slice(1).toLowerCase()}
                  </td>
                  <td>
                    <BatchStatusBadge status={b.status} />
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.rows)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.valid)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.warnings)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.invalid)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.duplicates)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.stats.inserted)}</td>
                  <td className="whitespace-nowrap text-muted-foreground" title={formatDateTime(b.createdAt)}>
                    {timeAgo(b.createdAt)}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpen(b.id)}
                      aria-label={`View batch ${b.label}`}
                    >
                      View
                    </Button>
                    {b.status === 'COMMITTED' && (
                      <Can permission="platform:data:manage">
                        <RollbackAction batch={b} />
                      </Can>
                    )}
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} noun="batches" onChange={(n) => p.set({ hpage: n, page: p.page })} />
        </>
      )}
    </section>
  );
}

function RollbackAction({ batch }: { batch: DataBatchDto }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rollback = useMutation({
    mutationFn: () => post<DataBatchDto>(`/platform/data/batches/${batch.id}/rollback`),
    onSuccess: () => {
      toast.success(`${batch.label} rolled back — its events are retracted`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['platform', 'data'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Roll back batch ${batch.label}`}
      >
        <Undo2 /> Roll back
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Roll back ${batch.label}?`}
        description={
          <>
            Its {formatNumber(batch.stats.inserted)} events (and directory rows that exist only because of this
            batch) are retracted, so future org pipeline runs skip them. Leads that organizations already created
            are kept.
          </>
        }
        confirmLabel="Roll back"
        loading={rollback.isPending}
        onConfirm={() => rollback.mutate()}
      />
    </>
  );
}
