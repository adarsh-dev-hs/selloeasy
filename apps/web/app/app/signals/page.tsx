'use client';
import type { Icp, Signal } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Pencil, Plus, Radar, RotateCcw, Sparkles, Target, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Chips, ChipsRow, Collapsible, ConfirmDialog } from '@/components/intelligence/shared';
import { SignalDialog } from '@/components/intelligence/signal-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { del, errorMessage, get, patch, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';

function SignalCard({
  signal,
  icpName,
  canWrite,
  onEdit,
  onDelete,
  onToggle,
  toggling,
}: {
  signal: Signal;
  icpName: string | null;
  canWrite: boolean;
  onEdit: () => void;
  onDelete?: () => void;
  onToggle: (v: boolean) => void;
  toggling: boolean;
}) {
  return (
    <article className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-opacity', !signal.isActive && 'opacity-65')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{signal.name}</h3>
          {signal.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{signal.description}</p>}
        </div>
        <Switch checked={signal.isActive} onCheckedChange={onToggle} disabled={!canWrite || toggling} label={`${signal.isActive ? 'Disable' : 'Enable'} ${signal.name}`} />
      </div>

      <Collapsible label="Match instructions (LLM)">
        <p className="whitespace-pre-line">{signal.matchInstructions}</p>
      </Collapsible>

      <ChipsRow label="Keywords">
        <Chips items={signal.keywords} max={10} />
      </ChipsRow>
      {signal.negativeKeywords.length > 0 && (
        <ChipsRow label="Exclude">
          <Chips items={signal.negativeKeywords} variant="negative" />
        </ChipsRow>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Tip content="Score multiplier applied when this signal matches">
            <Badge variant="secondary">{signal.weight.toFixed(1)}× weight</Badge>
          </Tip>
          {icpName && (
            <Badge variant="outline" className="max-w-48">
              <Target className="size-3" /> <span className="truncate">{icpName}</span>
            </Badge>
          )}
          <Link href={`/app/leads?signalId=${signal.id}`} className="rounded-full px-1.5 py-0.5 text-muted-foreground hover:text-primary">
            <span className="font-semibold text-foreground">{signal.leadCount ?? 0}</span> matches
          </Link>
        </div>
        {canWrite && (
          <div className="flex items-center gap-1">
            <Tip content="Edit">
              <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${signal.name}`}>
                <Pencil />
              </Button>
            </Tip>
            {onDelete && (
              <Tip content="Delete">
                <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${signal.name}`} className="text-destructive hover:text-destructive">
                  <Trash2 />
                </Button>
              </Tip>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Section({ title, description, count, action, children }: { title: string; description: string; count: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {title} <span className="text-sm font-normal text-muted-foreground">{count}</span>
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function SignalsPage() {
  const can = useCan();
  const canWrite = can('signals:write');
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ signal: Signal | null } | null>(null);
  const [deleting, setDeleting] = useState<Signal | null>(null);

  const signals = useQuery({ queryKey: ['signals'], queryFn: () => get<Signal[]>('/signals') });
  const icps = useQuery({ queryKey: ['icps'], queryFn: () => get<Icp[]>('/icps') });
  const icpName = useMemo(() => new Map((icps.data ?? []).map((i) => [i.id, i.name])), [icps.data]);

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => patch<Signal>(`/signals/${id}`, { isActive }),
    onSuccess: (s) => {
      toast.success(`${s.name} ${s.isActive ? 'enabled' : 'disabled'}`);
      void qc.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/signals/${id}`),
    onSuccess: () => {
      toast.success('Signal deleted');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: () => post<{ added: number }>('/signals/restore-templates'),
    onSuccess: (r) => {
      toast.success(r.added ? `Restored ${r.added} industry signal${r.added === 1 ? '' : 's'}` : 'All industry signals are already present');
      void qc.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const predefined = (signals.data ?? []).filter((s) => s.source === 'PREDEFINED');
  const custom = (signals.data ?? []).filter((s) => s.source === 'CUSTOM');
  const activeCount = (xs: Signal[]) => `${xs.filter((s) => s.isActive).length} of ${xs.length} active`;

  const card = (s: Signal) => (
    <SignalCard
      key={s.id}
      signal={s}
      icpName={s.icpId ? (icpName.get(s.icpId) ?? null) : null}
      canWrite={canWrite}
      onEdit={() => setEditing({ signal: s })}
      onDelete={s.source === 'CUSTOM' ? () => setDeleting(s) : undefined}
      onToggle={(v) => toggle.mutate({ id: s.id, isActive: v })}
      toggling={toggle.isPending && toggle.variables?.id === s.id}
    />
  );

  return (
    <>
      <PageHeader
        title="Signals"
        description="Observable market events that indicate buying intent. Active signals are matched against every pipeline run."
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ signal: null })}>
              <Plus /> New custom signal
            </Button>
          )
        }
      />

      <div className="mb-8 grid gap-3 rounded-xl border bg-muted/30 p-4 text-sm sm:grid-cols-2">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Filter className="size-4" />
          </span>
          <p>
            <span className="font-medium">Keywords → cheap prefilter.</span>{' '}
            <span className="text-muted-foreground">Before any AI call, events are filtered by your keywords (and negative keywords) plus industry tags and recency. Good keywords keep runs fast and cheap.</span>
          </p>
        </div>
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <p>
            <span className="font-medium">Match instructions → LLM judgement.</span>{' '}
            <span className="text-muted-foreground">Shortlisted events are read by the model, which decides using your match instructions and assigns a confidence. Weight scales the lead score.</span>
          </p>
        </div>
      </div>

      {signals.error ? (
        <ErrorState error={signals.error} retry={() => signals.refetch()} />
      ) : !signals.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <>
          <Section
            title="Industry signals"
            count={activeCount(predefined)}
            description="Predefined for your industry by the platform. Toggle them on or off and tune them — they can’t be deleted."
            action={
              canWrite && (
                <Button variant="outline" size="sm" loading={restore.isPending} onClick={() => restore.mutate()}>
                  <RotateCcw /> Restore missing templates
                </Button>
              )
            }
          >
            {predefined.length === 0 ? (
              <EmptyState icon={Radar} title="No industry signals" description="Restore the templates for your industry to get started." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{predefined.map(card)}</div>
            )}
          </Section>

          <Section title="Custom signals" count={activeCount(custom)} description="Signals your team defined for your specific market and offering.">
            {custom.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No custom signals yet"
                description="Add a signal for any event that tells you a company is ready to buy — e.g. “Fleet operator wins a large logistics contract”."
                action={
                  canWrite ? (
                    <Button onClick={() => setEditing({ signal: null })}>
                      <Plus /> New custom signal
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{custom.map(card)}</div>
            )}
          </Section>
        </>
      )}

      {editing && (
        <SignalDialog
          key={editing.signal?.id ?? 'new'}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          signal={editing.signal}
          icps={icps.data ?? []}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="The signal is removed from future pipeline runs. Existing leads keep their evidence. This cannot be undone."
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
