import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center border px-1.5 py-0 text-[10px] font-bold tracking-wide transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
        secondary:
          'border-transparent bg-oc-surface text-oc-primary border-oc-border hover:bg-accent',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85',
        outline:
          'border-oc-border-dark text-foreground',
        success:
          'border-transparent bg-oc-success text-white',
        warning:
          'border-transparent bg-oc-warning text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }; // Ensure badgeVariants is explicitly exported
