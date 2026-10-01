import { Inbox, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn, initials } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} role="separator" />;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary', className)} title={name}>
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
      <p className="font-medium text-destructive">Something went wrong</p>
      <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      {retry && (
        <button onClick={retry} className="mt-3 text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; tone?: 'primary' | 'success' | 'warning' | 'hot' }) {
  const toneCls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/15 text-success', warning: 'bg-warning/20 text-amber-600', hot: 'bg-hot/15 text-hot' }[tone ?? 'primary'];
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex size-8 items-center justify-center rounded-lg', toneCls)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-card">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b bg-muted/40 [&_th]:h-10 [&_th]:px-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground" {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className="[&_tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5" {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...p} />;
