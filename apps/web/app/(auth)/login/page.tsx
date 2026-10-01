'use client';
import type { MeResponse } from '@selloeasy/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage, post } from '@/lib/api';

const DEMO = [
  { label: 'Super Admin', email: 'superadmin@selloeasy.local', password: 'Admin@123' },
  { label: 'Org Admin · Roadgrip Tyres', email: 'admin@roadgrip.local', password: 'Password@123' },
  { label: 'Sales Manager · Roadgrip', email: 'manager@roadgrip.local', password: 'Password@123' },
  { label: 'SDR · Roadgrip', email: 'sdr1@roadgrip.local', password: 'Password@123' },
  { label: 'Org Admin · MediSphere', email: 'admin@medisphere.local', password: 'Password@123' },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await post<MeResponse>('/auth/login', { email, password });
      qc.setQueryData(['me'], me);
      const next = params.get('next');
      const home = me.user.isSuperAdmin ? '/platform' : me.org?.status === 'ACTIVE' ? '/app/dashboard' : '/app/onboarding';
      router.replace(next && next.startsWith(me.user.isSuperAdmin ? '/platform' : '/app') ? next : home);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your SelloEasy workspace.</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" loading={loading} className="mt-2">Sign in</Button>
        <Link href="/forgot-password" className="text-center text-sm text-muted-foreground hover:text-foreground">Forgot password?</Link>
      </form>
      <div className="mt-10 rounded-xl border bg-muted/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Demo accounts (synthetic data)</p>
        <div className="mt-3 grid gap-1.5">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
              }}
              className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span>{d.label}</span>
              <span className="text-xs text-muted-foreground">{d.email}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
