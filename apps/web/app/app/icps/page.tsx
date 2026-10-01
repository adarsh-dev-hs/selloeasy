'use client';
import type { Icp, IcpCriteria } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Pencil, Plus, Sparkles, Target, Trash2, Wand2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { IcpDialog, type IcpDraft } from '@/components/intelligence/icp-dialog';
import { Chips, ChipsRow, ConfirmDialog } from '@/components/intelligence/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { del, errorMessage, get, patch, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatNumber } from '@/lib/utils';

function sizeLabel(c: IcpCriteria): string | null {
  const { minEmployees: min, maxEmployees: max } = c.companySize ?? {};
  if (min !== undefined && max !== undefined) return `${formatNumber(min)}–${formatNumber(max)} employees`;
  if (min !== undefined) return `${formatNumber(min)}+ employees`;
  if (max !== undefined) return `Up to ${formatNumber(max)} employees`;
  return null;
}

function CriteriaView({ c }: { c: IcpCriteria }) {
  const size = sizeLabel(c);
  return (
    <div className="grid gap-3">
      {(size || c.revenueBand) && (
        <div className="flex flex-wrap gap-1.5">
          {size && (
            <Badge variant="secondary">
              <Building2 className="size-3" /> {size}
            </Badge>
          )}
          {c.revenueBand && <Badge variant="secondary">Revenue {c.revenueBand}</Badge>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <ChipsRow label="Industries">
          <Chips items={c.industries} max={5} />
        </ChipsRow>
        <ChipsRow label="Geographies">
          <Chips items={c.geographies} max={5} variant="muted" />
        </ChipsRow>
      </div>
      <ChipsRow label="Personas">
        <Chips items={c.personas} max={6} variant="muted" />
      </ChipsRow>
      <ChipsRow label="Pain points">
        <Chips items={c.painPoints} max={6} variant="muted" />
      </ChipsRow>
      {c.keywords.length > 0 && (
        <ChipsRow label="Keywords">
          <Chips items={c.keywords} max={8} />
        </ChipsRow>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: Icp['source'] }) {
  return source === 'AI_SUGGESTED' ? (
    <Badge>
      <Sparkles className="size-3" /> AI suggested
    </Badge>
  ) : (
    <Badge variant="outline">Custom</Badge>
  );
}

export default function IcpsPage() {
  const can = useCan();
  const canWrite = can('icps:write');
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit' | 'accept'; icp?: Icp; draft?: IcpDraft; draftIndex?: number } | null>(null);
  const [deleting, setDeleting] = useState<Icp | null>(null);
  const [proposals, setProposals] = useState<IcpDraft[] | null>(null);

  const icps = useQuery({ queryKey: ['icps'], queryFn: () => get<Icp[]>('/icps') });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => patch<Icp>(`/icps/${id}`, { isActive }),
    onSuccess: (i) => {
      toast.success(`${i.name} ${i.isActive ? 'activated' : 'deactivated'}`);
      void qc.invalidateQueries({ queryKey: ['icps'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/icps/${id}`),
    onSuccess: () => {
      toast.success('ICP deleted');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['icps'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const suggest = useMutation({
    mutationFn: () => post<{ icps: IcpDraft[] }>('/icps/suggest'),
    onSuccess: (r) => {
      setProposals(r.icps);
      toast.success(r.icps.length ? `${r.icps.length} ICP suggestion${r.icps.length === 1 ? '' : 's'} ready to review` : 'No new ICPs to suggest — your existing ones already cover the profile');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: ({ draft }: { draft: IcpDraft; index: number }) => post<Icp>('/icps/accept', { ...draft, isActive: true }),
    onSuccess: (i, v) => {
      toast.success(`Saved “${i.name}”`);
      dropProposal(v.index);
      void qc.invalidateQueries({ queryKey: ['icps'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const dropProposal = (index: number) => setProposals((p) => (p ? p.filter((_, i) => i !== index) : p));

  return (
    <>
      <PageHeader
        title="Ideal customer profiles"
        description="Who you sell to. ICPs drive the fit part of every lead score and which personas we suggest you approach."
        actions={
          canWrite && (
            <>
              <Button variant="outline" loading={suggest.isPending} onClick={() => suggest.mutate()}>
                <Wand2 /> Suggest with AI
              </Button>
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Plus /> New ICP
              </Button>
            </>
          )
        }
      />

      {suggest.isPending && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
          Reading your knowledge profile and products to propose ICPs…
        </div>
      )}

      {proposals && proposals.length > 0 && (
        <section className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5" aria-label="AI suggestions">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-primary" /> AI suggestions
              </h2>
              <p className="text-sm text-muted-foreground">Proposed from your knowledge profile. Accept as-is, review and tweak, or discard.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setProposals(null)}>
              Dismiss all
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {proposals.map((p, idx) => (
              <article key={`${p.name}-${idx}`} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <CriteriaView c={p.criteria} />
                <div className="mt-auto flex flex-wrap justify-end gap-2 border-t pt-3">
                  <Button variant="ghost" size="sm" onClick={() => dropProposal(idx)}>
                    <X /> Discard
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDialog({ mode: 'accept', draft: p, draftIndex: idx })}>
                    <Pencil /> Review & edit
                  </Button>
                  <Button size="sm" loading={accept.isPending && accept.variables?.index === idx} onClick={() => accept.mutate({ draft: p, index: idx })}>
                    <Check /> Accept
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {icps.error ? (
        <ErrorState error={icps.error} retry={() => icps.refetch()} />
      ) : !icps.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : icps.data.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No ICPs yet"
          description="Let AI propose ICPs from your knowledge profile, or define one yourself."
          action={
            canWrite ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" loading={suggest.isPending} onClick={() => suggest.mutate()}>
                  <Wand2 /> Suggest with AI
                </Button>
                <Button onClick={() => setDialog({ mode: 'create' })}>
                  <Plus /> New ICP
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {icps.data.map((i) => (
            <article key={i.id} className={cn('flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs transition-opacity', !i.isActive && 'opacity-65')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <SourceBadge source={i.source} />
                    {!i.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <h3 className="font-semibold leading-snug">{i.name}</h3>
                  {i.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{i.description}</p>}
                </div>
                <Switch
                  checked={i.isActive}
                  onCheckedChange={(v) => toggle.mutate({ id: i.id, isActive: v })}
                  disabled={!canWrite || (toggle.isPending && toggle.variables?.id === i.id)}
                  label={`${i.isActive ? 'Deactivate' : 'Activate'} ${i.name}`}
                />
              </div>
              <CriteriaView c={i.criteria} />
              <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                <Link href="/app/leads" className="text-sm text-muted-foreground hover:text-primary">
                  <span className="font-semibold text-foreground">{i.leadCount ?? 0}</span> leads
                </Link>
                {canWrite && (
                  <div className="flex items-center gap-1">
                    <Tip content="Edit">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${i.name}`} onClick={() => setDialog({ mode: 'edit', icp: i })}>
                        <Pencil />
                      </Button>
                    </Tip>
                    <Tip content="Delete">
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${i.name}`} className="text-destructive hover:text-destructive" onClick={() => setDeleting(i)}>
                        <Trash2 />
                      </Button>
                    </Tip>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog && (
        <IcpDialog
          key={dialog.icp?.id ?? `${dialog.mode}-${dialog.draftIndex ?? ''}`}
          open
          mode={dialog.mode}
          icp={dialog.icp}
          draft={dialog.draft}
          onOpenChange={(o) => !o && setDialog(null)}
          onAccepted={dialog.mode === 'accept' && dialog.draftIndex !== undefined ? () => dropProposal(dialog.draftIndex!) : undefined}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.leadCount
            ? `${deleting.leadCount} lead${deleting.leadCount === 1 ? ' is' : 's are'} linked to this ICP and will lose the link. Consider deactivating instead.`
            : 'This ICP will no longer be used for fit scoring. This cannot be undone.'
        }
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
