import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * TabsList — octrascan design system
 * Surface bg, 1px border-bottom, 38px height, no radius.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-8 items-center justify-center bg-oc-surface border-b border-oc-border-dark text-muted-foreground',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

/**
 * TabsTrigger — octrascan design system
 * 11px, bold, lowercase, bottom-border active indicator, no radius.
 * Active: primary color + bottom border. Inactive: muted.
 */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap px-3 py-1',
      'text-[11px] font-bold tracking-wide lowercase',
      'transition-all border-b-2 border-transparent',
      'focus-visible:outline-none focus-visible:[box-shadow:var(--oct-shadow-focus)]',
      'disabled:pointer-events-none disabled:opacity-50',
      // Active state: primary text + primary bottom border + bg
      'data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary',
      // Inactive: muted text
      'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-primary',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-0 ring-offset-background focus-visible:outline-none focus-visible:[box-shadow:var(--oct-shadow-focus)]',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
