'use client';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  type LeadListItem,
  type LeadStage,
  type OrgMember,
  type Page,
  type Signal,
} from '@selloeasy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Download, Hand, LayoutGrid, List, Mail, MessageCircle, Phone, Radar, Search, Target } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BantBars, ScoreBadge, StageBadge } from '@/components/leads/badges';
import { OutreachDialog, type OutreachChannelUI } from '@/components/leads/outreach-dialog';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Tip } from '@/components/ui/tooltip';
import { errorMessage, get, post, qs } from '@/lib/api';
import { Can, useCan, useMe } from '@/lib/auth';
import { cn, formatDate, timeAgo } from '@/lib/utils';

type Filters = { page: number; q: string; stage: string; band: string; signalId: string; owner: string; sort: string; view: 'grid' | 'table' };

function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f: Filters = {
    page: Number(sp.get('page') ?? 1) || 1,
    q: sp.get('q') ?? '',
    stage: sp.get('stage') ?? '',
    band: sp.get('band') ?? '',
    signalId: sp.get('signalId') ?? '',
    owner: sp.get('owner') ?? 'any',
    sort: sp.get('sort') ?? 'score',
    view: (sp.get('view') as Filters['view']) ?? 'grid',
  };
  const set = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch, page: patch.page ?? 1 };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || (k === 'page' && v === 1) || (k === 'owner' && v === 'any') || (k === 'sort' && v === 'score') || (k === 'view' && v === 'grid')) continue;
      params.set(k, String(v));
    }
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };
  return [f, set];
}

function QuickActions({ lead, onAction }: { lead: LeadListItem; onAction: (c: OutreachChannelUI) => void }) {
  const actions: [OutreachChannelUI, typeof Mail, string][] = [
    ['email', Mail, 'Email'],
    ['whatsapp', MessageCircle, 'WhatsApp'],
    ['call', Phone, 'Call'],
    ['meeting', CalendarClock, 'Schedule meeting'],
  ];
  return (
    <div className="flex items-center gap-1">
      {actions.map(([c, Icon, label]) => (
        <Tip key={c} content={label}>
          <Button variant="ghost" size="icon-sm" aria-label={`${label} ${lead.account.name}`} onClick={() => onAction(c)}>
            <Icon />
          </Button>
        </Tip>
      ))}
    </div>
  );
}

function LeadCard({ lead, onAction, onClaim, canAct }: { lead: LeadListItem; onAction: (c: OutreachChannelUI) => void; onClaim: () => void; canAct: boolean }) {
  return (
    <article className="group flex flex-col rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <Link href={`/app/leads/${lead.id}`} className="block truncate font-semibold hover:text-primary">
            {lead.account.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {[lead.account.industry, lead.account.hqCountry, lead.account.domain].filter(Boolean).join(' · ')}
          </p>
        </div>
        <ScoreBadge score={lead.scoreTotal} band={lead.scoreBand} size="sm" />
      </div>
      <div className="px-4">
        {lead.headlineSignal ? (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Radar className="size-3.5" /> {lead.headlineSignal.signalName}
              {lead.signalCount > 1 && <span className="text-muted-foreground">+{lead.signalCount - 1} more</span>}
            </p>
            <p className="mt-1 line-clamp-2 text-sm">{lead.headlineSignal.eventTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatDate(lead.headlineSignal.publishedAt)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No signal evidence</p>
        )}
      </div>
      <div className="px-4 pt-3">
        <BantBars bant={lead.bant} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t px-4 py-2.5 mt-4">
        <div className="flex min-w-0 items-center gap-2">
          <StageBadge stage={lead.stage} />
          {lead.owner ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Avatar name={lead.owner.name} className="size-5 text-[9px]" /> <span className="truncate">{lead.owner.name.split(' ')[0]}</span>
            </span>
          ) : (
            canAct && (
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onClaim}>
                <Hand className="size-3" /> Claim
              </Button>
            )
          )}
        </div>
        {canAct && <QuickActions lead={lead} onAction={onAction} />}
      </div>
    </article>
  );
}

