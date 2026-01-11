import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface InfoTooltipProps {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  iconSize?: 'sm' | 'md';
}

export function InfoTooltip({ content, side = 'top', className = '', iconSize = 'sm' }: InfoTooltipProps) {
  const sizeClass = iconSize === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button 
            type="button" 
            className={`inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-help ${className}`}
            onClick={(e) => e.preventDefault()}
          >
            <Info className={sizeClass} />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[250px] text-xs">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
