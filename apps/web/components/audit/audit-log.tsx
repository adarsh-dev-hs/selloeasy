'use client';
import type { AuditEntry, Page } from '@selloeasy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { get } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

function DiffView({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return <p className="text-xs text-muted-foreground">No field changes recorded.</p>;
  const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-4 font-medium">Field</th>
            <th className="py-1 pr-4 font-medium">Before</th>
            <th className="py-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="align-top">
              <td className="py-1 pr-4 font-mono">{k}</td>
              <td className="max-w-xs break-words py-1 pr-4 text-destructive/90">{before ? fmt(before[k]) : '—'}</td>
              <td className="max-w-xs break-words py-1 text-success">{after ? fmt(after[k]) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Audit trail viewer (plan §15). `endpoint` is `/audit` (org scope, admins) or `/platform/audit`
 * (platform scope, Super Admins). Rows expand to show the field-level diff and request metadata.
 */
export function AuditLog({ endpoint, showOrg = false }: { endpoint: '/audit' | '/platform/audit'; showOrg?: boolean }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = { page, pageSize: 25, action, from, to };
  const q = useQuery({ queryKey: ['audit', endpoint, query], queryFn: () => get<Page<AuditEntry>>(endpoint, query), placeholderData: keepPreviousData });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Input placeholder="Filter by action (e.g. lead.)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action prefix" />
        </div>
        <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
        <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
        {(action || from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setAction(''); setFrom(''); setTo(''); setPage(1); }}>Clear</Button>
        )}
      </div>
      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-96" />
      ) : q.data.total === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" description="Nothing matches these filters." />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <th className="w-6" />
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                {showOrg && <th>Organization</th>}
                <th>IP</th>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((e) => (
                <Fragment key={e.id}>
                  <TR className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td>{open === e.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 text-muted-foreground" />}</td>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(e.occurredAt)}</td>
                    <td className="text-sm">
                      {e.actor ? (
                        <>
                          {e.actor.name}
                          <span className="block text-xs text-muted-foreground">{e.actorRole}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">System</span>
                      )}
                    </td>
                    <td>
                      <Badge variant={e.action.includes('failed') || e.action.includes('deleted') || e.action.includes('revoked') ? 'destructive' : 'secondary'} className="font-mono">
                        {e.action}
                      </Badge>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {e.entityType}
                      {e.entityId && <span className="block max-w-40 truncate font-mono">{e.entityId}</span>}
                    </td>
                    {showOrg && <td className="text-sm">{e.orgName ?? '—'}</td>}
                    <td className="font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</td>
                  </TR>
                  {open === e.id && (
                    <tr className="border-b bg-muted/30">
                      <td />
                      <td colSpan={showOrg ? 6 : 5} className="py-3">
                        <DiffView before={e.before} after={e.after} />
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Request {e.requestId ?? '—'} · {e.userAgent ?? 'unknown client'}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
          <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onChange={setPage} />
        </>
      )}
    </div>
  );
}
