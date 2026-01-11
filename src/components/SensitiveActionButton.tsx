import { forwardRef } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SensitiveActionButtonProps extends ButtonProps {
  tooltipText?: string;
  showWarningIcon?: boolean;
}

export const SensitiveActionButton = forwardRef<HTMLButtonElement, SensitiveActionButtonProps>(
  ({ className, children, tooltipText, showWarningIcon = false, variant = 'outline', ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        variant={variant}
        className={cn(
          "border-orange-200 dark:border-orange-800/50 hover:bg-orange-50 dark:hover:bg-orange-950/30 hover:border-orange-300 dark:hover:border-orange-700",
          "text-orange-700 dark:text-orange-300",
          className
        )}
        {...props}
      >
        {showWarningIcon && <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-orange-500" />}
        {children}
      </Button>
    );

    if (tooltipText) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {button}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <p className="text-xs">{tooltipText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  }
);

SensitiveActionButton.displayName = 'SensitiveActionButton';
