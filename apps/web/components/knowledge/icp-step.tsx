'use client';
import { icpSchema, type Icp, type IcpCriteria } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Sparkles, Target, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { errorMessage, del, get, post } from '@/lib/api';
import { Chips, ConfirmDialog, KQ, ListEditor, fieldErrors } from './shared';

export type IcpSuggestion = { name: string; description: string; criteria: IcpCriteria };

function sizeLabel(c: IcpCriteria) {
  const { minEmployees: min, maxEmployees: max } = c.companySize ?? {};
  if (min && max) return `${min.toLocaleString()}–${max.toLocaleString()} employees`;
  if (min) return `${min.toLocaleString()}+ employees`;
  if (max) return `Up to ${max.toLocaleString()} employees`;
  return null;
}

function CriteriaSummary({ c }: { c: IcpCriteria }) {
  const size = sizeLabel(c);
  const rows: [string, string[]][] = [
    ['Industries', c.industries],
    ['Geographies', c.geographies],
    ['Personas', c.personas],
    ['Pain points', c.painPoints],
    ['Keywords', c.keywords],
  ];
  return (
    <dl className="grid gap-2 text-sm">
      {(size || c.revenueBand) && (
        <div className="flex flex-wrap gap-1.5">
          {size && <Badge variant="secondary">{size}</Badge>}
          {c.revenueBand && <Badge variant="secondary">Revenue {c.revenueBand}</Badge>}
        </div>
      )}
      {rows
        .filter(([, v]) => v.length > 0)
        .map(([k, v]) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:gap-2">
            <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">{k}</dt>
            <dd>
              <Chips items={v} max={6} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Custom ICP dialog
// ────────────────────────────────────────────────────────────────────────────

type IcpForm = {
  name: string;
  description: string;
  industries: string[];
  geographies: string[];
  personas: string[];
  painPoints: string[];
  keywords: string[];
  minEmployees: string;
  maxEmployees: string;
  revenueBand: string;
};
const emptyIcp: IcpForm = { name: '', description: '', industries: [], geographies: [], personas: [], painPoints: [], keywords: [], minEmployees: '', maxEmployees: '', revenueBand: '' };

export function CustomIcpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState<IcpForm>(emptyIcp);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setF(emptyIcp);
      setErrors({});
    }
  }, [open]);
  const set = (p: Partial<IcpForm>) => setF((x) => ({ ...x, ...p }));
  const create = useMutation({
    mutationFn: (body: unknown) => post<Icp>('/icps', body),
    onSuccess: (icp) => {
      toast.success(`ICP “${icp.name}” created`);
      void qc.invalidateQueries({ queryKey: KQ.icps });
      void qc.invalidateQueries({ queryKey: KQ.org });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Add a custom ICP</DialogTitle>
          <DialogDescription>Describe a type of company you want to sell to. Signals and scoring use these criteria to judge fit.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const r = icpSchema.safeParse({
              name: f.name,
              description: f.description,
              isActive: true,
              criteria: {
                industries: f.industries,
                geographies: f.geographies,
                personas: f.personas,
                painPoints: f.painPoints,
                keywords: f.keywords,
                revenueBand: f.revenueBand.trim() || undefined,
                companySize: { minEmployees: num(f.minEmployees), maxEmployees: num(f.maxEmployees) },
              },
            });
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            setErrors({});
            create.mutate(r.data);
          }}
        >
          <Field label="Name" error={errors.name}>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Multi-specialty hospital chains in South India" autoFocus />
          </Field>
          <Field label="Description" error={errors.description}>
            <Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why this segment buys from you" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industries">
              <ListEditor value={f.industries} onChange={(v) => set({ industries: v })} label="Industries" placeholder="e.g. Hospitals" />
            </Field>
            <Field label="Geographies">
              <ListEditor value={f.geographies} onChange={(v) => set({ geographies: v })} label="Geographies" placeholder="e.g. IN, Karnataka" />
            </Field>
            <Field label="Personas">
              <ListEditor value={f.personas} onChange={(v) => set({ personas: v })} label="Personas" placeholder="e.g. Head of Lab" />
            </Field>
            <Field label="Pain points">
              <ListEditor value={f.painPoints} onChange={(v) => set({ painPoints: v })} label="Pain points" placeholder="e.g. Slow turnaround" />
            </Field>
          </div>
          <Field label="Keywords" hint="Words likely to appear in news about these buyers">
            <ListEditor value={f.keywords} onChange={(v) => set({ keywords: v })} label="Keywords" placeholder="e.g. new wing, NABH" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Min employees" error={errors.criteria}>
              <Input type="number" min={0} inputMode="numeric" value={f.minEmployees} onChange={(e) => set({ minEmployees: e.target.value })} />
            </Field>
            <Field label="Max employees">
              <Input type="number" min={0} inputMode="numeric" value={f.maxEmployees} onChange={(e) => set({ maxEmployees: e.target.value })} />
            </Field>
            <Field label="Revenue band">
              <Input value={f.revenueBand} onChange={(e) => set({ revenueBand: e.target.value })} placeholder="e.g. >$50M" />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create ICP
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Wizard step: AI suggestions + accepted ICPs
// ────────────────────────────────────────────────────────────────────────────

export function IcpStep({ canWrite, hasProfile }: { canWrite: boolean; hasProfile: boolean }) {
  const qc = useQueryClient();
  const icps = useQuery({ queryKey: KQ.icps, queryFn: () => get<Icp[]>('/icps') });
  const [suggestions, setSuggestions] = React.useState<IcpSuggestion[] | null>(null);
  const [custom, setCustom] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Icp | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KQ.icps });
    void qc.invalidateQueries({ queryKey: KQ.org });
  };
  const suggest = useMutation({
    mutationFn: () => post<{ icps: IcpSuggestion[] }>('/icps/suggest'),
    onSuccess: (r) => {
      setSuggestions(r.icps);
      if (!r.icps.length) toast.info('No new suggestions — you already have ICPs covering these segments');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: (s: IcpSuggestion) => post<Icp>('/icps/accept', { ...s, isActive: true }),
    onSuccess: (icp, s) => {
      toast.success(`Accepted “${icp.name}”`);
      setSuggestions((xs) => xs?.filter((x) => x !== s) ?? null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/icps/${id}`),
    onSuccess: () => {
      toast.success('ICP removed');
      setConfirm(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => suggest.mutate()} loading={suggest.isPending} disabled={!hasProfile}>
            <Sparkles /> {suggestions ? 'Suggest again' : 'Suggest ICPs with AI'}
          </Button>
          <Button variant="outline" onClick={() => setCustom(true)}>
            <Plus /> Add custom ICP
          </Button>
          {!hasProfile && <p className="w-full text-xs text-muted-foreground">Generate your knowledge profile first — AI suggestions are based on it.</p>}
        </div>
      )}

      {suggest.isPending && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <section aria-label="AI suggestions" className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Suggestions to review
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {suggestions.map((s, i) => (
              <article key={`${s.name}-${i}`} className="flex flex-col rounded-xl border border-dashed border-primary/40 bg-primary/[0.03] p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{s.name}</p>
                  <Badge variant="default">AI</Badge>
                </div>
                {s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
                <div className="mt-3 flex-1">
                  <CriteriaSummary c={s.criteria} />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSuggestions((xs) => xs?.filter((x) => x !== s) ?? null)}>
                    <X /> Discard
                  </Button>
                  <Button size="sm" onClick={() => accept.mutate(s)} loading={accept.isPending && accept.variables === s}>
                    <Check /> Accept
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Your ICPs" className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Your ICPs {icps.data && <Badge variant="secondary">{icps.data.length}</Badge>}
        </h3>
        {icps.error ? (
          <ErrorState error={icps.error} retry={() => icps.refetch()} />
        ) : !icps.data ? (
          <Skeleton className="h-24" />
        ) : icps.data.length === 0 ? (
          <EmptyState icon={Target} title="No ICPs yet" description="Accept an AI suggestion or add your own. ICPs are optional for activation but sharpen lead scoring." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {icps.data.map((icp) => (
              <article key={icp.id} className="flex flex-col rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{icp.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant={icp.source === 'AI_SUGGESTED' ? 'default' : 'outline'}>{icp.source === 'AI_SUGGESTED' ? 'AI suggested' : 'Custom'}</Badge>
                      {!icp.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                  </div>
                  {canWrite && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${icp.name}`} className="hover:text-destructive" onClick={() => setConfirm(icp)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {icp.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{icp.description}</p>}
                <div className="mt-3">
                  <CriteriaSummary c={icp.criteria} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <CustomIcpDialog open={custom} onOpenChange={setCustom} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove “${confirm?.name ?? ''}”?`}
        description="This ICP will no longer be used for fit scoring of new leads."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id)}
      />
    </div>
  );
}
