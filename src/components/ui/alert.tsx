import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Alert — octrascan design system
 * Flat, 1px border, 11px text, no radius.
 * Every alert must have visible text — no color-only status.
 */
const alertVariants = cva(
  'relative w-full border px-3 py-2 text-[11px] [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-foreground [&>svg~*]:pl-6',
  {
    variants: {
      variant: {
        default:
          'bg-background text-foreground border-oc-border',
        destructive:
          'border-oc-danger bg-[var(--oct-color-danger-bg)] text-oc-danger [&>svg]:text-oc-danger',
        warning:
          'border-oc-warning bg-[var(--oct-color-warning-bg)] text-oc-warning [&>svg]:text-oc-warning',
        success:
          'border-oc-success bg-transparent text-oc-success [&>svg]:text-oc-success',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-bold leading-none tracking-tight text-[11px]', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-[11px] [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
