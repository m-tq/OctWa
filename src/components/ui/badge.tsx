import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Badge / Tag — octrascan design system
 * 10px, compact, square, textual. No unlabeled dots.
 * Every status must have visible text.
 */
const badgeVariants = cva(
  // Base: 10px, square, inline, no radius
  'inline-flex items-center border px-1.5 py-0 text-[10px] font-bold tracking-wide transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        // Default — primary fill (op type, general)
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
        // Secondary — surface bg, primary text (metadata)
        secondary:
          'border-oc-border bg-oc-surface text-oc-primary hover:bg-accent',
        // Destructive — danger (rejected, invalid, failed)
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85',
        // Outline — border only
        outline:
          'border-oc-border-dark text-foreground bg-transparent',
        // Confirmed — success green (confirmed, done, safe, active)
        success:
          'border-transparent bg-oc-success text-white',
        // Staging — warning amber (staging, relay, pending)
        warning:
          'border-transparent bg-oc-warning text-black',
        // Pending — pulse animation
        pending:
          'border-transparent bg-oc-secondary text-white octra-tag-pending',
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

export { Badge, badgeVariants };
