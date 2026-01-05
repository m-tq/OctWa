import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '@/lib/utils';

const ScrollAreaContext = React.createContext<{ hasOverflow: boolean }>({ hasOverflow: false });

// Hook to check if ScrollArea has overflow
export const useScrollAreaOverflow = () => React.useContext(ScrollAreaContext);

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & { stabilizeGutter?: boolean }
>(({ className, children, stabilizeGutter, ...props }, ref) => {
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!stabilizeGutter) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const checkOverflow = () => {
      setHasOverflow(viewport.scrollHeight > viewport.clientHeight);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(viewport);

    const mutationObserver = new MutationObserver(checkOverflow);
    mutationObserver.observe(viewport, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [stabilizeGutter]);

  return (
    <ScrollAreaContext.Provider value={{ hasOverflow: stabilizeGutter ? hasOverflow : false }}>
      <ScrollAreaPrimitive.Root
        ref={ref}
        className={cn('relative overflow-hidden', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport 
          ref={viewportRef}
          className="h-full w-full rounded-[inherit]"
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </ScrollAreaContext.Provider>
  );
});
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-opacity duration-300 ease-out',
      'opacity-0 hover:opacity-100 data-[state=visible]:opacity-100',
      orientation === 'vertical' &&
        'h-full w-2 p-[1px]',
      orientation === 'horizontal' &&
        'h-2 flex-col p-[1px]',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 bg-border/60 hover:bg-border rounded-full" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

// Wrapper component that adds padding when scrollbar is visible
const ScrollAreaContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { hasOverflow } = useScrollAreaOverflow();
  return (
    <div
      ref={ref}
      className={cn(className, hasOverflow && 'pr-3')}
      {...props}
    />
  );
});
ScrollAreaContent.displayName = 'ScrollAreaContent';

export { ScrollArea, ScrollBar, ScrollAreaContent };
