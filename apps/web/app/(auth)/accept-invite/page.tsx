'use client';
import type { InvitePreview, MeResponse } from '@selloeasy/shared';
import { ROLE_LABELS } from '@selloeasy/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage, get, post } from '@/lib/api';

function AcceptInvite() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => get<InvitePreview>('/auth/invite', { token }), enabled: token.length > 20, retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    setError(null);
    try {
      const me = await post<MeResponse>('/auth/accept-invite', { token, name, password });
      qc.setQueryData(['me'], me);
      router.replace(me.org?.status === 'ACTIVE' ? '/app/dashboard' : '/app/onboarding');
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  if (!token) return <p className="text-sm text-destructive">This invitation link is missing its token.</p>;
  if (invite.isLoading) return <Skeleton className="h-64 w-full" />;
  if (invite.error)
    return (
      <div>
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage(invite.error)}. Ask your administrator to send a new invite.</p>
      </div>
    );
  const inv = invite.data!;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {inv.orgName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You've been invited as <span className="font-medium text-foreground">{ROLE_LABELS[inv.role]}</span> ({inv.email}). Set up your account to continue.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Full name">
          <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Password" hint="At least 8 characters with upper & lower case letters and a number.">
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" loading={loading}>Create account & continue</Button>
      </form>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
