'use client';
import type { Visibility } from '@selloeasy/shared';
import { Globe, Info, Lock, Plus, ShieldCheck, X } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Query keys shared by the onboarding wizard and the knowledge hub. */
export const KQ = {
  org: ['org'] as const,
  me: ['me'] as const,
  sources: ['org-sources'] as const,
  profile: ['org-profile'] as const,
  products: ['org-products'] as const,
  plans: ['org-plans'] as const,
  policies: ['org-policies'] as const,
  icps: ['icps'] as const,
  signals: ['signals'] as const,
};

export const VISIBILITY_HELP =
  'Public items are visible to platform administrators; internal items never leave your organization.';

// ────────────────────────────────────────────────────────────────────────────
// Visibility (ADR-0010)
// ────────────────────────────────────────────────────────────────────────────

export function VisibilityBadge({ value, className }: { value: Visibility; className?: string }) {
  return value === 'PUBLIC' ? (
    <Badge variant="default" className={className}>
      <Globe className="size-3" /> Public
    </Badge>
  ) : (
    <Badge variant="secondary" className={className}>
      <Lock className="size-3" /> Internal
    </Badge>
  );
}

/** Segmented Public / Internal control. Renders a read-only badge when disabled by permissions. */
export function VisibilityToggle({
  value,
  onChange,
  disabled,
  readOnly,
  size = 'sm',
  label = 'Visibility',
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
  readOnly?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  if (readOnly) return <VisibilityBadge value={value} />;
  const opts: [Visibility, typeof Globe, string][] = [
    ['PUBLIC', Globe, 'Public'],
    ['INTERNAL', Lock, 'Internal'],
  ];
  return (
    <Tip content={VISIBILITY_HELP}>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn('inline-flex shrink-0 rounded-md border bg-muted/50 p-0.5', disabled && 'opacity-60')}
      >
        {opts.map(([v, Icon, text]) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => !active && onChange(v)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded-[5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
                active
                  ? v === 'PUBLIC'
                    ? 'bg-card text-primary shadow-sm'
                    : 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3" /> {text}
            </button>
          );
        })}
      </div>
    </Tip>
  );
}

/** Prominent explainer of the Public/Internal rule. */
export function VisibilityNote({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm',
        className,
      )}
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p className="text-muted-foreground">
        {!compact && (
          <span className="font-medium text-foreground">Every item has a Public / Internal switch. </span>
        )}
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Globe className="size-3" /> Public
        </span>{' '}
        items are visible to platform administrators;{' '}
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Lock className="size-3" /> internal
        </span>{' '}
        items never leave your organization.
      </p>
    </div>
  );
}

export function Callout({
  icon: Icon = Info,
  tone = 'info',
  title,
  children,
  className,
}: {
  icon?: typeof Info;
  tone?: 'info' | 'warning';
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'bg-muted/40',
        className,
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="space-y-1 text-muted-foreground">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Confirm dialog for destructive actions
// ────────────────────────────────────────────────────────────────────────────

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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
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

// ────────────────────────────────────────────────────────────────────────────
// String-list editor (chips or editable lines)
// ────────────────────────────────────────────────────────────────────────────

export function ListEditor({
  value,
  onChange,
  placeholder = 'Add an item…',
  variant = 'chips',
  max = 50,
  disabled,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  variant?: 'chips' | 'lines';
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const add = () => {
    const parts = draft
      .split(variant === 'chips' ? /[,\n]/ : /\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, max));
    setDraft('');
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {variant === 'chips'
        ? value.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={label}>
              {value.map((v, i) => (
                <li
                  key={`${v}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs"
                >
                  {v}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Remove ${v}`}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        : value.length > 0 && (
            <ul className="space-y-1.5" aria-label={label}>
              {value.map((v, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <Input
                    value={v}
                    disabled={disabled}
                    aria-label={`${label ?? 'Item'} ${i + 1}`}
                    onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => !v.trim() && remove(i)}
                  />
                  {!disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() => remove(i)}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
      {!disabled && value.length < max && (
        <div className="flex gap-1.5">
          <Input
            value={draft}
            placeholder={placeholder}
            aria-label={label ? `Add to ${label}` : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={() => variant === 'chips' && draft.includes(',') && add()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Add"
            onClick={add}
            disabled={!draft.trim()}
          >
            <Plus />
          </Button>
        </div>
      )}
    </div>
  );
}

export function Chips({ items, max = 8, className }: { items: string[]; max?: number; className?: string }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = items.slice(0, max);
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {shown.map((t, i) => (
        <Badge key={`${t}-${i}`} variant="outline" className="font-normal">
          {t}
        </Badge>
      ))}
      {items.length > max && <Badge variant="secondary">+{items.length - max}</Badge>}
    </div>
  );
}

/** First zod issue per top-level field — for inline form errors. */
export function fieldErrors(
  issues: {
    path: PropertyKey[];
    message: string;
    code?: string;
    minimum?: unknown;
    maximum?: unknown;
    origin?: unknown;
  }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '_');
    let msg = i.message;
    if (i.code === 'too_small' && i.origin === 'string')
      msg = Number(i.minimum) <= 1 ? 'Required' : `At least ${String(i.minimum)} characters`;
    else if (i.code === 'too_big' && i.origin === 'string') msg = `At most ${String(i.maximum)} characters`;
    else if (i.code === 'too_big' && i.origin === 'array') msg = `At most ${String(i.maximum)} items`;
    else if (i.code === 'invalid_format' && /url/i.test(i.message))
      msg = 'Enter a valid URL starting with https://';
    out[k] ??= msg;
  }
  return out;
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
