'use client';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** "a, b ,c" → ['a','b','c'] (trimmed, de-duplicated, empties dropped). */
export function parseList(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(',')) {
    const v = part.trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}
export const formatList = (xs: string[] | undefined | null) => (xs ?? []).join(', ');

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  destructive = true,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
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

/** Small toggle-able block of long text (e.g. LLM match instructions). */
export function Collapsible({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        {label}
      </button>
      {open && <div className="mt-1.5 rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

/** Row of small chips with overflow count. */
export function Chips({ items, max = 8, variant = 'default' }: { items: string[]; max?: number; variant?: 'default' | 'negative' | 'muted' }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = items.slice(0, max);
  const cls = {
    default: 'bg-primary/10 text-primary',
    negative: 'bg-destructive/10 text-destructive line-through decoration-destructive/40',
    muted: 'bg-muted text-foreground/80',
  }[variant];
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((k) => (
        <span key={k} className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', cls)}>
          {k}
        </span>
      ))}
      {items.length > max && <span className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground">+{items.length - max}</span>}
    </div>
  );
}

/** Label + value row used on intelligence cards. */
export function ChipsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
