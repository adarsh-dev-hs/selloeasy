'use client';
import {
  DATA_SOURCE_TYPES,
  MARKET_TAGS,
  TEMPLATE_V1_FIELDS,
  type DataEventDetail,
  type DataEventListItem,
  type DataPage,
} from '@selloeasy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Newspaper, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { get } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/utils';
import {
  DataPager,
  DistributionView,
  FilterField,
  ProvenanceBadge,
  RetractedBadge,
  RowButton,
  rowProps,
  SearchBox,
  SectionTitle,
  SOURCE_TYPE_LABELS,
  useDataParams,
} from './shared';

export function EventsTab() {
  const p = useDataParams();
  const filters = {
    page: p.page,
    pageSize: 25,
    q: p.get('q'),
    tag: p.get('tag'),
    source: p.get('source'),
    sourceType: p.get('sourceType'),
    batchId: p.get('batchId'),
    from: p.get('from'),
    to: p.get('to'),
    retracted: p.get('retracted') || 'exclude',
  };
  const openId = p.get('event');
  const q = useQuery({
    queryKey: ['platform', 'data', 'events', filters],
    queryFn: () => get<DataPage<DataEventListItem>>('/platform/data/events', filters),
    placeholderData: keepPreviousData,
  });
  const anyFilter = !!(
    filters.q ||
    filters.tag ||
    filters.source ||
    filters.sourceType ||
    filters.batchId ||
    filters.from ||
    filters.to ||
    filters.retracted !== 'exclude'
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchBox
          label="Search events"
          placeholder="Search title and body…"
          value={filters.q}
          onChange={(v) => p.set({ q: v })}
        />
        <FilterField label="Industry tag">
          <NativeSelect value={filters.tag} onChange={(e) => p.set({ tag: e.target.value })}>
            <option value="">All tags</option>
            {MARKET_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </FilterField>
        <FilterField label="Source type">
          <NativeSelect value={filters.sourceType} onChange={(e) => p.set({ sourceType: e.target.value })}>
            <option value="">All source types</option>
            {DATA_SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </FilterField>
        <FilterField label="Retracted">
          <NativeSelect
            value={filters.retracted}
            onChange={(e) => p.set({ retracted: e.target.value === 'exclude' ? '' : e.target.value })}
          >
            <option value="exclude">Hide retracted</option>
            <option value="include">Include retracted</option>
            <option value="only">Only retracted</option>
          </NativeSelect>
        </FilterField>
        <FilterField label="Source" className="w-40">
          <SourceInput key={filters.source} value={filters.source} onChange={(v) => p.set({ source: v })} />
        </FilterField>
        <FilterField label="Published from" className="w-40">
          <Input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => p.set({ from: e.target.value })}
          />
        </FilterField>
        <FilterField label="Published to" className="w-40">
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => p.set({ to: e.target.value })}
          />
        </FilterField>
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              p.set({
                q: null,
                tag: null,
                source: null,
                sourceType: null,
                batchId: null,
                from: null,
                to: null,
                retracted: null,
              })
            }
          >
            <X /> Clear filters
          </Button>
        )}
      </div>
      {filters.batchId && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Showing events from one batch.
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => p.set({ batchId: null })}>
            Show all
          </Button>
        </p>
      )}

      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={anyFilter ? 'No events match these filters' : 'No events yet'}
          description={
            anyFilter ? 'Try clearing a filter.' : 'Import a file or run a connector to add events.'
          }
        />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th>Published</th>
                <th className="min-w-72">Title</th>
                <th>Source</th>
                <th>Tags</th>
                <th>Subject company</th>
                <th className="!text-right">Amount</th>
                <th>Provenance</th>
                <th className="!text-right">Orgs matched</th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((e) => (
                <TR key={e.id} {...rowProps(() => p.set({ event: e.id, page: p.page }))}>
                  <td className="whitespace-nowrap text-muted-foreground">{formatDate(e.publishedAt)}</td>
                  <td>
                    <RowButton onClick={() => p.set({ event: e.id, page: p.page })} className="line-clamp-2">
                      {e.title}
                    </RowButton>
                    {e.retractedAt && (
                      <span className="mt-1 block">
                        <RetractedBadge />
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{e.source}</td>
                  <td>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {e.industryTags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>
                    {e.subjectCompany ? (
                      <>
                        <p className="whitespace-nowrap">{e.subjectCompany.name}</p>
                        {e.subjectCompany.domain && (
                          <p className="text-xs text-muted-foreground">{e.subjectCompany.domain}</p>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {e.amount === null ? '—' : formatMoney(e.amount, e.currency ?? 'INR')}
                  </td>
                  <td>
                    <ProvenanceBadge p={e} />
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(e.orgsMatched)}</td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} noun="events" onChange={(page) => p.set({ page })} />
        </>
      )}

      <EventSheet id={openId || null} onClose={() => p.set({ event: null, page: p.page })} />
    </div>
  );
}

function SourceInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      value={v}
      placeholder="Publisher…"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onChange(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && onChange(v.trim())}
    />
  );
}

function formatValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(v)) return v.length ? v.join(', ') : <span className="text-muted-foreground">—</span>;
  if (typeof v === 'object') return <code className="text-xs">{JSON.stringify(v)}</code>;
  const s = String(v);
  if (/^https:\/\//.test(s))
    return (
      <a
        href={s}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 break-all text-primary hover:underline"
      >
        {s} <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    );
  return s;
}

