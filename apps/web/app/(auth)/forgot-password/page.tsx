'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage, post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      {sent ? (
        <p className="mt-4 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its way. Locally, open Mailpit at <code>http://localhost:8025</code>.
        </p>
      ) : (
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            try {
              await post('/auth/forgot-password', { email });
              setSent(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        >
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" loading={loading}>Send reset link</Button>
        </form>
      )}
      <Link href="/login" className="mt-6 text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
    </>
  );
}
