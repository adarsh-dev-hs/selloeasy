import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-success/15 text-success',
      warning: 'border-transparent bg-warning/20 text-amber-700 dark:text-amber-300',
      destructive: 'border-transparent bg-destructive/15 text-destructive',
      hot: 'border-transparent bg-hot/15 text-hot',
      warm: 'border-transparent bg-warm/20 text-amber-700 dark:text-amber-300',
      cold: 'border-transparent bg-cold/15 text-sky-700 dark:text-sky-300',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
