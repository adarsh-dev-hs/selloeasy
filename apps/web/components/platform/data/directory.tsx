'use client';
import {
  DATA_SOURCE_TYPES,
  MARKET_TAGS,
  type DataCompanyDetail,
  type DataCompanyListItem,
  type DataContactListItem,
  type DataPage,
} from '@selloeasy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/input';
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
import { formatDate, formatNumber } from '@/lib/utils';
import {
  DataPager,
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

function SourceTypeFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FilterField label="Source type">
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All source types</option>
        {DATA_SOURCE_TYPES.map((t) => (
          <option key={t} value={t}>
            {SOURCE_TYPE_LABELS[t]}
          </option>
        ))}
      </NativeSelect>
    </FilterField>
  );
}

// ── Companies ────────────────────────────────────────────────────────────────

export function CompaniesTab() {
  const p = useDataParams();
  const filters = {
    page: p.page,
    pageSize: 25,
    q: p.get('q'),
    industry: p.get('industry'),
    sourceType: p.get('sourceType'),
  };
  const q = useQuery({
    queryKey: ['platform', 'data', 'companies', filters],
    queryFn: () => get<DataPage<DataCompanyListItem>>('/platform/data/companies', filters),
    placeholderData: keepPreviousData,
  });
  const anyFilter = !!(filters.q || filters.industry || filters.sourceType);
  const open = (id: string) => p.set({ company: id, page: p.page });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchBox
          label="Search companies"
          placeholder="Search name or domain…"
          value={filters.q}
          onChange={(v) => p.set({ q: v })}
        />
        <FilterField label="Industry">
          <NativeSelect value={filters.industry} onChange={(e) => p.set({ industry: e.target.value })}>
            <option value="">All industries</option>
            {MARKET_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </FilterField>
        <SourceTypeFilter value={filters.sourceType} onChange={(v) => p.set({ sourceType: v })} />
      </div>
      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={anyFilter ? 'No companies match these filters' : 'No companies in the directory yet'}
        />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th>Company</th>
                <th>Domain</th>
                <th>Industry</th>
                <th>Country</th>
                <th>Size</th>
                <th className="!text-right">Employees</th>
                <th className="!text-right">Contacts</th>
                <th className="!text-right">Events</th>
                <th>Provenance</th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((c) => (
                <TR key={c.id} {...rowProps(() => open(c.id))}>
                  <td>
                    <RowButton onClick={() => open(c.id)}>{c.name}</RowButton>
                    {c.retractedAt && (
                      <span className="mt-1 block">
                        <RetractedBadge />
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{c.domain ?? '—'}</td>
                  <td className="whitespace-nowrap">{c.industry ?? '—'}</td>
                  <td>{c.hqCountry ?? '—'}</td>
                  <td className="whitespace-nowrap">{c.sizeBand ?? '—'}</td>
                  <td className="text-right tabular-nums">{formatNumber(c.employees)}</td>
                  <td className="text-right tabular-nums">{formatNumber(c.contactsCount)}</td>
                  <td className="text-right tabular-nums">{formatNumber(c.eventsCount)}</td>
                  <td>
                    <ProvenanceBadge p={c} />
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} noun="companies" onChange={(page) => p.set({ page })} />
        </>
      )}
      <CompanySheet id={p.get('company') || null} onClose={() => p.set({ company: null, page: p.page })} />
    </div>
  );
}

function CompanySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['platform', 'data', 'company', id],
    queryFn: () => get<DataCompanyDetail>(`/platform/data/companies/${id}`),
    enabled: !!id,
  });
  const d = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{d?.name ?? 'Company'}</SheetTitle>
          <SheetDescription>
            {d
              ? [d.domain, d.industry, d.hqCountry].filter(Boolean).join(' · ') || 'Directory company'
              : 'Loading company…'}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {q.isError ? (
            <ErrorState error={q.error} retry={() => void q.refetch()} />
          ) : !d ? (
            <Skeleton className="h-96" />
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-start gap-3">
                  <ProvenanceBadge p={d} />
                  {d.retractedAt && <RetractedBadge />}
                </div>
                {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Size band', d.sizeBand ?? '—'],
                    ['Employees', formatNumber(d.employees)],
                    ['Contacts', formatNumber(d.contactsCount)],
                    ['Events', formatNumber(d.eventsCount)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border bg-muted/30 p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="space-y-2">
                <SectionTitle>Contacts</SectionTitle>
                {d.contacts.length === 0 ? (
                  <EmptyState className="p-6" icon={UserRound} title="No contacts" />
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {d.contacts.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.title ?? '—'}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {c.email && <p>{c.email}</p>}
                          {c.phone && <p>{c.phone}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="space-y-2">
                <SectionTitle>Recent events</SectionTitle>
                {d.recentEvents.length === 0 ? (
                  <EmptyState className="p-6" title="No events" />
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {d.recentEvents.map((e) => (
                      <li key={e.id} className="space-y-1 px-3 py-2">
                        <Link href={`/platform/data?tab=events&event=${e.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {e.title}
                        </Link>
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {formatDate(e.publishedAt)} · {e.source} · {formatNumber(e.orgsMatched)} orgs
                          matched
                          {e.retractedAt && <Badge variant="destructive">Retracted</Badge>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export function ContactsTab() {
  const p = useDataParams();
  const filters = { page: p.page, pageSize: 25, q: p.get('q'), sourceType: p.get('sourceType') };
  const q = useQuery({
    queryKey: ['platform', 'data', 'contacts', filters],
    queryFn: () => get<DataPage<DataContactListItem>>('/platform/data/contacts', filters),
    placeholderData: keepPreviousData,
  });
  const anyFilter = !!(filters.q || filters.sourceType);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchBox
          label="Search contacts"
          placeholder="Search name, title or email…"
          value={filters.q}
          onChange={(v) => p.set({ q: v })}
        />
        <SourceTypeFilter value={filters.sourceType} onChange={(v) => p.set({ sourceType: v })} />
      </div>
      <p className="text-xs text-muted-foreground">
        Directory contacts are platform-owned (synthetic / public directory) data, not tenant records.
      </p>
      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={anyFilter ? 'No contacts match these filters' : 'No contacts yet'}
        />
      ) : (
        <>
          <Table className={q.isPlaceholderData ? 'opacity-60' : undefined}>
            <THead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Provenance</th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((c) => (
                <TR key={c.id}>
                  <td className="whitespace-nowrap font-medium">
                    {c.name}
                    {c.retractedAt && (
                      <span className="mt-1 block">
                        <RetractedBadge />
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{c.title ?? '—'}</td>
                  <td>
                    <Link href={`/platform/data?tab=companies&company=${c.company.id}`}
                      className="whitespace-nowrap hover:text-primary hover:underline"
                    >
                      {c.company.name}
                    </Link>
                    {c.company.domain && <p className="text-xs text-muted-foreground">{c.company.domain}</p>}
                  </td>
                  <td className="text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{c.phone ?? '—'}</td>
                  <td>
                    <ProvenanceBadge p={c} />
                  </td>
                </TR>
              ))}
            </TBody>
          </Table>
          <DataPager data={q.data} noun="contacts" onChange={(page) => p.set({ page })} />
        </>
      )}
    </div>
  );
}
