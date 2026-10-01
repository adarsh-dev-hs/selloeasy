'use client';
import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Right-hand drawer built on the Radix dialog (focus trap, Esc to close, labelled by its title).
 * Use `SheetTitle` inside every sheet so screen readers announce it.
 */
export const Sheet = D.Root;
export const SheetClose = D.Close;

export function SheetContent({ className, children, ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          'app-surface fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l bg-card shadow-2xl focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 border-b p-5 pr-12', className)} {...props} />;
}
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-5 p-5', className)} {...props} />;
}
export const SheetTitle = ({ className, ...props }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn('text-lg font-semibold leading-snug', className)} {...props} />
);
export const SheetDescription = ({ className, ...props }: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
);
