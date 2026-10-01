'use client';
import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, wide, ...props }: React.ComponentProps<typeof D.Content> & { wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content
        className={cn(
          'app-surface fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn('text-lg font-semibold', className)} {...props} />
);
export const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
);
