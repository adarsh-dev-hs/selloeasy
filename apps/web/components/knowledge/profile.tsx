'use client';
import { orgProfileSchema, type OrgProfile, type OrgProfileContent, type Visibility } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Building2, CheckCircle2, Globe2, Pencil, Plus, RefreshCw, Sparkles, Target, Trash2, UserRound, Zap } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, patch, post } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { Chips, ConfirmDialog, KQ, ListEditor, VisibilityToggle, fieldErrors } from './shared';

type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'waiting-children' | 'prioritized' | 'unknown';
type JobStatus = { id: string; state: JobState; failedReason: string | null };

const JOB_STORAGE = 'selloeasy:profile-job';
function readJob(): string | null {
  try {
    return sessionStorage.getItem(JOB_STORAGE);
  } catch {
    return null;
  }
}
function writeJob(id: string | null) {
  try {
    if (id) sessionStorage.setItem(JOB_STORAGE, id);
    else sessionStorage.removeItem(JOB_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

export function useProfile() {
  return useQuery({ queryKey: KQ.profile, queryFn: () => get<OrgProfile | null>('/org/profile') });
}

/** Queue profile generation and poll the job until it settles (resumes across navigation within the tab). */
export function useProfileGeneration() {
  const qc = useQueryClient();
  const [jobId, setJobId] = React.useState<string | null>(null);
  React.useEffect(() => setJobId(readJob()), []);

  const start = useMutation({
    mutationFn: () => post<{ jobId: string }>('/org/profile/generate'),
    onSuccess: (r) => {
      writeJob(r.jobId);
      setJobId(r.jobId);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const job = useQuery({
    queryKey: ['org-profile-job', jobId],
    queryFn: () => get<JobStatus>(`/org/profile/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ['completed', 'failed'].includes(q.state.data.state) ? false : 1500),
    retry: false,
  });

  const state = job.data?.state;
  React.useEffect(() => {
    if (!jobId) return;
    if (state === 'completed') {
      toast.success('Knowledge profile generated');
      void qc.invalidateQueries({ queryKey: KQ.profile });
      void qc.invalidateQueries({ queryKey: KQ.org });
      writeJob(null);
      setJobId(null);
    } else if (state === 'failed') {
      toast.error(job.data?.failedReason ? `Profile generation failed: ${job.data.failedReason}` : 'Profile generation failed');
      writeJob(null);
      setJobId(null);
    } else if (job.error) {
      writeJob(null);
      setJobId(null);
    }
  }, [state, jobId, job.error, job.data?.failedReason, qc]);

  const running = start.isPending || (!!jobId && state !== 'completed' && state !== 'failed');
  const label = start.isPending ? 'Queuing…' : state === 'active' ? 'Reading your sources and drafting the profile…' : 'Queued — waiting for a worker…';
  return { start: () => start.mutate(), running, label };
}

function GenerationProgress({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 animate-pulse text-primary" /> Generating profile
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15">
        <div className="h-full w-1/3 animate-[kprogress_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <style>{`@keyframes kprogress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Read-only view
// ────────────────────────────────────────────────────────────────────────────

function Bullets({ items, icon: Icon }: { items: string[]; icon: typeof CheckCircle2 }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((x, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" /> <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProfileView({ profile }: { profile: OrgProfile }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line text-sm leading-relaxed">{profile.summary || <span className="text-muted-foreground">No summary.</span>}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Value propositions</CardTitle>
        </CardHeader>
        <CardContent>
          <Bullets items={profile.valueProps} icon={CheckCircle2} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Differentiators</CardTitle>
        </CardHeader>
        <CardContent>
          <Bullets items={profile.differentiators} icon={Zap} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" /> Target industries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Chips items={profile.targetIndustries} max={20} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="size-4 text-muted-foreground" /> Geographies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Chips items={profile.geographies} max={30} />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" /> Buyer personas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.personas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No personas yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {profile.personas.map((p, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium">{p.title}</p>
                  {p.goals.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Goals</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                        {p.goals.map((g, j) => (
                          <li key={j}>{g}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {p.painPoints.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pain points</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                        {p.painPoints.map((g, j) => (
                          <li key={j}>{g}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editor
// ────────────────────────────────────────────────────────────────────────────

export function ProfileEditor({ profile, onDone }: { profile: OrgProfile; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<OrgProfileContent>(() => ({
    summary: profile.summary,
    valueProps: profile.valueProps,
    differentiators: profile.differentiators,
    targetIndustries: profile.targetIndustries,
    geographies: profile.geographies,
    personas: profile.personas.map((p) => ({ title: p.title, goals: [...p.goals], painPoints: [...p.painPoints] })),
  }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (p: Partial<OrgProfileContent>) => setForm((f) => ({ ...f, ...p }));
  const setPersona = (i: number, p: Partial<OrgProfileContent['personas'][number]>) =>
    set({ personas: form.personas.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const save = useMutation({
    mutationFn: (body: OrgProfileContent) => patch<OrgProfile>('/org/profile', body),
    onSuccess: (p) => {
      qc.setQueryData(KQ.profile, p);
      toast.success(`Profile saved (v${p.version})`);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const cleaned = { ...form, personas: form.personas.filter((p) => p.title.trim()) };
        const r = orgProfileSchema.safeParse(cleaned);
        if (!r.success) return setErrors(fieldErrors(r.error.issues));
        setErrors({});
        save.mutate(r.data);
      }}
    >
      <Field label="Summary" error={errors.summary} hint={`${form.summary.length}/4000`}>
        <Textarea className="min-h-32" value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
      </Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="Value propositions" error={errors.valueProps}>
          <ListEditor variant="lines" value={form.valueProps} onChange={(v) => set({ valueProps: v })} max={15} label="Value propositions" placeholder="Add a value proposition" />
        </Field>
        <Field label="Differentiators" error={errors.differentiators}>
          <ListEditor variant="lines" value={form.differentiators} onChange={(v) => set({ differentiators: v })} max={15} label="Differentiators" placeholder="Add a differentiator" />
        </Field>
        <Field label="Target industries" error={errors.targetIndustries}>
          <ListEditor value={form.targetIndustries} onChange={(v) => set({ targetIndustries: v })} max={20} label="Target industries" placeholder="e.g. Hospitals" />
        </Field>
        <Field label="Geographies" error={errors.geographies}>
          <ListEditor value={form.geographies} onChange={(v) => set({ geographies: v })} max={30} label="Geographies" placeholder="e.g. India, GCC" />
        </Field>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Buyer personas</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={form.personas.length >= 10}
            onClick={() => set({ personas: [...form.personas, { title: '', goals: [], painPoints: [] }] })}
          >
            <Plus /> Add persona
          </Button>
        </div>
        {errors.personas && <p className="text-xs text-destructive">{errors.personas}</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {form.personas.map((p, i) => (
            <div key={i} className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Input value={p.title} onChange={(e) => setPersona(i, { title: e.target.value })} placeholder="Persona title, e.g. Head of Procurement" aria-label={`Persona ${i + 1} title`} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove persona ${i + 1}`} onClick={() => set({ personas: form.personas.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
              <Field label="Goals">
                <ListEditor value={p.goals} onChange={(v) => setPersona(i, { goals: v })} max={10} label="Goals" placeholder="Add a goal" />
              </Field>
              <Field label="Pain points">
                <ListEditor value={p.painPoints} onChange={(v) => setPersona(i, { painPoints: v })} max={10} label="Pain points" placeholder="Add a pain point" />
              </Field>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Panel: empty → generating → view/edit, with meta + regenerate
// ────────────────────────────────────────────────────────────────────────────

export function ProfilePanel({ canWrite, readySources }: { canWrite: boolean; readySources?: number }) {
  const qc = useQueryClient();
  const profile = useProfile();
  const gen = useProfileGeneration();
  const [editing, setEditing] = React.useState(false);
  const [confirmRegen, setConfirmRegen] = React.useState(false);

  const summaryVisibility = useMutation({
    mutationFn: (v: Visibility) => patch<OrgProfile>('/org/profile', { summaryVisibility: v }),
    onSuccess: (p) => {
      qc.setQueryData(KQ.profile, p);
      toast.success(`Summary is now ${p.summaryVisibility === 'PUBLIC' ? 'public' : 'internal'}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (profile.error) return <ErrorState error={profile.error} retry={() => profile.refetch()} />;
  if (profile.isPending)
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );

  const p = profile.data;
  const noSources = readySources !== undefined && readySources === 0;

  if (!p)
    return gen.running ? (
      <GenerationProgress label={gen.label} />
    ) : (
      <EmptyState
        icon={Bot}
        title="No knowledge profile yet"
        description={
          noSources
            ? 'Add at least one source (website, document or text) and wait until it is Ready — then generate your profile.'
            : 'The AI reads every ready source plus your products and policies, then drafts a summary, value props, differentiators, target industries and personas. You can edit everything afterwards.'
        }
        action={
          canWrite && (
            <Button onClick={gen.start} disabled={noSources}>
              <Sparkles /> Generate profile
            </Button>
          )
        }
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Badge variant="default">
            <Target className="size-3" /> Version {p.version}
          </Badge>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Bot className="size-4" /> {p.generatedByModel ?? 'Edited manually'}
          </span>
          <span className="text-muted-foreground" title={formatDateTime(p.updatedAt)}>
            Updated {timeAgo(p.updatedAt)}
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            Summary
            <VisibilityToggle
              value={p.summaryVisibility}
              readOnly={!canWrite}
              disabled={summaryVisibility.isPending}
              label="Summary visibility"
              onChange={(v) => summaryVisibility.mutate(v)}
            />
          </span>
        </div>
        {canWrite && !editing && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRegen(true)} disabled={gen.running}>
              <RefreshCw /> Regenerate
            </Button>
            <Button size="sm" onClick={() => setEditing(true)} disabled={gen.running}>
              <Pencil /> Edit
            </Button>
          </div>
        )}
      </div>
      {gen.running && <GenerationProgress label={gen.label} />}
      {editing ? <ProfileEditor key={p.version} profile={p} onDone={() => setEditing(false)} /> : <ProfileView profile={p} />}
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Regenerate the knowledge profile?"
        description="The AI will re-read all ready sources and replace the current profile, including any manual edits."
        confirmLabel="Regenerate"
        destructive={false}
        onConfirm={() => {
          setConfirmRegen(false);
          gen.start();
        }}
      />
    </div>
  );
}
