'use client';
import { INDUSTRIES, INDUSTRY_LABELS, ORG_STATUSES, type PlatformOrgListItem } from '@selloeasy/shared';
import { useQuery } from '@tanstack/react-query';
import { Building2, Mail, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CreateOrgDialog } from '@/components/platform/create-org-dialog';
import { OrgStatusBadge, PublicDataNote } from '@/components/platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { Can } from '@/lib/auth';
import { formatDate, formatNumber, titleCase } from '@/lib/utils';

function OrgsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const status = sp.get('status') ?? '';
  const industry = sp.get('industry') ?? '';
  const [createOpen, setCreateOpen] = useState(sp.get('new') === '1');

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    p.delete('new');
    router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
  };

  const orgs = useQuery({ queryKey: ['platform', 'orgs'], queryFn: () => get<PlatformOrgListItem[]>('/platform/orgs') });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orgs.data ?? []).filter(
      (o) =>
        (!status || o.status === status) &&
        (!industry || o.industry === industry) &&
        (!needle || o.name.toLowerCase().includes(needle) || o.slug.includes(needle)),
    );
  }, [orgs.data, q, status, industry]);

  const filtering = !!(q || status || industry);

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every tenant on the platform, its lifecycle status and team size."
        actions={
          <Can permission="platform:orgs:manage">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New organization
            </Button>
          </Can>
        }
      />
      <PublicDataNote className="mb-5" />

      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Search organizations…" aria-label="Search organizations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {ORG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={industry} onChange={(e) => setParam('industry', e.target.value)} aria-label="Industry">
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {INDUSTRY_LABELS[i]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {orgs.error ? (
        <ErrorState error={orgs.error} retry={() => orgs.refetch()} />
      ) : !orgs.data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={filtering ? 'No organizations match these filters' : 'No organizations yet'}
          description={filtering ? 'Try clearing the search or a filter.' : 'Create the first organization and invite its admin to onboard.'}
          action={
            filtering ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQ('');
                  router.replace(pathname, { scroll: false });
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New organization
              </Button>
            )
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <th>Organization</th>
                <th>Industry</th>
                <th>Status</th>
                <th className="!text-right">Users</th>
                <th>Pending invites</th>
                <th>Created</th>
              </tr>
            </THead>
            <TBody>
              {filtered.map((o) => (
                <TR key={o.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={o.name} />
                      <div className="min-w-0">
                        <Link href={`/platform/orgs/${o.id}`} className="block truncate font-medium hover:text-primary">
                          {o.name}
                        </Link>
                        <p className="truncate font-mono text-xs text-muted-foreground">{o.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{INDUSTRY_LABELS[o.industry]}</td>
                  <td>
                    <OrgStatusBadge status={o.status} />
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(o.userCount)}</td>
                  <td>
                    {o.pendingInvites > 0 ? (
                      <Badge variant="warning">
                        <Mail className="size-3" aria-hidden /> {o.pendingInvites} pending
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt)}</td>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {filtered.length} of {orgs.data.length} organizations
          </p>
        </>
      )}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <OrgsPage />
    </Suspense>
  );
}
