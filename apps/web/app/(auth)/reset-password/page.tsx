'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage, post } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (done)
    return (
      <>
        <h1 className="text-2xl font-semibold">Password updated</h1>
        <p className="mt-2 text-sm text-muted-foreground">All other sessions were signed out.</p>
        <Button asChild className="mt-6">
          <Link href="/login">Sign in</Link>
        </Button>
      </>
    );
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <form
        className="mt-8 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError(null);
          try {
            await post('/auth/reset-password', { token, password });
            setDone(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setLoading(false);
          }
        }}
      >
        <Field label="New password" hint="At least 8 characters with upper & lower case letters and a number.">
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={loading}>Update password</Button>
      </form>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
