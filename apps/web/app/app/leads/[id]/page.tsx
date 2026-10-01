'use client';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  SCORE_DIMENSION_LABELS,
  SCORE_WEIGHTS,
  type Activity,
  type LeadDetail,
  type LeadStage,
  type OrgMember,
  type ScoreDimension,
  type Task,
} from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Circle,
  ExternalLink,
  Hand,
  Link2,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Plus,
  Radar,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  UserPlus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ScoreBadge, StageBadge } from '@/components/leads/badges';
import { OutreachDialog, type OutreachChannelUI } from '@/components/leads/outreach-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage, get, patch, post } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn, formatDate, formatDateTime, formatMoney, timeAgo } from '@/lib/utils';

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  CALL: Phone,
  MEETING: CalendarClock,
  NOTE: NotebookPen,
  STAGE_CHANGE: RefreshCw,
  ASSIGNMENT: Hand,
  TASK: CheckCircle2,
  SCORE_CHANGED: Sparkles,
  SIGNAL: Radar,
};

function ScoreExplainer({ lead }: { lead: LeadDetail }) {
  const dims = Object.keys(SCORE_WEIGHTS) as ScoreDimension[];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Why this score?
        </CardTitle>
        <CardDescription>
          BANT+ = Budget 20 · Authority 15 · Need 25 · Timeline 15 · ICP fit 15 · Signal strength 10. Budget, Need and Timeline are judged by the LLM from the evidence; the rest are computed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {dims.map((d) => {
          const s = lead.breakdown[d];
          const points = Math.round((SCORE_WEIGHTS[d] * s.score) / 10);
          return (
            <div key={d} className="grid gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {SCORE_DIMENSION_LABELS[d]} <span className="text-xs font-normal text-muted-foreground">· weight {SCORE_WEIGHTS[d]}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{s.score.toFixed(1)}</span>/10 → {points} pts
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', s.score >= 7.5 ? 'bg-success' : s.score >= 5 ? 'bg-primary' : 'bg-warning')}
                  style={{ width: `${s.score * 10}%` }}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{s.rationale}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Evidence({ lead }: { lead: LeadDetail }) {
  if (lead.evidence.length === 0) return <EmptyState icon={Radar} title="No evidence" />;
  // One card per news event; an event can satisfy several signals.
  const groups = new Map<string, LeadDetail['evidence']>();
  for (const e of lead.evidence) groups.set(e.event.id, [...(groups.get(e.event.id) ?? []), e]);
  return (
    <ol className="relative grid gap-4 border-l pl-6">
      {[...groups.values()].map((matches) => {
        const ev = matches[0]!.event;
        return (
          <li key={ev.id} className="relative">
            <span className="absolute -left-[31px] top-1 flex size-4 items-center justify-center rounded-full bg-primary ring-4 ring-background" />
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                {matches.map((m) => (
                  <Badge key={m.matchId}>
                    <Radar className="size-3" /> {m.signalName} · {Math.round(m.confidence * 100)}%
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground">
                  {formatDate(ev.publishedAt)} · {ev.source}
                  {ev.region ? ` · ${ev.region}` : ''}
                </span>
              </div>
              <p className="mt-2 font-medium">{ev.title}</p>
              <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{ev.summary}</p>
              {ev.amount && (
                <p className="mt-2 text-sm">
                  Deal size signal: <span className="font-medium">{formatMoney(ev.amount, ev.currency ?? 'INR')}</span>
                </p>
              )}
              <div className="mt-2 grid gap-1 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {matches.map((m) => (
                  <p key={m.matchId}>
                    <span className="font-medium text-foreground">Why it matched{matches.length > 1 ? ` “${m.signalName}”` : ''}: </span>
                    {m.rationale}
                  </p>
                ))}
              </div>
              {ev.url && (
                <a href={ev.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Source article <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Timeline({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const acts = useQuery({ queryKey: ['activities', leadId], queryFn: () => get<Activity[]>(`/leads/${leadId}/activities`) });
  const add = useMutation({
    mutationFn: () => post(`/leads/${leadId}/activities`, { type: 'NOTE', body: note }),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: ['activities', leadId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-4">
      {canWrite && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
          <Textarea rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" className="self-end" disabled={!note.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Add note
          </Button>
        </div>
      )}
      {acts.isLoading ? (
        <Skeleton className="h-48" />
      ) : !acts.data?.length ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="grid gap-3">
          {acts.data.map((a) => {
            const Icon = ACTIVITY_ICON[a.type] ?? Circle;
            const status = (a.metadata as { status?: string }).status;
            return (
              <li key={a.id} className="flex gap-3">
                <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', a.direction === 'OUTBOUND' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {a.subject ?? a.type.replace('_', ' ').toLowerCase()}
                      {status && <Badge variant={status === 'failed' ? 'destructive' : status === 'sent' ? 'success' : 'secondary'} className="ml-2">{status}</Badge>}
                    </p>
                    <span className="text-xs text-muted-foreground" title={formatDateTime(a.occurredAt)}>
                      {a.actor?.name ?? 'System'} · {timeAgo(a.occurredAt)}
                    </span>
                  </div>
                  {a.body && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground line-clamp-6">{a.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Tasks({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const tasks = useQuery({ queryKey: ['lead-tasks', leadId], queryFn: () => get<Task[]>(`/leads/${leadId}/tasks`) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const add = useMutation({
    mutationFn: () => post(`/leads/${leadId}/tasks`, { title, dueAt: due ? new Date(due).toISOString() : undefined }),
    onSuccess: () => {
      setTitle('');
      setDue('');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (t: Task) => patch(`/tasks/${t.id}`, { completed: !t.completedAt }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-4">
      {canWrite && (
        <form
          className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input placeholder="e.g. Follow up after the launch event" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input type="datetime-local" className="sm:w-56" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <Button type="submit" disabled={title.trim().length < 2} loading={add.isPending}>
            <Plus /> Add
          </Button>
        </form>
      )}
      {!tasks.data?.length ? (
        <EmptyState title="No tasks" description="Create follow-ups so nothing slips." />
      ) : (
        <ul className="grid gap-2">
          {tasks.data.map((t) => {
            const overdue = !t.completedAt && t.dueAt && new Date(t.dueAt) < new Date();
            return (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
                <button onClick={() => toggle.mutate(t)} aria-label={t.completedAt ? 'Mark as open' : 'Mark as done'} className="cursor-pointer text-muted-foreground hover:text-primary">
                  {t.completedAt ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5" />}
                </button>
                <span className={cn('flex-1 text-sm', t.completedAt && 'text-muted-foreground line-through')}>{t.title}</span>
                <span className={cn('text-xs', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>{t.dueAt ? formatDateTime(t.dueAt) : 'No due date'}</span>
                {t.assignee && <Avatar name={t.assignee.name} className="size-6 text-[10px]" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface OutreachMessageRow {
  id: string;
  channel: string;
  to: string;
  subject: string | null;
  body: string;
  status: string;
  error: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

function Messages({ leadId }: { leadId: string }) {
  const msgs = useQuery({ queryKey: ['outreach', leadId], queryFn: () => get<OutreachMessageRow[]>(`/leads/${leadId}/outreach`) });
  if (!msgs.data?.length) return <EmptyState icon={Mail} title="No emails sent yet" />;
  return (
    <ul className="grid gap-3">
      {msgs.data.map((m) => (
        <li key={m.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{m.subject}</p>
            <Badge variant={m.status === 'SENT' ? 'success' : m.status === 'FAILED' ? 'destructive' : 'secondary'}>{m.status.toLowerCase()}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            To {m.to} · by {m.sentBy ?? '—'} · {formatDateTime(m.sentAt ?? m.createdAt)}
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground line-clamp-6">{m.body}</p>
          {m.error && <p className="mt-2 text-xs text-destructive">{m.error}</p>}
        </li>
      ))}
    </ul>
  );
}

function Contacts({ lead, canWrite, onChanged }: { lead: LeadDetail; canWrite: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', title: '', email: '', phone: '', whatsapp: '' });
  const add = useMutation({
    mutationFn: () => post(`/leads/${lead.id}/contacts`, Object.fromEntries(Object.entries(form).filter(([, v]) => v))),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: '', title: '', email: '', phone: '', whatsapp: '' });
      toast.success('Contact added');
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const makePrimary = useMutation({
    mutationFn: (id: string) => patch(`/leads/${lead.id}`, { primaryContactId: id }),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Contacts</CardTitle>
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <UserPlus /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {lead.contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
        {lead.contacts.map((c) => {
          const primary = lead.primaryContact?.id === c.id;
          return (
            <div key={c.id} className={cn('rounded-lg border p-3', primary && 'border-primary/40 bg-primary/5')}>
              <div className="flex items-start gap-2">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {c.name} {primary && <Star className="size-3.5 fill-primary text-primary" aria-label="Primary contact" />}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.title}</p>
                </div>
                {canWrite && !primary && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => makePrimary.mutate(c.id)}>
                    Make primary
                  </Button>
                )}
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {c.email && (
                  <span className="flex items-center gap-1.5 truncate">
                    <Mail className="size-3" /> {c.email}
                  </span>
                )}
                {c.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3" /> {c.phone}
                  </span>
                )}
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-primary">
                    <Link2 className="size-3" /> LinkedIn
                  </a>
                )}
                {c.source === 'SYNTHETIC' && <span className="text-[10px] uppercase tracking-wide">synthetic contact</span>}
              </div>
            </div>
          );
        })}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add contact at {lead.account.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['name', 'title', 'email', 'phone', 'whatsapp'] as const).map((k) => (
              <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} className={k === 'name' ? 'sm:col-span-2' : undefined}>
                <Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} type={k === 'email' ? 'email' : 'text'} />
              </Field>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} loading={add.isPending} disabled={form.name.trim().length < 2}>Save contact</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [outreach, setOutreach] = useState<OutreachChannelUI | null>(null);
  const [stageDialog, setStageDialog] = useState<LeadStage | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [wonValue, setWonValue] = useState('');

  const lead = useQuery({ queryKey: ['lead', id], queryFn: () => get<LeadDetail>(`/leads/${id}`) });
  const members = useQuery({ queryKey: ['org-users'], queryFn: () => get<OrgMember[]>('/org/users'), enabled: can('leads:assign') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['lead', id] });
    void qc.invalidateQueries({ queryKey: ['activities', id] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
  };

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/leads/${id}`, { ...body, version: lead.data?.version }),
    onSuccess: () => {
      toast.success('Lead updated');
      setStageDialog(null);
      setLostReason('');
      setWonValue('');
      refresh();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      refresh();
    },
  });
  const claim = useMutation({
    mutationFn: () => post(`/leads/${id}/claim`),
    onSuccess: () => {
      toast.success('Lead claimed');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rescore = useMutation({
    mutationFn: () => post<{ scoreTotal: number }>(`/leads/${id}/rescore`),
    onSuccess: (r) => {
      toast.success(`Re-scored: ${r.scoreTotal}`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (lead.error) return <ErrorState error={lead.error} retry={() => lead.refetch()} />;
  if (!lead.data)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );

  const l = lead.data;
  const isOwner = l.owner?.id === me.user.id;
  const canMutate = can('leads:update') && (me.role !== 'SDR' || isOwner);
  const canContact = can('outreach:send') && (me.role !== 'SDR' || isOwner || !l.owner);

  const changeStage = (s: LeadStage) => {
    if (s === l.stage) return;
    if (s === 'LOST' || s === 'WON') setStageDialog(s);
    else update.mutate({ stage: s });
  };

  return (
    <>
      <Link href="/app/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All leads
      </Link>

      <div className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{l.account.name}</h1>
            <ScoreBadge score={l.scoreTotal} band={l.scoreBand} />
            <StageBadge stage={l.stage} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[l.account.industry, l.account.hqCountry, l.account.sizeBand && `${l.account.sizeBand} employees`, l.account.domain].filter(Boolean).join(' · ')}
          </p>
          {l.icp && (
            <p className="mt-1 text-xs text-muted-foreground">
              Best ICP match: <span className="font-medium text-foreground">{l.icp.name}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canContact && (
            <>
              <Button variant="outline" size="sm" onClick={() => setOutreach('email')}>
                <Mail /> Email
              </Button>
              <Button variant="outline" size="sm" onClick={() => setOutreach('whatsapp')}>
                <MessageCircle /> WhatsApp
              </Button>
              <Button variant="outline" size="sm" onClick={() => setOutreach('call')}>
                <Phone /> Call
              </Button>
              <Button size="sm" onClick={() => setOutreach('meeting')}>
                <CalendarClock /> Schedule
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="emails">Emails</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="grid gap-6">
              <ScoreExplainer lead={l} />
              <div>
                <h2 className="mb-3 flex items-center gap-2 font-semibold">
                  <Radar className="size-4 text-primary" /> Signal evidence ({new Set(l.evidence.map((e) => e.event.id)).size} events)
                </h2>
                <Evidence lead={l} />
              </div>
            </TabsContent>
            <TabsContent value="activity">
              <Timeline leadId={l.id} canWrite={canMutate} />
            </TabsContent>
            <TabsContent value="tasks">
              <Tasks leadId={l.id} canWrite={can('tasks:write')} />
            </TabsContent>
            <TabsContent value="emails">
              <Messages leadId={l.id} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Stage">
                <NativeSelect value={l.stage} disabled={!canMutate || update.isPending} onChange={(e) => changeStage(e.target.value as LeadStage)}>
                  {LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Owner">
                {can('leads:assign') ? (
                  <NativeSelect value={l.owner?.id ?? ''} disabled={update.isPending} onChange={(e) => update.mutate({ ownerUserId: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {members.data?.filter((m) => m.status === 'ACTIVE' && m.role !== 'VIEWER').map((m) => (
                      <option key={m.userId} value={m.userId}>{m.name}</option>
                    ))}
                  </NativeSelect>
                ) : l.owner ? (
                  <span className="flex items-center gap-2 text-sm">
                    <Avatar name={l.owner.name} className="size-6 text-[10px]" /> {l.owner.name}
                  </span>
                ) : can('leads:claim') ? (
                  <Button variant="outline" size="sm" onClick={() => claim.mutate()} loading={claim.isPending}>
                    <Hand /> Claim this lead
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">Unassigned</span>
                )}
              </Field>
              {l.stage === 'WON' && l.wonValue !== null && (
                <p className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                  <Trophy className="size-4" /> Won · {formatMoney(l.wonValue)}
                </p>
              )}
              {l.stage === 'LOST' && l.lostReason && (
                <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <XCircle className="size-4" /> Lost · {l.lostReason}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>First signal</span>
                <span className="text-right text-foreground">{formatDate(l.evidence[l.evidence.length - 1]?.event.publishedAt)}</span>
                <span>Last signal</span>
                <span className="text-right text-foreground">{timeAgo(l.lastSignalAt)}</span>
                <span>Last activity</span>
                <span className="text-right text-foreground">{timeAgo(l.lastActivityAt)}</span>
              </div>
              {can('leads:update') && (
                <Button variant="ghost" size="sm" onClick={() => rescore.mutate()} loading={rescore.isPending}>
                  <RefreshCw /> Re-score with AI
                </Button>
              )}
            </CardContent>
          </Card>

          <Contacts lead={l} canWrite={canMutate} onChanged={refresh} />

          {(l.suggestedPersonas.length > 0 || l.account.description) && (
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {l.account.description && <p className="text-muted-foreground">{l.account.description}</p>}
                {l.suggestedPersonas.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Who to approach</p>
                    <div className="flex flex-wrap gap-1.5">
                      {l.suggestedPersonas.map((p) => (
                        <Badge key={p} variant="secondary">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {outreach && <OutreachDialog leadId={l.id} channel={outreach} open onOpenChange={(o) => !o && setOutreach(null)} />}

      <Dialog open={!!stageDialog} onOpenChange={(o) => !o && setStageDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stageDialog === 'WON' ? 'Mark as won 🎉' : 'Mark as lost'}</DialogTitle>
            <DialogDescription>{stageDialog === 'WON' ? 'Record the deal value (optional).' : 'A reason is required — it feeds win/loss analysis.'}</DialogDescription>
          </DialogHeader>
          {stageDialog === 'WON' ? (
            <Field label="Deal value (INR)">
              <Input type="number" min={0} value={wonValue} onChange={(e) => setWonValue(e.target.value)} />
            </Field>
          ) : (
            <Field label="Lost reason">
              <Textarea rows={3} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Chose incumbent vendor" />
            </Field>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStageDialog(null)}>Cancel</Button>
            <Button
              variant={stageDialog === 'LOST' ? 'destructive' : 'default'}
              loading={update.isPending}
              disabled={stageDialog === 'LOST' && !lostReason.trim()}
              onClick={() =>
                update.mutate(stageDialog === 'WON' ? { stage: 'WON', wonValue: wonValue ? Number(wonValue) : undefined } : { stage: 'LOST', lostReason })
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
