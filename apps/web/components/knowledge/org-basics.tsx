'use client';
import { updateOrgSchema, type OrgDetail } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { errorMessage, patch } from '@/lib/api';
import { KQ, ListEditor, fieldErrors } from './shared';

export const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '501–1,000', '1,001–5,000', '5,001–10,000', '10,000+'] as const;

type BasicsForm = { name: string; description: string; hq: string; regions: string[]; companySize: string; websiteUrl: string };

/** Org basics (wizard step 1). Calls `onSaved` after a successful PATCH /org. */
export function OrgBasicsForm({ org, canWrite, onSaved, submitLabel = 'Save' }: { org: OrgDetail; canWrite: boolean; onSaved?: (o: OrgDetail) => void; submitLabel?: string }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState<BasicsForm>(() => ({
    name: org.name,
    description: org.description ?? '',
    hq: org.hq ?? '',
    regions: org.regions,
    companySize: org.companySize ?? '',
    websiteUrl: org.websiteUrl ?? '',
  }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (p: Partial<BasicsForm>) => setF((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: (body: unknown) => patch<OrgDetail>('/org', body),
    onSuccess: (o) => {
      qc.setQueryData(KQ.org, o);
      void qc.invalidateQueries({ queryKey: KQ.me });
      toast.success('Company basics saved');
      onSaved?.(o);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sizes = f.companySize && !COMPANY_SIZES.includes(f.companySize as (typeof COMPANY_SIZES)[number]) ? [f.companySize, ...COMPANY_SIZES] : COMPANY_SIZES;
  const missing = !f.description.trim() || !f.hq.trim();

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!f.description.trim()) errs.description = 'Tell us what your company does';
        if (!f.hq.trim()) errs.hq = 'Where is your head office?';
        const r = updateOrgSchema.safeParse({ ...f, websiteUrl: f.websiteUrl.trim(), companySize: f.companySize || undefined });
        if (!r.success) Object.assign(errs, fieldErrors(r.error.issues));
        setErrors(errs);
        if (Object.keys(errs).length || !r.success) return;
        save.mutate({ ...r.data, websiteUrl: f.websiteUrl.trim() });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" error={errors.name}>
          <Input value={f.name} disabled={!canWrite} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Website" error={errors.websiteUrl} hint="Used for the website crawl in the next step">
          <Input type="url" inputMode="url" placeholder="https://www.yourcompany.com" value={f.websiteUrl} disabled={!canWrite} onChange={(e) => set({ websiteUrl: e.target.value })} />
        </Field>
      </div>
      <Field label="What does your company do?" error={errors.description} hint="Two or three sentences — who you sell to and what problem you solve.">
        <Textarea className="min-h-28" value={f.description} disabled={!canWrite} onChange={(e) => set({ description: e.target.value })} placeholder="We manufacture point-of-care diagnostic kits for hospitals and labs across India…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Headquarters" error={errors.hq}>
          <Input value={f.hq} disabled={!canWrite} onChange={(e) => set({ hq: e.target.value })} placeholder="e.g. Bengaluru, India" />
        </Field>
        <Field label="Company size" error={errors.companySize}>
          <NativeSelect value={f.companySize} disabled={!canWrite} onChange={(e) => set({ companySize: e.target.value })}>
            <option value="">Select…</option>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s} employees
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Regions served" error={errors.regions} hint="Countries, states or regions — press Enter or comma to add">
        <ListEditor value={f.regions} onChange={(v) => set({ regions: v })} max={30} disabled={!canWrite} label="Regions served" placeholder="e.g. India, Middle East" />
      </Field>
      {canWrite && (
        <div className="flex items-center justify-end gap-3 border-t pt-4">
          {missing && <p className="text-xs text-muted-foreground">Description and HQ are required to complete this step.</p>}
          <Button type="submit" loading={save.isPending}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
