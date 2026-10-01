'use client';
import type { Icp, IcpCriteria } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/input';
import { errorMessage, patch, post } from '@/lib/api';
import { formatList, parseList } from './shared';

export type IcpDraft = { name: string; description: string; criteria: IcpCriteria };

type Form = {
  name: string;
  description: string;
  industries: string;
  geographies: string;
  personas: string;
  painPoints: string;
  keywords: string;
  minEmployees: string;
  maxEmployees: string;
  revenueBand: string;
  isActive: boolean;
};

const toForm = (i: (IcpDraft & { isActive?: boolean }) | null): Form => ({
  name: i?.name ?? '',
  description: i?.description ?? '',
  industries: formatList(i?.criteria.industries),
  geographies: formatList(i?.criteria.geographies),
  personas: formatList(i?.criteria.personas),
  painPoints: formatList(i?.criteria.painPoints),
  keywords: formatList(i?.criteria.keywords),
  minEmployees: i?.criteria.companySize?.minEmployees?.toString() ?? '',
  maxEmployees: i?.criteria.companySize?.maxEmployees?.toString() ?? '',
  revenueBand: i?.criteria.revenueBand ?? '',
  isActive: i?.isActive ?? true,
});

const toCriteria = (f: Form): IcpCriteria => ({
  industries: parseList(f.industries),
  geographies: parseList(f.geographies),
  personas: parseList(f.personas),
  painPoints: parseList(f.painPoints),
  keywords: parseList(f.keywords),
  companySize: {
    ...(f.minEmployees ? { minEmployees: Number(f.minEmployees) } : {}),
    ...(f.maxEmployees ? { maxEmployees: Number(f.maxEmployees) } : {}),
  },
  ...(f.revenueBand.trim() ? { revenueBand: f.revenueBand.trim() } : {}),
});

/**
 * Create / edit an ICP, or review an AI proposal before accepting it (`mode="accept"`).
 */
export function IcpDialog({
  open,
  onOpenChange,
  icp,
  draft,
  mode,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  icp?: Icp | null;
  draft?: IcpDraft | null;
  mode: 'create' | 'edit' | 'accept';
  onAccepted?: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => toForm(icp ?? draft ?? null));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), description: f.description.trim(), criteria: toCriteria(f), isActive: f.isActive };
      if (mode === 'edit' && icp) return patch<Icp>(`/icps/${icp.id}`, body);
      return post<Icp>(mode === 'accept' ? '/icps/accept' : '/icps', body);
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? 'ICP updated' : mode === 'accept' ? 'Suggested ICP saved' : 'ICP created');
      void qc.invalidateQueries({ queryKey: ['icps'] });
      onAccepted?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.name.trim().length < 2) errs.name = 'At least 2 characters';
    const min = f.minEmployees ? Number(f.minEmployees) : undefined;
    const max = f.maxEmployees ? Number(f.maxEmployees) : undefined;
    if (min !== undefined && (!Number.isInteger(min) || min < 0)) errs.minEmployees = 'Whole number ≥ 0';
    if (max !== undefined && (!Number.isInteger(max) || max < 0)) errs.maxEmployees = 'Whole number ≥ 0';
    if (min !== undefined && max !== undefined && max < min) errs.maxEmployees = 'Must be ≥ minimum';
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  };

  const title = mode === 'edit' ? `Edit “${icp?.name ?? ''}”` : mode === 'accept' ? 'Review suggested ICP' : 'New ideal customer profile';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            ICPs describe who you sell to. The pipeline uses them to judge fit and to target personas. Lists are comma-separated.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Name" error={errors.name}>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Indian passenger-vehicle OEMs" maxLength={160} autoFocus />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} placeholder="Who they are and why they buy from you" />
          </Field>
          <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Criteria</legend>
            <Field label="Industries">
              <Input value={f.industries} onChange={(e) => set('industries', e.target.value)} placeholder="Automotive OEM, Electric Vehicles" />
            </Field>
            <Field label="Geographies">
              <Input value={f.geographies} onChange={(e) => set('geographies', e.target.value)} placeholder="India, Southeast Asia" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min employees" error={errors.minEmployees}>
                <Input type="number" min={0} inputMode="numeric" value={f.minEmployees} onChange={(e) => set('minEmployees', e.target.value)} placeholder="1000" />
              </Field>
              <Field label="Max employees" error={errors.maxEmployees}>
                <Input type="number" min={0} inputMode="numeric" value={f.maxEmployees} onChange={(e) => set('maxEmployees', e.target.value)} placeholder="Any" />
              </Field>
            </div>
            <Field label="Revenue band">
              <Input value={f.revenueBand} onChange={(e) => set('revenueBand', e.target.value)} placeholder="> $500M" maxLength={80} />
            </Field>
            <Field label="Personas to approach" className="sm:col-span-2">
              <Input value={f.personas} onChange={(e) => set('personas', e.target.value)} placeholder="VP Procurement, Head of Vehicle Platform" />
            </Field>
            <Field label="Pain points" className="sm:col-span-2">
              <Input value={f.painPoints} onChange={(e) => set('painPoints', e.target.value)} placeholder="tyre cost per km, EV-specific tyres, localization" />
            </Field>
            <Field label="Keywords" className="sm:col-span-2">
              <Input value={f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="OEM, vehicle launch, new plant" />
            </Field>
          </fieldset>
          {mode !== 'accept' && (
            <div className="flex items-center gap-3">
              <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} label="Active" />
              <span className="text-sm">{f.isActive ? 'Active — used for fit scoring' : 'Inactive'}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {mode === 'edit' ? 'Save changes' : mode === 'accept' ? 'Accept ICP' : 'Create ICP'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
