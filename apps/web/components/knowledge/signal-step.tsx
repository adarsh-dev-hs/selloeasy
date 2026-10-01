'use client';
import { signalSchema, type Icp, type Signal } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, patch, post } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Chips, KQ, ListEditor, fieldErrors } from './shared';

type SignalForm = {
  name: string;
  description: string;
  matchInstructions: string;
  keywords: string[];
  negativeKeywords: string[];
  weight: number;
  icpId: string;
};
const emptySignal: SignalForm = { name: '', description: '', matchInstructions: '', keywords: [], negativeKeywords: [], weight: 1, icpId: '' };

export function CustomSignalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const icps = useQuery({ queryKey: KQ.icps, queryFn: () => get<Icp[]>('/icps'), enabled: open });
  const [f, setF] = React.useState<SignalForm>(emptySignal);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setF(emptySignal);
      setErrors({});
    }
  }, [open]);
  const set = (p: Partial<SignalForm>) => setF((x) => ({ ...x, ...p }));
  const create = useMutation({
    mutationFn: (body: unknown) => post<Signal>('/signals', body),
    onSuccess: (s) => {
      toast.success(`Signal “${s.name}” created`);
      void qc.invalidateQueries({ queryKey: KQ.signals });
      void qc.invalidateQueries({ queryKey: KQ.org });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Add a custom signal</DialogTitle>
          <DialogDescription>A signal is an observable market event that suggests a company may be ready to buy from you.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const r = signalSchema.safeParse({ ...f, icpId: f.icpId || null, isActive: true });
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            setErrors({});
            create.mutate(r.data);
          }}
        >
          <Field label="Name" error={errors.name}>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. New diagnostic lab chain expansion" autoFocus />
          </Field>
          <Field label="Description" error={errors.description}>
            <Textarea className="min-h-16" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why this event matters for your sales team" />
          </Field>
          <Field label="Match instructions" error={errors.matchInstructions} hint="Plain-language rules the AI uses to decide whether a news event matches. Say what should and should NOT match.">
            <Textarea
              className="min-h-24"
              value={f.matchInstructions}
              onChange={(e) => set({ matchInstructions: e.target.value })}
              placeholder="Match when a diagnostic lab chain announces new collection centres or a new state… Do NOT match single-clinic openings."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keywords" error={errors.keywords}>
              <ListEditor value={f.keywords} onChange={(v) => set({ keywords: v })} label="Keywords" placeholder="e.g. expansion, new centre" />
            </Field>
            <Field label="Negative keywords" error={errors.negativeKeywords}>
              <ListEditor value={f.negativeKeywords} onChange={(v) => set({ negativeKeywords: v })} label="Negative keywords" placeholder="e.g. closure, layoffs" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Weight · ${f.weight.toFixed(1)}×`} error={errors.weight} hint="How strongly this signal boosts a lead’s score (0.5–2)">
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={f.weight}
                onChange={(e) => set({ weight: Number(e.target.value) })}
                className="h-9 w-full cursor-pointer accent-[var(--color-primary)]"
                aria-label="Weight"
              />
            </Field>
            <Field label="Linked ICP (optional)" error={errors.icpId}>
              <NativeSelect value={f.icpId} onChange={(e) => set({ icpId: e.target.value })}>
                <option value="">Any ICP</option>
                {icps.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create signal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Compact signal list with activation toggles + custom signal creation (wizard step 8). */
export function SignalStep({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const signals = useQuery({ queryKey: KQ.signals, queryFn: () => get<Signal[]>('/signals') });
  const [custom, setCustom] = React.useState(false);

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => patch<Signal>(`/signals/${id}`, { isActive }),
    onMutate: async ({ id, isActive }) => {
      await qc.cancelQueries({ queryKey: KQ.signals });
      const prev = qc.getQueryData<Signal[]>(KQ.signals);
      qc.setQueryData<Signal[]>(KQ.signals, (d) => d?.map((s) => (s.id === id ? { ...s, isActive } : s)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KQ.signals, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KQ.signals });
      void qc.invalidateQueries({ queryKey: KQ.org });
    },
  });

  const all = signals.data ?? [];
  const active = all.filter((s) => s.isActive).length;
  const groups: [string, Signal[]][] = [
    ['Predefined for your industry', all.filter((s) => s.source === 'PREDEFINED')],
    ['Custom signals', all.filter((s) => s.source === 'CUSTOM')],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {signals.data ? (
            <>
              <span className="font-medium text-foreground">{active}</span> of {all.length} signals active
              {active === 0 && <span className="text-destructive"> — activate at least one to continue</span>}
            </>
          ) : (
            'Loading signals…'
          )}
        </p>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setCustom(true)}>
            <Plus /> Add custom signal
          </Button>
        )}
      </div>

      {signals.error ? (
        <ErrorState error={signals.error} retry={() => signals.refetch()} />
      ) : !signals.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No signals yet"
          description="Add a custom signal describing the market events that indicate buying intent."
          action={canWrite && <Button size="sm" onClick={() => setCustom(true)}><Plus /> Add custom signal</Button>}
        />
      ) : (
        groups
          .filter(([, xs]) => xs.length > 0)
          .map(([title, xs]) => (
            <section key={title} className="space-y-2" aria-label={title}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
              <ul className="divide-y rounded-xl border bg-card">
                {xs.map((s) => (
                  <li key={s.id} className={cn('flex items-start gap-3 p-3.5 transition-opacity', !s.isActive && 'opacity-70')}>
                    <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', s.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      <Radar className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{s.name}</p>
                        {s.weight !== 1 && <Badge variant="secondary">{s.weight.toFixed(1)}× weight</Badge>}
                      </div>
                      {s.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}
                      {s.keywords.length > 0 && <Chips items={s.keywords} max={5} className="mt-2" />}
                    </div>
                    <Switch
                      checked={s.isActive}
                      disabled={!canWrite}
                      label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}
                      onCheckedChange={(v) => toggle.mutate({ id: s.id, isActive: v })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
      <CustomSignalDialog open={custom} onOpenChange={setCustom} />
    </div>
  );
}