/** Every template field of one event, plus provenance and the distribution to orgs. */
export function EventSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['platform', 'data', 'event', id],
    queryFn: () => get<DataEventDetail>(`/platform/data/events/${id}`),
    enabled: !!id,
  });
  const [showRaw, setShowRaw] = useState(false);
  const d = q.data;
  const known = new Set(TEMPLATE_V1_FIELDS.map((f) => f.name));
  const extra = d ? Object.keys(d.record).filter((k) => !known.has(k)) : [];

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{d ? String(d.record.title ?? 'Event') : 'Event'}</SheetTitle>
          <SheetDescription>
            {d ? (
              <>
                {String(d.record.source ?? '')} · published {formatDate(String(d.record.published_at ?? ''))}{' '}
                · template v{d.schemaVersion}
              </>
            ) : (
              'Loading event…'
            )}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {q.isError ? (
            <ErrorState error={q.error} retry={() => void q.refetch()} />
          ) : !d ? (
            <Skeleton className="h-96" />
          ) : (
            <>
              <section className="space-y-2" aria-label="Provenance">
                <SectionTitle>Provenance</SectionTitle>
                <div className="flex flex-wrap items-start gap-3 text-sm">
                  <ProvenanceBadge p={d} />
                  {d.retractedAt && <RetractedBadge />}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Ingested</dt>
                  <dd>
                    {formatDateTime(d.ingestedAt)}
                    {d.ingestedBy ? ` by ${d.ingestedBy}` : ''}
                  </dd>
                  {d.batch && (
                    <>
                      <dt className="text-muted-foreground">Batch</dt>
                      <dd className="flex flex-wrap gap-3">
                        <Link
                          href={`/platform/data?tab=imports&batch=${d.batch.id}`}
                          className="text-primary hover:underline"
                        >
                          {d.batch.label}
                        </Link>
                        <Link
                          href={`/platform/data?tab=events&batchId=${d.batch.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline"
                        >
                          All events in this batch
                        </Link>
                      </dd>
                    </>
                  )}
                  {d.retractedAt && (
                    <>
                      <dt className="text-muted-foreground">Retracted</dt>
                      <dd>{formatDateTime(d.retractedAt)}</dd>
                    </>
                  )}
                </dl>
              </section>

              <section className="space-y-2" aria-label="Distribution to organizations">
                <SectionTitle>Pushed to organizations</SectionTitle>
                <DistributionView d={d.distribution} />
              </section>

              {(['event', 'company', 'contact'] as const).map((g) => (
                <section key={g} className="space-y-2" aria-label={`${g} fields`}>
                  <SectionTitle className="capitalize">{g} fields</SectionTitle>
                  <dl className="divide-y rounded-lg border text-sm">
                    {TEMPLATE_V1_FIELDS.filter((f) => f.group === g).map((f) => (
                      <div key={f.name} className="grid gap-1 px-3 py-2 sm:grid-cols-[13rem_1fr]">
                        <dt className="font-mono text-xs text-muted-foreground">{f.name}</dt>
                        <dd className={f.name === 'body' ? 'whitespace-pre-wrap break-words' : 'break-words'}>
                          {formatValue(d.record[f.name])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              {extra.length > 0 && (
                <section className="space-y-2" aria-label="Other fields">
                  <SectionTitle>Other fields</SectionTitle>
                  <dl className="divide-y rounded-lg border text-sm">
                    {extra.map((k) => (
                      <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[13rem_1fr]">
                        <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                        <dd className="break-words">{formatValue(d.record[k])}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRaw((s) => !s)}
                  aria-expanded={showRaw}
                >
                  {showRaw ? 'Hide' : 'Show'} raw JSON
                </Button>
                {showRaw && (
                  <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
                    {JSON.stringify(d.record, null, 2)}
                  </pre>
                )}
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
