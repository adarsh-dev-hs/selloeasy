'use client';
import { planSchema, policySchema, productSchema, type Plan, type Policy, type Product, type Visibility } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, FileCheck2, Layers, Package, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, patch, post, del } from '@/lib/api';
import { cn, titleCase } from '@/lib/utils';
import { Chips, ConfirmDialog, KQ, ListEditor, VisibilityToggle, fieldErrors } from './shared';

type Kind = 'products' | 'plans' | 'policies';
type Row = { id: string; visibility: Visibility };

const KEY: Record<Kind, readonly string[]> = { products: KQ.products, plans: KQ.plans, policies: KQ.policies };

/** Generic list + CRUD mutations for /org/products|plans|policies. */
function useCatalog<T extends Row>(kind: Kind, label: string) {
  const qc = useQueryClient();
  const queryKey = KEY[kind];
  const list = useQuery({ queryKey, queryFn: () => get<T[]>(`/org/${kind}`) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: KQ.org });
  };
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) => (id ? patch<T>(`/org/${kind}/${id}`, body) : post<T>(`/org/${kind}`, body)),
    onSuccess: (_r, v) => {
      toast.success(v.id ? `${label} updated` : `${label} added`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setVisibility = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) => patch<T>(`/org/${kind}/${id}`, { visibility }),
    onMutate: async ({ id, visibility }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<T[]>(queryKey);
      qc.setQueryData<T[]>(queryKey, (d) => d?.map((x) => (x.id === id ? { ...x, visibility } : x)));
      return { prev };
    },
    onSuccess: (_r, v) => toast.success(`${label} is now ${v.visibility === 'PUBLIC' ? 'public' : 'internal'}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/org/${kind}/${id}`),
    onSuccess: () => {
      toast.success(`${label} deleted`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { list, save, setVisibility, remove };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared layout pieces
// ────────────────────────────────────────────────────────────────────────────

function SectionHead({ title, description, count, action }: { title: string; description?: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          {title}
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function ItemCard({
  icon: Icon,
  title,
  subtitle,
  visibility,
  canWrite,
  onVisibility,
  onEdit,
  onDelete,
  children,
}: {
  icon: typeof Package;
  title: string;
  subtitle?: React.ReactNode;
  visibility: Visibility;
  canWrite: boolean;
  onVisibility: (v: Visibility) => void;
  onEdit: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={title}>
            {title}
          </p>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {canWrite && (
          <div className="-mr-1 -mt-1 flex">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${title}`} onClick={onEdit}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${title}`} onClick={onDelete} className="hover:text-destructive">
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      {children && <div className="mt-3 flex-1 space-y-2 text-sm">{children}</div>}
      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <span className="text-xs text-muted-foreground">Visibility</span>
        <VisibilityToggle value={visibility} readOnly={!canWrite} onChange={onVisibility} label={`Visibility of ${title}`} />
      </div>
    </article>
  );
}

function ListBody<T extends Row>({
  q,
  empty,
  children,
  compact,
}: {
  q: ReturnType<typeof useCatalog<T>>['list'];
  empty: React.ReactNode;
  children: (rows: T[]) => React.ReactNode;
  compact?: boolean;
}) {
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3')}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  if (q.data.length === 0) return <>{empty}</>;
  return <div className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3')}>{children(q.data)}</div>;
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  loading,
  submitLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  loading?: boolean;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VisibilityField({ value, onChange, hint }: { value: Visibility; onChange: (v: Visibility) => void; hint: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">Visibility</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <VisibilityToggle value={value} onChange={onChange} size="md" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Products
// ────────────────────────────────────────────────────────────────────────────

type ProductForm = { name: string; category: string; description: string; targetSegments: string[]; priceNotes: string; visibility: Visibility };
const emptyProduct: ProductForm = { name: '', category: '', description: '', targetSegments: [], priceNotes: '', visibility: 'PUBLIC' };

export function ProductsManager({ canWrite, compact }: { canWrite: boolean; compact?: boolean }) {
  const { list, save, setVisibility, remove } = useCatalog<Product>('products', 'Product');
  const [edit, setEdit] = React.useState<{ id?: string; form: ProductForm } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<Product | null>(null);
  const open = (p?: Product) => {
    setErrors({});
    setEdit(
      p
        ? { id: p.id, form: { name: p.name, category: p.category ?? '', description: p.description ?? '', targetSegments: p.targetSegments, priceNotes: p.priceNotes ?? '', visibility: p.visibility } }
        : { form: emptyProduct },
    );
  };
  const f = edit?.form;
  const set = (patchForm: Partial<ProductForm>) => setEdit((e) => e && { ...e, form: { ...e.form, ...patchForm } });

  return (
    <section>
      <SectionHead
        title="Products"
        description="What you sell — used to match signals and ground outreach."
        count={list.data?.length}
        action={
          canWrite && (
            <Button size="sm" variant="outline" onClick={() => open()}>
              <Plus /> Add product
            </Button>
          )
        }
      />
      <ListBody
        q={list}
        compact={compact}
        empty={
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Add your main product lines with the segments they serve."
            action={canWrite && <Button size="sm" onClick={() => open()}><Plus /> Add product</Button>}
          />
        }
      >
        {(rows) =>
          rows.map((p) => (
            <ItemCard
              key={p.id}
              icon={Package}
              title={p.name}
              subtitle={p.category}
              visibility={p.visibility}
              canWrite={canWrite}
              onVisibility={(v) => setVisibility.mutate({ id: p.id, visibility: v })}
              onEdit={() => open(p)}
              onDelete={() => setConfirm(p)}
            >
              {p.description && <p className="line-clamp-3 text-muted-foreground">{p.description}</p>}
              {p.targetSegments.length > 0 && <Chips items={p.targetSegments} max={4} />}
              {p.priceNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Pricing:</span> {p.priceNotes}</p>}
            </ItemCard>
          ))
        }
      </ListBody>
      {f && (
        <FormDialog
          open={!!edit}
          onOpenChange={(o) => !o && setEdit(null)}
          title={edit?.id ? 'Edit product' : 'Add product'}
          submitLabel={edit?.id ? 'Save changes' : 'Add product'}
          loading={save.isPending}
          onSubmit={() => {
            const r = productSchema.safeParse({ ...f, category: f.category || undefined, description: f.description || undefined, priceNotes: f.priceNotes || undefined });
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            save.mutate({ id: edit?.id, body: r.data }, { onSuccess: () => setEdit(null) });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name}>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. QuickTest POC Kit" autoFocus />
            </Field>
            <Field label="Category" error={errors.category}>
              <Input value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Point-of-care diagnostics" />
            </Field>
          </div>
          <Field label="Description" error={errors.description}>
            <Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What it does and the problem it solves" />
          </Field>
          <Field label="Target segments" error={errors.targetSegments} hint="Press Enter or comma to add">
            <ListEditor value={f.targetSegments} onChange={(v) => set({ targetSegments: v })} placeholder="e.g. Tier-2 hospitals" label="Target segments" />
          </Field>
          <Field label="Pricing notes" error={errors.priceNotes}>
            <Input value={f.priceNotes} onChange={(e) => set({ priceNotes: e.target.value })} placeholder="e.g. Volume discounts above 1,000 units" />
          </Field>
          <VisibilityField value={f.visibility} onChange={(v) => set({ visibility: v })} hint="Products default to Public so admins can see your catalogue." />
        </FormDialog>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.name ?? ''}”?`}
        description="This product will no longer be used for matching or outreach."
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id, { onSuccess: () => setConfirm(null) })}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Plans
// ────────────────────────────────────────────────────────────────────────────

type PlanForm = { name: string; pricing: string; features: string[]; visibility: Visibility };
const emptyPlan: PlanForm = { name: '', pricing: '', features: [], visibility: 'INTERNAL' };

export function PlansManager({ canWrite, compact }: { canWrite: boolean; compact?: boolean }) {
  const { list, save, setVisibility, remove } = useCatalog<Plan>('plans', 'Plan');
  const [edit, setEdit] = React.useState<{ id?: string; form: PlanForm } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<Plan | null>(null);
  const open = (p?: Plan) => {
    setErrors({});
    setEdit(p ? { id: p.id, form: { name: p.name, pricing: p.pricing ?? '', features: p.features, visibility: p.visibility } } : { form: emptyPlan });
  };
  const f = edit?.form;
  const set = (patchForm: Partial<PlanForm>) => setEdit((e) => e && { ...e, form: { ...e.form, ...patchForm } });

  return (
    <section>
      <SectionHead
        title="Plans & pricing"
        description="Commercial packages, tiers or service plans."
        count={list.data?.length}
        action={
          canWrite && (
            <Button size="sm" variant="outline" onClick={() => open()}>
              <Plus /> Add plan
            </Button>
          )
        }
      />
      <ListBody
        q={list}
        compact={compact}
        empty={
          <EmptyState
            icon={Layers}
            title="No plans yet"
            description="Optional — add pricing tiers or service packages if you have them."
            action={canWrite && <Button size="sm" variant="outline" onClick={() => open()}><Plus /> Add plan</Button>}
          />
        }
      >
        {(rows) =>
          rows.map((p) => (
            <ItemCard
              key={p.id}
              icon={Layers}
              title={p.name}
              visibility={p.visibility}
              canWrite={canWrite}
              onVisibility={(v) => setVisibility.mutate({ id: p.id, visibility: v })}
              onEdit={() => open(p)}
              onDelete={() => setConfirm(p)}
            >
              {p.pricing && <p className="line-clamp-2 text-muted-foreground">{p.pricing}</p>}
              {p.features.length > 0 && (
                <ul className="space-y-1">
                  {p.features.slice(0, 4).map((x, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> {x}
                    </li>
                  ))}
                  {p.features.length > 4 && <li className="text-xs text-muted-foreground">+{p.features.length - 4} more</li>}
                </ul>
              )}
            </ItemCard>
          ))
        }
      </ListBody>
      {f && (
        <FormDialog
          open={!!edit}
          onOpenChange={(o) => !o && setEdit(null)}
          title={edit?.id ? 'Edit plan' : 'Add plan'}
          submitLabel={edit?.id ? 'Save changes' : 'Add plan'}
          loading={save.isPending}
          onSubmit={() => {
            const r = planSchema.safeParse({ ...f, pricing: f.pricing || undefined });
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            save.mutate({ id: edit?.id, body: r.data }, { onSuccess: () => setEdit(null) });
          }}
        >
          <Field label="Name" error={errors.name}>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Enterprise AMC" autoFocus />
          </Field>
          <Field label="Pricing" error={errors.pricing}>
            <Textarea value={f.pricing} onChange={(e) => set({ pricing: e.target.value })} placeholder="e.g. ₹4.5L per analyzer per year, billed annually" />
          </Field>
          <Field label="Features" error={errors.features}>
            <ListEditor variant="lines" value={f.features} onChange={(v) => set({ features: v })} placeholder="Add a feature and press Enter" label="Features" />
          </Field>
          <VisibilityField value={f.visibility} onChange={(v) => set({ visibility: v })} hint="Plans default to Internal — pricing stays inside your organization." />
        </FormDialog>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.name ?? ''}”?`}
        description="This plan will be removed from your knowledge base."
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id, { onSuccess: () => setConfirm(null) })}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Policies
// ────────────────────────────────────────────────────────────────────────────

export const POLICY_TYPES = ['general', 'warranty', 'compliance', 'sla', 'certification', 'returns', 'data_privacy'] as const;
const policyLabel = (t: string) => (t === 'sla' ? 'SLA' : titleCase(t));

type PolicyForm = { title: string; type: string; body: string; visibility: Visibility };
const emptyPolicy: PolicyForm = { title: '', type: 'general', body: '', visibility: 'INTERNAL' };

export function PoliciesManager({ canWrite, compact }: { canWrite: boolean; compact?: boolean }) {
  const { list, save, setVisibility, remove } = useCatalog<Policy>('policies', 'Policy');
  const [edit, setEdit] = React.useState<{ id?: string; form: PolicyForm } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<Policy | null>(null);
  const open = (p?: Policy) => {
    setErrors({});
    setEdit(p ? { id: p.id, form: { title: p.title, type: p.type, body: p.body, visibility: p.visibility } } : { form: emptyPolicy });
  };
  const f = edit?.form;
  const set = (patchForm: Partial<PolicyForm>) => setEdit((e) => e && { ...e, form: { ...e.form, ...patchForm } });
  const types = f && !POLICY_TYPES.includes(f.type as (typeof POLICY_TYPES)[number]) ? [...POLICY_TYPES, f.type] : POLICY_TYPES;

  return (
    <section>
      <SectionHead
        title="Policies"
        description="Warranty, compliance, SLAs and certifications — used to ground outreach claims."
        count={list.data?.length}
        action={
          canWrite && (
            <Button size="sm" variant="outline" onClick={() => open()}>
              <Plus /> Add policy
            </Button>
          )
        }
      />
      <ListBody
        q={list}
        compact={compact}
        empty={
          <EmptyState
            icon={ScrollText}
            title="No policies yet"
            description="Add warranty terms, SLAs or certifications so outreach never over-promises."
            action={canWrite && <Button size="sm" onClick={() => open()}><Plus /> Add policy</Button>}
          />
        }
      >
        {(rows) =>
          rows.map((p) => (
            <ItemCard
              key={p.id}
              icon={FileCheck2}
              title={p.title}
              subtitle={policyLabel(p.type)}
              visibility={p.visibility}
              canWrite={canWrite}
              onVisibility={(v) => setVisibility.mutate({ id: p.id, visibility: v })}
              onEdit={() => open(p)}
              onDelete={() => setConfirm(p)}
            >
              <p className="line-clamp-4 whitespace-pre-line text-muted-foreground">{p.body}</p>
            </ItemCard>
          ))
        }
      </ListBody>
      {f && (
        <FormDialog
          open={!!edit}
          onOpenChange={(o) => !o && setEdit(null)}
          title={edit?.id ? 'Edit policy' : 'Add policy'}
          submitLabel={edit?.id ? 'Save changes' : 'Add policy'}
          loading={save.isPending}
          onSubmit={() => {
            const r = policySchema.safeParse(f);
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            save.mutate({ id: edit?.id, body: r.data }, { onSuccess: () => setEdit(null) });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Field label="Title" error={errors.title}>
              <Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. 3-year analyzer warranty" autoFocus />
            </Field>
            <Field label="Type" error={errors.type}>
              <NativeSelect value={f.type} onChange={(e) => set({ type: e.target.value })}>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {policyLabel(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Policy text" error={errors.body} hint="Minimum 10 characters">
            <Textarea className="min-h-40" value={f.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
          <VisibilityField value={f.visibility} onChange={(v) => set({ visibility: v })} hint="Policies default to Internal." />
        </FormDialog>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.title ?? ''}”?`}
        description="This policy will no longer be used to ground outreach."
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id, { onSuccess: () => setConfirm(null) })}
      />
    </section>
  );
}
