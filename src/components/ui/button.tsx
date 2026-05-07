import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Button — octrascan design system
 * Square edges, 11px text, lowercase labels, semantic variants.
 * Focus ring uses --oct-shadow-focus.
 */
const buttonVariants = cva(
  // Base: flat, sharp, 11px, bold, focus ring via shadow
  'inline-flex items-center justify-center whitespace-nowrap text-[11px] font-bold tracking-wide transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary — #3B567F fill
        default:
          'bg-primary text-primary-foreground hover:bg-primary/85 focus-visible:[box-shadow:var(--oct-shadow-focus)]',
        // Danger — destructive action
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/85 focus-visible:[box-shadow:var(--oct-shadow-focus)]',
        // Outline — surface bg, primary text, strong border
        outline:
          'border border-oc-border-dark bg-oc-surface text-primary hover:bg-accent focus-visible:[box-shadow:var(--oct-shadow-focus)]',
        // Secondary — muted surface
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:[box-shadow:var(--oct-shadow-focus)]',
        // Ghost — no border, hover surface
        ghost:
          'hover:bg-accent hover:text-accent-foreground focus-visible:[box-shadow:var(--oct-shadow-focus)]',
        // Link — text only
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-4 py-1.5',
        sm:      'h-7 px-3',
        lg:      'h-9 px-6',
        icon:    'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
