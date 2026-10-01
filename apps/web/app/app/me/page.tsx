'use client';
import { INDUSTRY_LABELS, ROLE_LABELS, type MeResponse } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ROLE_HINTS } from '@/components/settings/invite-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Avatar, PageHeader } from '@/components/ui/misc';
import { errorMessage, patch } from '@/lib/api';
import { useMe } from '@/lib/auth';

const isUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

function ProfileForm({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: me.user.name, phone: me.user.phone ?? '', calendlyUrl: me.user.calendlyUrl ?? '' });
  const [errors, setErrors] = useState<{ name?: string; calendlyUrl?: string }>({});
  const dirty = f.name !== me.user.name || f.phone !== (me.user.phone ?? '') || f.calendlyUrl !== (me.user.calendlyUrl ?? '');

  const save = useMutation({
    mutationFn: () => patch<MeResponse>('/auth/me', { name: f.name.trim(), phone: f.phone.trim(), calendlyUrl: f.calendlyUrl.trim() }),
    onSuccess: (r) => {
      toast.success('Profile saved');
      qc.setQueryData(['me'], r);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['org-users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.name.trim().length < 2) errs.name = 'At least 2 characters';
    if (f.calendlyUrl.trim() && !isUrl(f.calendlyUrl.trim())) errs.calendlyUrl = 'Enter a full URL, e.g. https://calendly.com/you/30min';
    setErrors(errs);
    if (!Object.keys(errs).length) save.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-primary" /> Profile
          </CardTitle>
          <CardDescription>How you appear to teammates and in outreach drafts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.name}>
            <Input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} maxLength={120} autoComplete="name" />
          </Field>
          <Field label="Email" hint="Contact an Org Admin to change your sign-in email.">
            <Input value={me.user.email} readOnly disabled />
          </Field>
          <Field label="Phone" hint="Included in your email signature on drafts.">
            <Input type="tel" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} maxLength={40} placeholder="+91 98xxx xxxxx" autoComplete="tel" />
          </Field>
          <Field label="Calendly link" error={errors.calendlyUrl} hint="Inserted into outreach drafts and meeting invites. Falls back to the org default when empty.">
            <div className="relative">
              <CalendarClock className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input type="url" className="pl-8" value={f.calendlyUrl} onChange={(e) => setF((p) => ({ ...p, calendlyUrl: e.target.value }))} placeholder="https://calendly.com/you/30min" />
            </div>
          </Field>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setF({ name: me.user.name, phone: me.user.phone ?? '', calendlyUrl: me.user.calendlyUrl ?? '' })}>
              Reset
            </Button>
          )}
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function MePage() {
  const me = useMe();
  const orgRole = me.role === 'SUPER_ADMIN' ? null : me.role;
  return (
    <>
      <PageHeader title="My profile" description="Your personal details and outreach preferences." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ProfileForm key={me.user.id} me={me} />
        <Card className="h-fit">
          <CardHeader className="flex-row items-center gap-3">
            <Avatar name={me.user.name} className="size-11 text-sm" />
            <div className="min-w-0">
              <CardTitle className="truncate">{me.user.name}</CardTitle>
              <CardDescription className="truncate">{me.user.email}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Role
              </p>
              <Badge>{ROLE_LABELS[me.role]}</Badge>
              {orgRole && <p className="mt-1.5 text-xs text-muted-foreground">{ROLE_HINTS[orgRole]}</p>}
            </div>
            {me.org && (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Building2 className="size-3.5" /> Organization
                </p>
                <p className="font-medium">{me.org.name}</p>
                <p className="text-xs text-muted-foreground">
                  {INDUSTRY_LABELS[me.org.industry]} · {me.org.status.charAt(0) + me.org.status.slice(1).toLowerCase()}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Role and organization are managed by your Org Admin.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
