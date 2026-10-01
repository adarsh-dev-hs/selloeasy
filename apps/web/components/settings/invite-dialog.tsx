'use client';
import { INVITABLE_ROLES, ROLE_LABELS, type OrgRole } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { errorMessage, post } from '@/lib/api';

export const ROLE_HINTS: Record<OrgRole, string> = {
  ORG_ADMIN: 'Full access: team, settings, knowledge, signals, pipeline and audit log.',
  SALES_MANAGER: 'Manage ICPs & signals, run the pipeline, assign leads, see team dashboards.',
  SDR: 'Work leads: claim, outreach, tasks. Can only change leads they own.',
  VIEWER: 'Read-only access to leads and dashboards.',
};

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy — select the text and copy manually');
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  );
}

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('SDR');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<{ email: string; inviteLink?: string } | null>(null);

  const invite = useMutation({
    mutationFn: () => post<{ id: string; expiresAt: string; inviteLink?: string }>('/org/invites', { email: email.trim(), role }),
    onSuccess: (r) => {
      toast.success(`Invitation sent to ${email.trim()}`);
      setSent({ email: email.trim(), inviteLink: r.inviteLink });
      void qc.invalidateQueries({ queryKey: ['org-invites'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setError(undefined);
    invite.mutate();
  };

  const reset = () => {
    setSent(null);
    setEmail('');
    setRole('SDR');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailCheck className="size-5 text-success" /> Invitation sent
              </DialogTitle>
              <DialogDescription>
                We emailed <span className="font-medium text-foreground">{sent.email}</span> a link to join. It expires in a few days.
              </DialogDescription>
            </DialogHeader>
            {sent.inviteLink && (
              <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Local environment: open the email in Mailpit at{' '}
                  <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    http://localhost:8025
                  </a>{' '}
                  or share this link directly.
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={sent.inviteLink} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Invite link" />
                  <CopyButton text={sent.inviteLink} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Invite another
              </Button>
              <Button onClick={() => (onOpenChange(false), reset())}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>They’ll get an email with a link to set their name and password.</DialogDescription>
            </DialogHeader>
            <Field label="Email" error={error}>
              <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" />
            </Field>
            <Field label="Role" hint={ROLE_HINTS[role]}>
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={invite.isPending}>
                Send invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
