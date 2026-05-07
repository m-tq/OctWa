import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Input — octrascan design system
 * 11px, 1px border, focus ring via --oct-shadow-focus, no radius.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base: flat, sharp, 11px, 1px border, focus ring
          'flex h-8 w-full border border-input bg-background px-2.5 py-1.5 text-[11px] tracking-wide shadow-none transition-colors',
          'file:border-0 file:bg-transparent file:text-[11px] file:font-medium file:text-foreground',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:border-primary focus-visible:[box-shadow:var(--oct-shadow-focus)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
