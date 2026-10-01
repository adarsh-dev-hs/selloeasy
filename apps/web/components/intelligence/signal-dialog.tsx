'use client';
import type { Icp, Signal } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/input';
import { errorMessage, patch, post } from '@/lib/api';
import { formatList, parseList } from './shared';

type Form = {
  name: string;
  description: string;
  matchInstructions: string;
  keywords: string;
  negativeKeywords: string;
  weight: number;
  icpId: string;
  isActive: boolean;
};

const toForm = (s?: Signal | null): Form => ({
  name: s?.name ?? '',
  description: s?.description ?? '',
  matchInstructions: s?.matchInstructions ?? '',
  keywords: formatList(s?.keywords),
  negativeKeywords: formatList(s?.negativeKeywords),
  weight: s?.weight ?? 1,
  icpId: s?.icpId ?? '',
  isActive: s?.isActive ?? true,
});

/**
 * Create a custom signal or edit any signal. Predefined (industry) signals keep their
 * name/description from the template; the org tunes keywords, weight and instructions.
 */
export function SignalDialog({ open, onOpenChange, signal, icps }: { open: boolean; onOpenChange: (o: boolean) => void; signal: Signal | null; icps: Icp[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => toForm(signal));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const predefined = signal?.source === 'PREDEFINED';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(predefined ? {} : { name: f.name.trim(), description: f.description.trim() }),
        matchInstructions: f.matchInstructions.trim(),
        keywords: parseList(f.keywords),
        negativeKeywords: parseList(f.negativeKeywords),
        weight: f.weight,
        icpId: f.icpId || null,
        isActive: f.isActive,
      };
      return signal ? patch<Signal>(`/signals/${signal.id}`, body) : post<Signal>('/signals', body);
    },
    onSuccess: () => {
      toast.success(signal ? 'Signal updated' : 'Custom signal created');
      void qc.invalidateQueries({ queryKey: ['signals'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!predefined && f.name.trim().length < 2) errs.name = 'At least 2 characters';
    if (f.matchInstructions.trim().length < 10) errs.matchInstructions = 'Describe what should (and should not) match — at least 10 characters';
    if (f.weight < 0.5 || f.weight > 2) errs.weight = 'Between 0.5 and 2';
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{signal ? `Edit “${signal.name}”` : 'New custom signal'}</DialogTitle>
          <DialogDescription>
            {predefined
              ? 'Industry signal from the platform template. Tune keywords, weight and match instructions for your market.'
              : 'Describe an observable market event that indicates buying intent for your company.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {!predefined && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name}>
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Fleet operator large order" maxLength={160} autoFocus />
              </Field>
              <Field label="Linked ICP (optional)">
                <NativeSelect value={f.icpId} onChange={(e) => set('icpId', e.target.value)}>
                  <option value="">No specific ICP</option>
                  {icps.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Why this event means buying intent for you" maxLength={2000} />
              </Field>
            </div>
          )}
          <Field
            label="Match instructions (for the LLM)"
            error={errors.matchInstructions}
            hint="Plain-language rules the model uses to decide whether an event is a match. Say what to exclude, too."
          >
            <Textarea
              rows={4}
              value={f.matchInstructions}
              onChange={(e) => set('matchInstructions', e.target.value)}
              placeholder="Match when … Do NOT match when …"
              maxLength={2000}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keywords" hint="Comma-separated. Used by the cheap prefilter before any LLM call.">
              <Input value={f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="new plant, capacity expansion, greenfield" />
            </Field>
            <Field label="Negative keywords" hint="Comma-separated. Events containing these are skipped.">
              <Input value={f.negativeKeywords} onChange={(e) => set('negativeKeywords', e.target.value)} placeholder="recall, layoffs" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Weight · ${f.weight.toFixed(1)}×`} error={errors.weight} hint="How strongly this signal boosts a lead’s score (0.5–2).">
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={f.weight}
                onChange={(e) => set('weight', Number(e.target.value))}
                className="h-9 w-full accent-primary"
                aria-label="Weight"
              />
            </Field>
            {predefined ? (
              <Field label="Linked ICP (optional)">
                <NativeSelect value={f.icpId} onChange={(e) => set('icpId', e.target.value)}>
                  <option value="">No specific ICP</option>
                  {icps.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <div className="flex items-center gap-3 self-center pt-4">
                <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} label="Active" />
                <span className="text-sm">{f.isActive ? 'Active — used in the next run' : 'Inactive'}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {signal ? 'Save changes' : 'Create signal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
