'use client';
import type {
  DataBatchStatus,
  DataPage,
  DataRowStatus,
  DataSourceType,
  Distribution,
  Provenance,
} from '@selloeasy/shared';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { cn, formatNumber } from '@/lib/utils';

export const DATA_TABS = [
  'overview',
  'events',
  'companies',
  'contacts',
  'imports',
  'connectors',
  'template',
] as const;
export type DataTab = (typeof DATA_TABS)[number];

/** Base path of the data API as seen from the browser (same-origin proxy). */
export const DATA_API = '/api/v1/platform/data';

/**
 * URL-synced state for the data explorer. Every tab owns its own keys; switching tabs resets them.
 * `set` merges a patch ('' / null deletes a key) and resets `page` unless the patch sets it.
 */
export function useDataParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => sp.get(k) ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const set = (patch: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    if (!('page' in patch)) next.delete('page');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '' || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const setTab = (t: DataTab) =>
    router.replace(t === 'overview' ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  const raw = sp.get('tab') ?? '';
  const tab: DataTab = (DATA_TABS as readonly string[]).includes(raw) ? (raw as DataTab) : 'overview';
  return { get, page, set, tab, setTab };
}

export const SOURCE_TYPE_LABELS: Record<DataSourceType, string> = {
  SEED: 'Seed',
  CSV_IMPORT: 'CSV import',
  JSONL_IMPORT: 'JSONL import',
  CONNECTOR: 'Connector',
};
export const SOURCE_TYPE_COLORS: Record<DataSourceType, string> = {
  SEED: 'var(--chart-1)',
  CSV_IMPORT: 'var(--chart-2)',
  JSONL_IMPORT: 'var(--chart-3)',
  CONNECTOR: 'var(--chart-4)',
};

const BATCH_VARIANT: Record<
  DataBatchStatus,
  'success' | 'warning' | 'destructive' | 'secondary' | 'default' | 'outline'
> = {
  UPLOADED: 'secondary',
  VALIDATING: 'default',
  VALIDATED: 'warning',
  COMMITTING: 'default',
  COMMITTED: 'success',
  DISCARDED: 'outline',
  FAILED: 'destructive',
  ROLLED_BACK: 'outline',
};
const BATCH_LABEL: Record<DataBatchStatus, string> = {
  UPLOADED: 'Uploaded',
  VALIDATING: 'Validating',
  VALIDATED: 'Ready to review',
  COMMITTING: 'Committing',
  COMMITTED: 'Committed',
  DISCARDED: 'Discarded',
  FAILED: 'Failed',
  ROLLED_BACK: 'Rolled back',
};
export const BATCH_BUSY: DataBatchStatus[] = ['UPLOADED', 'VALIDATING', 'COMMITTING'];

export function BatchStatusBadge({ status }: { status: DataBatchStatus }) {
  return <Badge variant={BATCH_VARIANT[status]}>{BATCH_LABEL[status]}</Badge>;
}

const ROW_VARIANT: Record<DataRowStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  VALID: 'success',
  WARNING: 'warning',
  INVALID: 'destructive',
  DUPLICATE: 'secondary',
};
export function RowStatusBadge({ status }: { status: DataRowStatus }) {
  return <Badge variant={ROW_VARIANT[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

/** Where a record came from: source type + (when present) the batch that created it. */
export function ProvenanceBadge({ p, link = true }: { p: Provenance; link?: boolean }) {
  const badge = (
    <Badge variant="outline" className="gap-1.5">
      <span
        className="size-2 rounded-full"
        style={{ background: SOURCE_TYPE_COLORS[p.sourceType] }}
        aria-hidden
      />
      {SOURCE_TYPE_LABELS[p.sourceType]}
    </Badge>
  );
  if (!p.batch) return badge;
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      {badge}
      {link ? (
        <Link
          href={`/platform/data?tab=imports&batch=${p.batch.id}`}
          className="max-w-44 truncate text-xs text-muted-foreground hover:text-primary hover:underline"
          title={p.batch.label}
          onClick={(e) => e.stopPropagation()}
        >
          {p.batch.label}
        </Link>
      ) : (
        <span className="max-w-44 truncate text-xs text-muted-foreground" title={p.batch.label}>
          {p.batch.label}
        </span>
      )}
    </span>
  );
}

export function RetractedBadge() {
  return (
    <Tip content="Retracted by a batch rollback — org pipelines skip this record.">
      <Badge variant="destructive" tabIndex={0}>
        Retracted
      </Badge>
    </Tip>
  );
}

/** Formats a page total, prefixing "~" when the API returned an estimate (plan2 §9). */
export function totalLabel(p: Pick<DataPage<unknown>, 'total' | 'totalIsEstimate'>) {
  return `${p.totalIsEstimate ? '~' : ''}${formatNumber(p.total)}`;
}

/** Prev / next pager for data pages — handles estimated totals. */
export function DataPager({
  data,
  onChange,
  noun = 'rows',
}: {
  data: DataPage<unknown>;
  onChange: (page: number) => void;
  noun?: string;
}) {
  if (data.total === 0 && data.items.length === 0) return null;
  const from = (data.page - 1) * data.pageSize + 1;
  const to = from + data.items.length - 1;
  const hasNext = data.totalIsEstimate ? data.items.length === data.pageSize : data.page < data.totalPages;
  return (
    <nav className="flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Showing{' '}
        <span className="font-medium text-foreground">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{' '}
        of <span className="font-medium text-foreground">{totalLabel(data)}</span> {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(data.page - 1)}
          disabled={data.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft /> Prev
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          Page {formatNumber(data.page)} of {data.totalIsEstimate ? '~' : ''}
          {formatNumber(data.totalPages)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(data.page + 1)}
          disabled={!hasNext}
          aria-label="Next page"
        >
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/** Debounced search box (300 ms) — keeps typing snappy while the URL updates. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <label className="relative block min-w-52 flex-1">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        type="search"
      />
    </label>
  );
}

/** Small labelled filter control wrapper (label wraps the control). */
export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex min-w-36 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function DownloadLink({
  href,
  children,
  variant = 'outline',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'outline' | 'ghost' | 'secondary';
}) {
  return (
    <Button variant={variant} size="sm" asChild>
      <a href={href} download>
        <Download /> {children}
      </a>
    </Button>
  );
}

/** "Pushed to orgs" view (plan2 §8.4): org names + counts only — never lead records. */
export function DistributionView({ d }: { d: Distribution }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-3">
        {[
          ['Orgs matched', d.orgsMatched],
          ['Signal matches', d.matches],
          ['Leads created', d.leads],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-muted/30 p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatNumber(v as number)}</dd>
          </div>
        ))}
      </dl>
      {d.byOrg.length === 0 ? (
        <EmptyState
          className="p-6"
          title="Not matched by any organization yet"
          description="Orgs pick new events up on their next pipeline run."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <th>Organization</th>
              <th className="!text-right">Matches</th>
              <th className="!text-right">Leads</th>
            </tr>
          </THead>
          <TBody>
            {d.byOrg.map((o) => (
              <TR key={o.orgId}>
                <td>
                  <Link href={`/platform/orgs/${o.orgId}`} className="font-medium hover:text-primary">
                    {o.orgName}
                  </Link>
                </td>
                <td className="text-right tabular-nums">{formatNumber(o.matches)}</td>
                <td className="text-right tabular-nums">{formatNumber(o.leads)}</td>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Clickable table row (mouse). Keyboard users open the same drawer via the <RowButton> in the first
 * cell, so the row keeps its native table semantics.
 */
export function rowProps(onOpen: () => void) {
  return {
    className: 'cursor-pointer',
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a,button,input,select,label')) return;
      onOpen();
    },
  };
}

export function RowButton({ onClick, children, className }: { onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('text-left font-medium hover:text-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('text-sm font-semibold', className)}>{children}</h3>;
}
