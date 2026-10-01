'use client';
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  ROLE_LABELS,
  type Industry,
  type PlatformInvite,
  type PlatformOrgListItem,
  type PlatformOrgPublicView,
  type PlatformOrgStats,
  type PlatformOrgUser,
} from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  Ban,
  Bot,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Globe,
  Handshake,
  MailPlus,
  MapPin,
  Package,
  Pencil,
  Percent,
  PlayCircle,
  Send,
  Target,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, formatPct, formatUsd, InviteLinkBox, OrgStatusBadge, PublicDataNote, RunStatusBadge } from '@/components/platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton, Stat, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { del, errorMessage, get, patch, post } from '@/lib/api';
import { Can, useCan } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber, timeAgo, titleCase } from '@/lib/utils';

// ── Edit dialog ────────────────────────────────────────────────────────────
function EditOrgDialog({ org, open, onOpenChange }: { org: PlatformOrgPublicView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(org.name);
  const [industry, setIndustry] = useState<Industry>(org.industry);
  const nameError = name.trim().length < 2 ? 'Name must be at least 2 characters' : name.trim().length > 120 ? 'Name must be 120 characters or fewer' : undefined;
  const save = useMutation({
    mutationFn: () => patch<PlatformOrgListItem>(`/platform/orgs/${org.id}`, { name: name.trim(), industry }),
    onSuccess: () => {
      toast.success('Organization updated');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setName(org.name);
          setIndustry(org.industry);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameError) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
            <DialogDescription>Rename or re-classify this tenant. Changing industry does not re-clone signal templates.</DialogDescription>
          </DialogHeader>
          <Field label="Name" error={name !== org.name ? nameError : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} maxLength={120} />
          </Field>
          <Field label="Industry">
            <NativeSelect value={industry} onChange={(e) => setIndustry(e.target.value as Industry)} aria-label="Industry">
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {INDUSTRY_LABELS[i]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!!nameError || (name.trim() === org.name && industry === org.industry)}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Overview tab ───────────────────────────────────────────────────────────
function OverviewTab({ org }: { org: PlatformOrgPublicView }) {
  const facts: [typeof Globe, string, React.ReactNode][] = [
    [
      Globe,
      'Website',
      org.websiteUrl ? (
        <a href={org.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          {org.websiteUrl.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null,
    ],
    [MapPin, 'Headquarters', org.hq],
    [Users, 'Company size', org.companySize ? `${org.companySize} employees` : null],
    [Building2, 'Industry', INDUSTRY_LABELS[org.industry]],
    [CalendarCheck, 'Created', formatDate(org.createdAt)],
    [Activity, 'Activated', org.activatedAt ? formatDate(org.activatedAt) : null],
  ];
  return (
    <div className="space-y-5">
      <PublicDataNote>Public-level data — only fields the organization marked Public are shown. Internal documents, leads and contacts are never visible here.</PublicDataNote>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Public profile</CardTitle>
            <CardDescription>Company summary and value propositions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {org.publicProfile ? (
              <>
                {org.publicProfile.summary ? (
                  <p className="text-sm leading-relaxed">{org.publicProfile.summary}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No summary written yet.</p>
                )}
                {org.publicProfile.valueProps.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Value propositions</h4>
                    <ul className="space-y-1.5">
                      {org.publicProfile.valueProps.map((v, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                          {v}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <EmptyState className="p-6" title="No public profile" description="The profile hasn't been completed, or the organization kept it internal." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Company facts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {facts.map(([Icon, label, value]) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="break-words text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="text-xs text-muted-foreground">Regions served</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {org.regions.length ? (
                      org.regions.map((r) => (
                        <Badge key={r} variant="secondary">
                          {r}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4 text-primary" aria-hidden /> Public products
            </CardTitle>
          </CardHeader>
          <CardContent>
            {org.publicProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No public products.</p>
            ) : (
              <ul className="divide-y">
                {org.publicProducts.map((p) => (
                  <li key={p.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {p.name}
                      {p.category && <Badge variant="outline">{p.category}</Badge>}
                    </p>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden /> Public documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {org.publicDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No public documents.</p>
            ) : (
              <ul className="divide-y">
                {org.publicDocuments.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      {d.url && <p className="truncate text-xs text-muted-foreground">{d.url}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="secondary">{d.type}</Badge>
                      {d.url && (
                        <Button variant="ghost" size="icon-sm" asChild>
                          <a href={d.url} target="_blank" rel="noreferrer" aria-label={`Open ${d.title}`}>
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Metrics tab ────────────────────────────────────────────────────────────
function MetricsTab({ orgId }: { orgId: string }) {
  const stats = useQuery({ queryKey: ['platform', 'org', orgId, 'stats'], queryFn: () => get<PlatformOrgStats>(`/platform/orgs/${orgId}/stats`) });
  if (stats.error) return <ErrorState error={stats.error} retry={() => stats.refetch()} />;
  const s = stats.data;
  if (!s)
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  const run = s.lastPipelineRun;
  return (
    <div className="space-y-5">
      <PublicDataNote>Aggregate counts only — individual leads and contacts are not accessible to platform admins.</PublicDataNote>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads" value={formatNumber(s.leads)} icon={Target} />
        <Stat label="Approached" value={formatNumber(s.approached)} icon={Send} tone="warning" />
        <Stat label="Meetings" value={formatNumber(s.meetings)} icon={CalendarCheck} />
        <Stat label="Converted" value={formatNumber(s.converted)} icon={Handshake} tone="success" />
        <Stat label="Conversion rate" value={formatPct(s.conversionRate)} hint="Converted ÷ approached" icon={Percent} tone="success" />
        <Stat label="LLM cost (30d)" value={formatUsd(s.llmCost30dUsd)} icon={CircleDollarSign} tone="hot" />
        <Stat label="LLM calls (30d)" value={formatNumber(s.llmCalls30d)} icon={Bot} />
        <Stat
          label="Last pipeline run"
          value={run ? <RunStatusBadge status={run.status} /> : <span className="text-base text-muted-foreground">Never run</span>}
          hint={run?.finishedAt ? `${timeAgo(run.finishedAt)} · ${formatDateTime(run.finishedAt)}` : run ? 'In progress' : undefined}
          icon={PlayCircle}
        />
      </div>
      {run?.error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <p className="font-medium text-destructive">Last run error</p>
          <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{run.error}</p>
        </div>
      )}
    </div>
  );
}

// ── Users tab ──────────────────────────────────────────────────────────────
function UsersTab({ orgId }: { orgId: string }) {
  const users = useQuery({ queryKey: ['platform', 'org', orgId, 'users'], queryFn: () => get<PlatformOrgUser[]>(`/platform/orgs/${orgId}/users`) });
  if (users.error) return <ErrorState error={users.error} retry={() => users.refetch()} />;
  if (!users.data)
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  if (users.data.length === 0) return <EmptyState icon={Users} title="No users yet" description="Users appear here once the admin accepts the invitation and adds a team." />;
  return (
    <Table>
      <THead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Last login</th>
        </tr>
      </THead>
      <TBody>
        {users.data.map((u) => (
          <TR key={u.id}>
            <td>
              <span className="flex items-center gap-2 font-medium">
                <Avatar name={u.name} className="size-7 text-[10px]" /> {u.name}
              </span>
            </td>
            <td className="text-muted-foreground">{u.email}</td>
            <td>
              <Badge variant={u.role === 'ORG_ADMIN' ? 'default' : 'secondary'}>{ROLE_LABELS[u.role]}</Badge>
            </td>
            <td>
              <Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'}>{titleCase(u.status)}</Badge>
            </td>
            <td className="whitespace-nowrap text-muted-foreground" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
              {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}
            </td>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// ── Invites tab ────────────────────────────────────────────────────────────
type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
function inviteStatus(i: PlatformInvite): InviteStatus {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  if (new Date(i.expiresAt).getTime() < Date.now()) return 'expired';
  return 'pending';
}
const INVITE_VARIANT: Record<InviteStatus, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'destructive',
  expired: 'secondary',
};

function InvitesTab({ orgId, orgName }: { orgId: string; orgName: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [lastLink, setLastLink] = useState<{ link: string; email: string } | null>(null);
  const [revoking, setRevoking] = useState<PlatformInvite | null>(null);
  const invites = useQuery({ queryKey: ['platform', 'org', orgId, 'invites'], queryFn: () => get<PlatformInvite[]>(`/platform/orgs/${orgId}/invites`) });

  const send = useMutation({
    mutationFn: (to: string) => post<{ id: string; expiresAt: string; inviteLink?: string }>(`/platform/orgs/${orgId}/invites`, { email: to }),
    onSuccess: (r, to) => {
      toast.success(`Admin invite sent to ${to}`);
      setLastLink(r.inviteLink ? { link: r.inviteLink, email: to } : null);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/platform/invites/${id}`),
    onSuccess: () => {
      toast.success('Invitation revoked');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <Can permission="platform:orgs:manage">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailPlus className="size-4 text-primary" aria-hidden /> Resend admin invite
            </CardTitle>
            <CardDescription>Send a fresh Org Admin invitation for {orgName}. Existing pending invites stay valid until revoked or expired.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-start"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const v = email.trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
                  setEmailError('Enter a valid email address');
                  return;
                }
                setEmailError(undefined);
                send.mutate(v);
              }}
            >
              <div className="flex-1">
                <label htmlFor="invite-email" className="sr-only">
                  Admin email
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="admin@company.example"
                  value={email}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'invite-email-error' : undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(undefined);
                  }}
                />
                {emailError && (
                  <p id="invite-email-error" className="mt-1 text-xs text-destructive">
                    {emailError}
                  </p>
                )}
              </div>
              <Button type="submit" loading={send.isPending}>
                <Send /> Send invite
              </Button>
            </form>
            {lastLink && <InviteLinkBox link={lastLink.link} email={lastLink.email} />}
          </CardContent>
        </Card>
      </Can>

      {invites.error ? (
        <ErrorState error={invites.error} retry={() => invites.refetch()} />
      ) : !invites.data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : invites.data.length === 0 ? (
        <EmptyState icon={MailPlus} title="No invitations" description="Invitations sent to this organization will be listed here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Expires</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </THead>
          <TBody>
            {invites.data.map((i) => {
              const st = inviteStatus(i);
              return (
                <TR key={i.id}>
                  <td className="font-medium">{i.email}</td>
                  <td>{ROLE_LABELS[i.role]}</td>
                  <td>
                    <Badge variant={INVITE_VARIANT[st]}>{titleCase(st)}</Badge>
                    {st === 'accepted' && <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(i.acceptedAt)}</p>}
                    {st === 'revoked' && <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(i.revokedAt)}</p>}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground" title={formatDateTime(i.createdAt)}>
                    {timeAgo(i.createdAt)}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{formatDateTime(i.expiresAt)}</td>
                  <td className="text-right">
                    {st === 'pending' && can('platform:orgs:manage') && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRevoking(i)}>
                        <Ban /> Revoke
                      </Button>
                    )}
                  </td>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke invitation?"
        description={
          <>
            The invite link sent to <strong className="text-foreground">{revoking?.email}</strong> will stop working immediately. You can send a new one later.
          </>
        }
        confirmLabel="Revoke invitation"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  const org = useQuery({ queryKey: ['platform', 'org', id], queryFn: () => get<PlatformOrgPublicView>(`/platform/orgs/${id}`), enabled: !!id });

  const lifecycle = useMutation({
    mutationFn: (action: 'suspend' | 'reactivate') => post<PlatformOrgListItem>(`/platform/orgs/${id}/${action}`),
    onSuccess: (_r, action) => {
      toast.success(action === 'suspend' ? 'Organization suspended' : 'Organization reactivated');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const back = (
    <Link href="/platform/orgs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Organizations
    </Link>
  );

  if (org.error)
    return (
      <>
        {back}
        <ErrorState error={org.error} retry={() => org.refetch()} />
      </>
    );
  const o = org.data;
  if (!o)
    return (
      <>
        {back}
        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-9 w-96" />
          <Skeleton className="h-64" />
        </div>
      </>
    );

  const suspended = o.status === 'SUSPENDED';

  return (
    <>
      {back}
      <PageHeader
        title={o.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <OrgStatusBadge status={o.status} />
            <span>{INDUSTRY_LABELS[o.industry]}</span>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs">{o.slug}</span>
          </span>
        }
        actions={
          <Can permission="platform:orgs:manage">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            {suspended ? (
              <Button onClick={() => setConfirm('reactivate')}>
                <PlayCircle /> Reactivate
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirm('suspend')}>
                <Ban /> Suspend
              </Button>
            )}
          </Can>
        }
      />
      {suspended && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">
          This organization is suspended — its members cannot sign in or use the app until it is reactivated.
        </div>
      )}

      <Tabs defaultValue="overview">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="invites">Invites</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab org={o} />
        </TabsContent>
        <TabsContent value="metrics">
          <MetricsTab orgId={o.id} />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab orgId={o.id} />
        </TabsContent>
        <TabsContent value="invites">
          <InvitesTab orgId={o.id} orgName={o.name} />
        </TabsContent>
      </Tabs>

      <EditOrgDialog org={o} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === 'suspend' ? `Suspend ${o.name}?` : `Reactivate ${o.name}?`}
        description={
          confirm === 'suspend'
            ? 'Members lose access immediately and cannot sign in until the organization is reactivated. All data is retained and you can reactivate at any time.'
            : 'Members will be able to sign in and use the app again.'
        }
        confirmLabel={confirm === 'suspend' ? 'Suspend organization' : 'Reactivate'}
        destructive={confirm === 'suspend'}
        loading={lifecycle.isPending}
        onConfirm={() => confirm && lifecycle.mutate(confirm)}
      />
    </>
  );
}
