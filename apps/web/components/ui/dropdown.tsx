'use client';
import { DropdownMenu as M } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn('app-surface z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg', className)}
        {...props}
      />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof M.Separator>) => (
  <M.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
);
export const DropdownMenuLabel = ({ className, ...props }: React.ComponentProps<typeof M.Label>) => (
  <M.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />
);
