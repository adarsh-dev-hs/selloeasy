'use client';
import { createOrgSchema, INDUSTRIES, INDUSTRY_LABELS, type Industry, type PlatformOrgListItem } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { InviteLinkBox } from '@/components/platform/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { ApiError, errorMessage, post } from '@/lib/api';

type Created = PlatformOrgListItem & { invitationId: string; inviteLink?: string };
type Form = { name: string; industry: Industry | ''; websiteUrl: string; adminEmail: string };
const EMPTY: Form = { name: '', industry: '', websiteUrl: '', adminEmail: '' };

export function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [created, setCreated] = useState<{ org: Created; email: string } | null>(null);

  const reset = () => {
    setForm(EMPTY);
    setErrors({});
    setCreated(null);
  };

  const create = useMutation({
    mutationFn: (body: unknown) => post<Created>('/platform/orgs', body),
    onSuccess: (org) => {
      toast.success(`${org.name} created — admin invite sent`);
      setCreated({ org, email: form.adminEmail });
      void qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors?.length) {
        const fe: Partial<Record<keyof Form, string>> = {};
        for (const f of e.fieldErrors) {
          const key = f.path.replace(/^body\.?/, '').split('.')[0] as keyof Form;
          if (key in EMPTY) fe[key] = f.message;
        }
        setErrors(fe);
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name.trim(),
      industry: form.industry,
      websiteUrl: form.websiteUrl.trim() || undefined,
      adminEmail: form.adminEmail.trim().toLowerCase(),
    };
    const parsed = createOrgSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Partial<Record<keyof Form, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Form;
        if (fe[key]) continue;
        fe[key] =
          key === 'industry'
            ? 'Choose an industry'
            : key === 'adminEmail'
              ? 'Enter a valid email address'
              : key === 'websiteUrl'
                ? 'Enter a full URL, e.g. https://example.com'
                : key === 'name'
                  ? 'Name must be 2–120 characters'
                  : issue.message;
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setTimeout(reset, 200);
      }}
    >
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" aria-hidden /> Organization created
              </DialogTitle>
              <DialogDescription>
                <strong className="text-foreground">{created.org.name}</strong> is in the <em>Invited</em> state. An admin invitation was sent to{' '}
                <strong className="text-foreground">{created.email}</strong>; industry signal templates were cloned into the org.
              </DialogDescription>
            </DialogHeader>
            {created.org.inviteLink && <InviteLinkBox link={created.org.inviteLink} email={created.email} />}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Create another
              </Button>
              <Button asChild>
                <Link href={`/platform/orgs/${created.org.id}`} onClick={() => onOpenChange(false)}>
                  View organization
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New organization</DialogTitle>
              <DialogDescription>Create a tenant and email an invitation to its first Org Admin.</DialogDescription>
            </DialogHeader>
            <Field label="Organization name" error={errors.name}>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Acme Diagnostics Pvt. Ltd."
                aria-invalid={!!errors.name}
                maxLength={120}
              />
            </Field>
            <Field label="Industry" error={errors.industry}>
              <NativeSelect value={form.industry} onChange={(e) => set('industry', e.target.value as Industry)} aria-invalid={!!errors.industry} aria-label="Industry">
                <option value="" disabled>
                  Select an industry…
                </option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {INDUSTRY_LABELS[i]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Website (optional)" error={errors.websiteUrl} hint="Used to seed the public company profile during onboarding.">
              <Input type="url" value={form.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://acme.example" aria-invalid={!!errors.websiteUrl} />
            </Field>
            <Field label="Admin email" error={errors.adminEmail} hint="This person becomes the Org Admin and completes onboarding.">
              <Input type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="admin@acme.example" aria-invalid={!!errors.adminEmail} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create & send invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
