'use client';
import { INDUSTRIES, INDUSTRY_LABELS, signalTemplateSchema, type Industry, type SignalTemplate } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Radar, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tip } from '@/components/ui/tooltip';
import { errorMessage, get, patch, post } from '@/lib/api';

type Form = { industry: Industry; key: string; name: string; description: string; matchInstructions: string; keywords: string; weight: string };
type Errors = Partial<Record<keyof Form, string>>;

const toForm = (t: SignalTemplate | null, industry: Industry): Form =>
  t
    ? {
        industry: t.industry,
        key: t.key,
        name: t.name,
        description: t.description,
        matchInstructions: t.matchInstructions,
        keywords: t.defaultKeywords.join(', '),
        weight: String(t.defaultWeight),
      }
    : { industry, key: '', name: '', description: '', matchInstructions: '', keywords: '', weight: '1' };

const snake = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

function TemplateDialog({
  template,
  defaultIndustry,
  open,
  onOpenChange,
}: {
  template: SignalTemplate | null;
  defaultIndustry: Industry;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const editing = !!template;
  const [form, setForm] = useState<Form>(() => toForm(template, defaultIndustry));
  const [keyTouched, setKeyTouched] = useState(editing);
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? patch<SignalTemplate>(`/platform/signal-templates/${template!.id}`, body) : post<SignalTemplate>('/platform/signal-templates', body)),
    onSuccess: (t) => {
      toast.success(editing ? `Updated “${t.name}”` : `Created “${t.name}”`);
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['platform', 'signal-templates'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'name' && !keyTouched) next.key = snake(v as string);
      return next;
    });
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      industry: form.industry,
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      matchInstructions: form.matchInstructions.trim(),
      defaultKeywords: form.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      defaultWeight: Number(form.weight),
    };
    const er: Errors = {};
    const parsed = signalTemplateSchema.safeParse(body);
    if (!parsed.success) {
      const map: Record<string, keyof Form> = { defaultKeywords: 'keywords', defaultWeight: 'weight' };
      for (const issue of parsed.error.issues) {
        const k = (map[String(issue.path[0])] ?? issue.path[0]) as keyof Form;
        er[k] ??=
          k === 'key'
            ? 'Use lowercase letters, digits and underscores only (snake_case)'
            : k === 'weight'
              ? 'Weight must be between 0.5 and 2.0'
              : k === 'name'
                ? 'Name must be 2–120 characters'
                : k === 'keywords'
                  ? 'Each keyword must be 1–200 characters (max 50)'
                  : issue.message;
      }
    }
    if (!body.description) er.description ??= 'Describe what this signal means';
    if (!body.matchInstructions) er.matchInstructions ??= 'Tell the model when to match (and when not to)';
    if (Object.values(er).some(Boolean) || !parsed.success) {
      setErrors(er);
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit signal template' : 'New signal template'}</DialogTitle>
            <DialogDescription>
              Templates are cloned into new organizations of the same industry at creation time. Editing a template does not change signals already cloned into existing orgs.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry" error={errors.industry}>
              <NativeSelect value={form.industry} onChange={(e) => set('industry', e.target.value as Industry)} aria-label="Industry">
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {INDUSTRY_LABELS[i]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Weight" error={errors.weight} hint="0.5 (weak) – 2.0 (strong). Default 1.0.">
              <Input
                type="number"
                min={0.5}
                max={2}
                step={0.1}
                inputMode="decimal"
                value={form.weight}
                onChange={(e) => set('weight', e.target.value)}
                aria-invalid={!!errors.weight}
              />
            </Field>
            <Field label="Name" error={errors.name}>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="New plant or facility" aria-invalid={!!errors.name} maxLength={120} autoFocus />
            </Field>
            <Field label="Key" error={errors.key} hint="snake_case, unique per industry">
              <Input
                value={form.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  set('key', e.target.value);
                }}
                placeholder="new_facility"
                className="font-mono"
                aria-invalid={!!errors.key}
                maxLength={80}
              />
            </Field>
          </div>
          <Field label="Description" error={errors.description}>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What this buying signal means for a seller in this industry."
              aria-invalid={!!errors.description}
              maxLength={1000}
            />
          </Field>
          <Field label="Match instructions" error={errors.matchInstructions} hint="Guidance given to the LLM classifier — include explicit exclusions.">
            <Textarea
              rows={5}
              value={form.matchInstructions}
              onChange={(e) => set('matchInstructions', e.target.value)}
              placeholder="Match when the event describes… Do NOT match…"
              aria-invalid={!!errors.matchInstructions}
              maxLength={2000}
            />
          </Field>
          <Field label="Keywords" error={errors.keywords} hint="Comma-separated, used for pre-filtering market events.">
            <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="new plant, greenfield, capacity expansion" aria-invalid={!!errors.keywords} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({ t, onEdit }: { t: SignalTemplate; onEdit: () => void }) {
  return (
    <article className="flex flex-col rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{t.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{t.key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tip content="Default weight applied when scoring">
            <Badge variant="outline" className="tabular-nums">
              <Scale className="size-3" aria-hidden /> ×{t.defaultWeight.toFixed(1)}
            </Badge>
          </Tip>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={onEdit}>
            <Pencil />
          </Button>
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{t.description}</p>
      {t.defaultKeywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {t.defaultKeywords.slice(0, 8).map((k) => (
            <Badge key={k} variant="secondary">
              {k}
            </Badge>
          ))}
          {t.defaultKeywords.length > 8 && <Badge variant="outline">+{t.defaultKeywords.length - 8} more</Badge>}
        </div>
      )}
    </article>
  );
}

export default function SignalTemplatesPage() {
  const [tab, setTab] = useState<Industry>(INDUSTRIES[0]);
  const [dialog, setDialog] = useState<{ template: SignalTemplate | null; key: number } | null>(null);
  const templates = useQuery({ queryKey: ['platform', 'signal-templates'], queryFn: () => get<SignalTemplate[]>('/platform/signal-templates') });

  const grouped = useMemo(() => {
    const m = new Map<Industry, SignalTemplate[]>(INDUSTRIES.map((i) => [i, []]));
    for (const t of templates.data ?? []) m.get(t.industry)?.push(t);
    return m;
  }, [templates.data]);

  return (
    <>
      <PageHeader
        title="Signal templates"
        description="Industry-specific buying signals. New organizations get a copy of their industry's templates, which their admins can then tune."
        actions={
          <Button onClick={() => setDialog({ template: null, key: Date.now() })}>
            <Plus /> New template
          </Button>
        }
      />

      {templates.error ? (
        <ErrorState error={templates.error} retry={() => templates.refetch()} />
      ) : !templates.data ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full max-w-2xl" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Industry)}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              {INDUSTRIES.map((i) => (
                <TabsTrigger key={i} value={i}>
                  {INDUSTRY_LABELS[i]}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">{grouped.get(i)?.length ?? 0}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {INDUSTRIES.map((i) => {
            const list = grouped.get(i) ?? [];
            return (
              <TabsContent key={i} value={i}>
                {list.length === 0 ? (
                  <EmptyState
                    icon={Radar}
                    title={`No ${INDUSTRY_LABELS[i]} templates`}
                    description="Add templates so new organizations in this industry start with useful signals."
                    action={
                      <Button onClick={() => setDialog({ template: null, key: Date.now() })}>
                        <Plus /> New template
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((t) => (
                      <TemplateCard key={t.id} t={t} onEdit={() => setDialog({ template: t, key: Date.now() })} />
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {dialog && (
        <TemplateDialog
          key={dialog.key}
          template={dialog.template}
          defaultIndustry={tab}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
    </>
  );
}