function LeadsPage() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = useFilters();
  const [qInput, setQInput] = useState(f.q);
  const [outreach, setOutreach] = useState<{ leadId: string; channel: OutreachChannelUI } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = { page: f.page, pageSize: f.view === 'table' ? 20 : 6, q: f.q, stage: f.stage, band: f.band, signalId: f.signalId, owner: f.owner, sort: f.sort };
  const leads = useQuery({
    queryKey: ['leads', query],
    queryFn: () => get<Page<LeadListItem>>('/leads', query),
    placeholderData: keepPreviousData,
  });
  const signals = useQuery({ queryKey: ['signals'], queryFn: () => get<Signal[]>('/signals') });
  const members = useQuery({ queryKey: ['org-users'], queryFn: () => get<OrgMember[]>('/org/users'), enabled: can('leads:assign') });

  const claim = useMutation({
    mutationFn: (id: string) => post(`/leads/${id}/claim`),
    onSuccess: () => {
      toast.success('Lead claimed — it’s yours');
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const bulk = useMutation({
    mutationFn: (action: { type: 'assign'; ownerUserId: string | null } | { type: 'stage'; stage: LeadStage }) => post('/leads/bulk', { leadIds: [...selected], action }),
    onSuccess: (r: unknown) => {
      toast.success(`Updated ${(r as { updated: number }).updated} leads`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canAct = (l: LeadListItem) => can('outreach:send') && (me.role !== 'SDR' || !l.owner || l.owner.id === me.user.id);
  const exportHref = `/api/v1/leads/export.csv${qs({ q: f.q, stage: f.stage, band: f.band, signalId: f.signalId, owner: f.owner, sort: f.sort })}`;
  const activeSignals = useMemo(() => (signals.data ?? []).filter((s) => s.isActive), [signals.data]);
  const data = leads.data;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Companies showing buying signals that match your ICPs — scored on BANT+, newest evidence first."
        actions={
          <>
            <Can permission="leads:export">
              <Button variant="outline" asChild>
                <a href={exportHref}>
                  <Download /> Export CSV
                </a>
              </Button>
            </Can>
            <div className="flex rounded-md border bg-card p-0.5">
              <Button variant={f.view === 'grid' ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Card view" onClick={() => setF({ view: 'grid' })}>
                <LayoutGrid />
              </Button>
              <Button variant={f.view === 'table' ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Table view" onClick={() => setF({ view: 'table' })}>
                <List />
              </Button>
            </div>
          </>
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <form
          className="relative lg:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            setF({ q: qInput });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search accounts…" value={qInput} onChange={(e) => setQInput(e.target.value)} onBlur={() => qInput !== f.q && setF({ q: qInput })} />
        </form>
        <NativeSelect value={f.stage} onChange={(e) => setF({ stage: e.target.value })} aria-label="Stage">
          <option value="">All stages</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={f.band} onChange={(e) => setF({ band: e.target.value })} aria-label="Score band">
          <option value="">All scores</option>
          <option value="HOT">Hot (75+)</option>
          <option value="WARM">Warm (50–74)</option>
          <option value="COLD">Cold (&lt;50)</option>
        </NativeSelect>
        <NativeSelect value={f.signalId} onChange={(e) => setF({ signalId: e.target.value })} aria-label="Signal">
          <option value="">All signals</option>
          {activeSignals.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={f.owner} onChange={(e) => setF({ owner: e.target.value })} aria-label="Owner">
            <option value="any">Any owner</option>
            <option value="me">Mine</option>
            <option value="unassigned">Unassigned</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </NativeSelect>
          <NativeSelect value={f.sort} onChange={(e) => setF({ sort: e.target.value })} aria-label="Sort">
            <option value="score">Top score</option>
            <option value="recent">Newest signal</option>
            <option value="oldest">Oldest</option>
            <option value="account">A–Z</option>
          </NativeSelect>
      </div>

      {leads.error ? (
        <ErrorState error={leads.error} retry={() => leads.refetch()} />
      ) : !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data.total === 0 ? (
        <EmptyState
          icon={Target}
          title={f.q || f.stage || f.band || f.signalId || f.owner !== 'any' ? 'No leads match these filters' : 'No leads yet'}
          description={
            f.q || f.stage || f.band || f.signalId || f.owner !== 'any'
              ? 'Try clearing a filter.'
              : 'Run the intelligence pipeline to scan market events against your signals.'
          }
          action={
            can('pipeline:run') ? (
              <Button asChild>
                <Link href="/app/pipeline">Go to pipeline</Link>
              </Button>
            ) : undefined
          }
        />
      ) : f.view === 'grid' ? (
        <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', leads.isFetching && 'opacity-70 transition-opacity')}>
          {data.items.map((l) => (
            <LeadCard key={l.id} lead={l} canAct={canAct(l)} onClaim={() => claim.mutate(l.id)} onAction={(c) => setOutreach({ leadId: l.id, channel: c })} />
          ))}
        </div>
      ) : (
        <>
          {can('leads:assign') && selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-accent/50 px-3 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <NativeSelect
                className="h-8 w-48"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) bulk.mutate({ type: 'assign', ownerUserId: e.target.value === 'none' ? null : e.target.value });
                  e.target.value = '';
                }}
              >
                <option value="">Assign to…</option>
                <option value="none">Unassign</option>
                {members.data?.filter((m) => m.status === 'ACTIVE').map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name}</option>
                ))}
              </NativeSelect>
              <NativeSelect
                className="h-8 w-48"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) bulk.mutate({ type: 'stage', stage: e.target.value as LeadStage });
                  e.target.value = '';
                }}
              >
                <option value="">Move to stage…</option>
                {LEAD_STAGES.filter((s) => s !== 'LOST').map((s) => (
                  <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
                ))}
              </NativeSelect>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}
          <Table>
            <THead>
              <tr>
                {can('leads:assign') && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={data.items.length > 0 && data.items.every((l) => selected.has(l.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((l) => l.id)) : new Set())}
                    />
                  </th>
                )}
                <th>Account</th>
                <th>Score</th>
                <th>Headline signal</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Last signal</th>
                <th />
              </tr>
            </THead>
            <TBody>
              {data.items.map((l) => (
                <TR key={l.id}>
                  {can('leads:assign') && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.account.name}`}
                        checked={selected.has(l.id)}
                        onChange={(e) => {
                          const n = new Set(selected);
                          if (e.target.checked) n.add(l.id);
                          else n.delete(l.id);
                          setSelected(n);
                        }}
                      />
                    </td>
                  )}
                  <td>
                    <Link href={`/app/leads/${l.id}`} className="font-medium hover:text-primary">{l.account.name}</Link>
                    <p className="text-xs text-muted-foreground">{l.account.industry}</p>
                  </td>
                  <td><ScoreBadge score={l.scoreTotal} band={l.scoreBand} size="sm" /></td>
                  <td className="max-w-xs">
                    <p className="truncate text-xs font-medium text-primary">{l.headlineSignal?.signalName}</p>
                    <p className="truncate text-xs text-muted-foreground">{l.headlineSignal?.eventTitle}</p>
                  </td>
                  <td><StageBadge stage={l.stage} /></td>
                  <td className="text-sm">{l.owner?.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-xs text-muted-foreground">{timeAgo(l.lastSignalAt)}</td>
                  <td>{canAct(l) && <QuickActions lead={l} onAction={(c) => setOutreach({ leadId: l.id, channel: c })} />}</td>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      {data && data.total > 0 && (
        <div className="mt-6">
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={(p) => setF({ page: p })} />
        </div>
      )}

      {outreach && (
        <OutreachDialog leadId={outreach.leadId} channel={outreach.channel} open={!!outreach} onOpenChange={(o) => !o && setOutreach(null)} />
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LeadsPage />
    </Suspense>
  );
}
