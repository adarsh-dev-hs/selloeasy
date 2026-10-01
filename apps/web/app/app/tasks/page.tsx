'use client';
import type { Task } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarX2, CheckCircle2, Clock, ListChecks, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/intelligence/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tip } from '@/components/ui/tooltip';
import { del, errorMessage, get, patch } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

type Scope = 'mine' | 'all';
type Status = 'open' | 'done' | 'all';
type GroupKey = 'overdue' | 'today' | 'upcoming' | 'none' | 'done';

const GROUPS: { key: GroupKey; label: string; icon: typeof Clock; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', icon: CalendarX2, tone: 'text-destructive' },
  { key: 'today', label: 'Today', icon: Clock, tone: 'text-primary' },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock, tone: 'text-muted-foreground' },
  { key: 'none', label: 'No date', icon: ListChecks, tone: 'text-muted-foreground' },
  { key: 'done', label: 'Completed', icon: CheckCircle2, tone: 'text-success' },
];

function groupOf(t: Task, now: Date): GroupKey {
  if (t.completedAt) return 'done';
  if (!t.dueAt) return 'none';
  const due = new Date(t.dueAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
  if (due < startOfToday) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  return 'upcoming';
}

function useTaskFilters(): [{ scope: Scope; status: Status }, (p: Partial<{ scope: Scope; status: Status }>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = { scope: (sp.get('scope') === 'all' ? 'all' : 'mine') as Scope, status: (['done', 'all'].includes(sp.get('status') ?? '') ? sp.get('status') : 'open') as Status };
  const set = (p: Partial<typeof f>) => {
    const n = { ...f, ...p };
    const params = new URLSearchParams();
    if (n.scope !== 'mine') params.set('scope', n.scope);
    if (n.status !== 'open') params.set('status', n.status);
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };
  return [f, set];
}

function TasksPage() {
  const me = useMe();
  const can = useCan();
  const isManager = can('leads:assign');
  const qc = useQueryClient();
  const [f, setF] = useTaskFilters();
  const scope: Scope = isManager ? f.scope : 'mine';
  const [deleting, setDeleting] = useState<Task | null>(null);

  const tasks = useQuery({ queryKey: ['tasks', scope, f.status], queryFn: () => get<Task[]>('/tasks', { scope, status: f.status }) });

  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => patch<Task>(`/tasks/${id}`, { completed }),
    onSuccess: (_t, v) => {
      toast.success(v.completed ? 'Task completed' : 'Task reopened');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tasks/${id}`),
    onSuccess: () => {
      toast.success('Task deleted');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const now = new Date();
  const grouped = new Map<GroupKey, Task[]>();
  for (const t of tasks.data ?? []) {
    const g = groupOf(t, now);
    grouped.set(g, [...(grouped.get(g) ?? []), t]);
  }
  const overdue = grouped.get('overdue')?.length ?? 0;
  const canEdit = (t: Task) => isManager || t.assignee?.id === me.user.id;
  // The API only lets the creator (or a manager) delete a task.
  const canDelete = (t: Task) => isManager || t.createdBy === me.user.id;

  return (
    <>
      <PageHeader
        title={scope === 'all' ? 'All tasks' : 'My tasks'}
        description="Follow-ups on your leads, by due date."
        actions={
          overdue > 0 ? (
            <Badge variant="destructive" className="text-sm">
              {overdue} overdue
            </Badge>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        {isManager && (
          <Tabs value={scope} onValueChange={(v) => setF({ scope: v as Scope })}>
            <TabsList aria-label="Whose tasks">
              <TabsTrigger value="mine">My tasks</TabsTrigger>
              <TabsTrigger value="all">Everyone</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Tabs value={f.status} onValueChange={(v) => setF({ status: v as Status })}>
          <TabsList aria-label="Task status">
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tasks.error ? (
        <ErrorState error={tasks.error} retry={() => tasks.refetch()} />
      ) : !tasks.data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : tasks.data.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={f.status === 'done' ? 'No completed tasks' : f.status === 'open' ? 'You’re all caught up' : 'No tasks yet'}
          description="Create follow-up tasks from a lead’s page — they’ll show up here by due date."
          action={
            <Button variant="outline" asChild>
              <Link href="/app/leads">Go to leads</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {GROUPS.filter((g) => grouped.get(g.key)?.length).map((g) => (
            <section key={g.key} aria-labelledby={`grp-${g.key}`}>
              <h2 id={`grp-${g.key}`} className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', g.tone)}>
                <g.icon className="size-4" /> {g.label}
                <span className="font-normal text-muted-foreground">{grouped.get(g.key)!.length}</span>
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {grouped.get(g.key)!.map((t) => {
                  const done = !!t.completedAt;
                  const pending = complete.isPending && complete.variables?.id === t.id;
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                        checked={done}
                        disabled={!canEdit(t) || pending}
                        onChange={(e) => complete.mutate({ id: t.id, completed: e.target.checked })}
                        aria-label={`${done ? 'Reopen' : 'Complete'} “${t.title}”`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>{t.title}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <Link href={`/app/leads/${t.leadId}`} className="font-medium text-primary hover:underline">
                            {t.lead?.accountName ?? 'Open lead'}
                          </Link>
                          {t.dueAt && (
                            <span className={cn(g.key === 'overdue' && 'text-destructive')}>
                              · due {g.key === 'today' ? formatDateTime(t.dueAt) : formatDate(t.dueAt)}
                            </span>
                          )}
                          {done && <span>· done {formatDate(t.completedAt)}</span>}
                        </p>
                      </div>
                      {scope === 'all' && t.assignee && (
                        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                          <Avatar name={t.assignee.name} className="size-6 text-[10px]" /> {t.assignee.name}
                        </span>
                      )}
                      {canDelete(t) && (
                        <Tip content="Delete task">
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(t)} aria-label={`Delete “${t.title}”`}>
                            <Trash2 />
                          </Button>
                        </Tip>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={deleting ? `“${deleting.title}” will be removed permanently.` : undefined}
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
