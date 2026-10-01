'use client';
import { INVITABLE_ROLES, ROLE_LABELS, type OrgMember, type OrgRole, type PlatformInvite } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, UserCheck, UserPlus, Users, UserX, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/intelligence/shared';
import { InviteDialog, ROLE_HINTS } from '@/components/settings/invite-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { del, errorMessage, get, patch } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn, formatDate, timeAgo } from '@/lib/utils';

const roleVariant = (r: OrgRole) => (r === 'ORG_ADMIN' ? 'default' : r === 'SALES_MANAGER' ? 'secondary' : 'outline');

export default function TeamPage() {
  const me = useMe();
  const can = useCan();
  const isAdmin = can('org:users:manage');
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [disabling, setDisabling] = useState<OrgMember | null>(null);
  const [revoking, setRevoking] = useState<PlatformInvite | null>(null);

  const members = useQuery({ queryKey: ['org-users'], queryFn: () => get<OrgMember[]>('/org/users') });
  const invites = useQuery({ queryKey: ['org-invites'], queryFn: () => get<PlatformInvite[]>('/org/invites'), enabled: isAdmin });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: OrgRole; status?: 'ACTIVE' | 'DISABLED' } }) => patch(`/org/users/${id}`, body),
    onSuccess: (_r, v) => {
      toast.success(v.body.role ? `Role changed to ${ROLE_LABELS[v.body.role]}` : v.body.status === 'DISABLED' ? 'Member disabled — they can no longer sign in' : 'Member re-enabled');
      setDisabling(null);
      void qc.invalidateQueries({ queryKey: ['org-users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/org/invites/${id}`),
    onSuccess: () => {
      toast.success('Invitation revoked');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ['org-invites'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const now = Date.now();
  const pending = (invites.data ?? []).filter((i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt).getTime() > now);
  const activeCount = (members.data ?? []).filter((m) => m.status === 'ACTIVE').length;

  return (
    <>
      <PageHeader
        title="Team"
        description={isAdmin ? 'Invite teammates, set their roles and control access.' : 'People in your organization and their roles.'}
        actions={
          isAdmin && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Invite teammate
            </Button>
          )
        }
      />

      {members.error ? (
        <ErrorState error={members.error} retry={() => members.refetch()} />
      ) : !members.data ? (
        <Skeleton className="h-72" />
      ) : members.data.length === 0 ? (
        <EmptyState icon={Users} title="No members yet" />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {members.data.length} member{members.data.length === 1 ? '' : 's'} · {activeCount} active
          </p>
          <Table>
            <THead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                {isAdmin && <th className="text-right!">Access</th>}
              </tr>
            </THead>
            <TBody>
              {members.data.map((m) => {
                const self = m.userId === me.user.id;
                const disabled = m.status !== 'ACTIVE';
                const busy = update.isPending && update.variables?.id === m.userId;
                return (
                  <TR key={m.userId} className={cn(disabled && 'opacity-60')}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.name} {self && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      {isAdmin && !self ? (
                        <NativeSelect
                          className="h-8 w-40"
                          value={m.role}
                          disabled={busy}
                          aria-label={`Role for ${m.name}`}
                          onChange={(e) => update.mutate({ id: m.userId, body: { role: e.target.value as OrgRole } })}
                        >
                          {INVITABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Tip content={ROLE_HINTS[m.role]}>
                          <span>
                            <Badge variant={roleVariant(m.role)}>{ROLE_LABELS[m.role]}</Badge>
                          </span>
                        </Tip>
                      )}
                    </td>
                    <td>{disabled ? <Badge variant="destructive">Disabled</Badge> : <Badge variant="success">Active</Badge>}</td>
                    <td className="whitespace-nowrap text-sm text-muted-foreground">
                      {m.lastLoginAt ? <Tip content={formatDate(m.lastLoginAt, { dateStyle: 'medium', timeStyle: 'short' })}><span>{timeAgo(m.lastLoginAt)}</span></Tip> : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="text-right">
                        {self ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : disabled ? (
                          <Button variant="outline" size="sm" loading={busy} onClick={() => update.mutate({ id: m.userId, body: { status: 'ACTIVE' } })}>
                            <UserCheck /> Enable
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDisabling(m)}>
                            <UserX /> Disable
                          </Button>
                        )}
                      </td>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}

      {isAdmin && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invites that haven’t been accepted yet. Revoking makes the link stop working.</CardDescription>
          </CardHeader>
          <CardContent>
            {invites.error ? (
              <ErrorState error={invites.error} retry={() => invites.refetch()} />
            ) : !invites.data ? (
              <Skeleton className="h-20" />
            ) : pending.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {pending.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Mail className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {ROLE_LABELS[i.role]} · sent {timeAgo(i.createdAt)} · expires {formatDate(i.expiresAt)}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRevoking(i)}>
                      <XCircle /> Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />}
      <ConfirmDialog
        open={!!disabling}
        onOpenChange={(o) => !o && setDisabling(null)}
        title={`Disable ${disabling?.name ?? ''}?`}
        description="They’ll be signed out and can’t sign in until re-enabled. Leads they own stay assigned to them — reassign them from the Leads page if needed."
        confirmLabel="Disable member"
        loading={update.isPending}
        onConfirm={() => disabling && update.mutate({ id: disabling.userId, body: { status: 'DISABLED' } })}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke invitation?"
        description={revoking ? `The invite link sent to ${revoking.email} will stop working.` : undefined}
        confirmLabel="Revoke"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </>
  );
}
