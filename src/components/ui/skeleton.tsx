import { cn } from '@/lib/utils';

/**
 * Skeleton — octrascan design system
 * Flat pulse, no radius, uses surface color.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse bg-oc-surface border border-oc-border', className)}
      {...props}
    />
  );
}

export { Skeleton };
