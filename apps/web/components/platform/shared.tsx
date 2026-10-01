'use client';
import type { OrgStatus, PipelineStatus } from '@selloeasy/shared';
import { Check, Copy, Link2, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn, titleCase } from '@/lib/utils';

const ORG_STATUS_VARIANT: Record<OrgStatus, 'success' | 'warning' | 'destructive' | 'secondary' | 'default'> = {
  ACTIVE: 'success',
  ONBOARDING: 'default',
  INVITED: 'warning',
  SUSPENDED: 'destructive',
};

export function OrgStatusBadge({ status }: { status: OrgStatus }) {
  return <Badge variant={ORG_STATUS_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const RUN_VARIANT: Record<PipelineStatus, 'success' | 'warning' | 'destructive' | 'secondary' | 'default'> = {
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
  RUNNING: 'default',
  QUEUED: 'secondary',
};

export function RunStatusBadge({ status }: { status: PipelineStatus }) {
  return <Badge variant={RUN_VARIANT[status]}>{titleCase(status)}</Badge>;
}

export function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 }).format(n);
}

export function formatPct(n: number) {
  return `${n.toFixed(1)}%`;
}

/** Banner reminding Super Admins of the ADR-0010 data boundary. */
export function PublicDataNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground', className)}>
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {children ?? 'Platform admins see public-level data and aggregates only.'}
    </p>
  );
}

/** Shows a local-env invite link with a copy button. */
export function InviteLinkBox({ link, email }: { link: string; email?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Invite link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Link2 className="size-4 text-primary" aria-hidden /> Invite link (local environment only)
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 font-mono text-xs"
        />
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy invite link">
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The invite email{email ? ` to ${email}` : ''} was also sent to Mailpit at{' '}
        <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
          http://localhost:8025
        </a>
        .
      </p>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
