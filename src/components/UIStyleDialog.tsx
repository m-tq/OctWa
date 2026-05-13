import { Check, Palette } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStyle, type UIStyle } from './UIStyleProvider';

interface UIStyleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPopupMode?: boolean;
}

interface StyleOption {
  value: UIStyle;
  name: string;
  description: string;
  swatches: string[];
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'default',
    name: 'Default',
    description: 'Octrascan-inspired flat look — dense, sharp, scanner-first.',
    swatches: ['#3B567F', '#00E5C0', '#0f172a', '#e5e9ef'],
  },
  {
    value: 'nova',
    name: 'Nova',
    description: 'Modern violet palette with softer radii and Inter typography.',
    swatches: ['#8b5cf6', '#22d3ee', '#0b0b0f', '#a78bfa'],
  },
];

/**
 * Small, self-contained modal for picking the UI style. Renders a card for
 * each available style with its accent swatches and a one-line description,
 * then persists the choice via `useUIStyle`.
 */
export function UIStyleDialog({
  open,
  onOpenChange,
  isPopupMode = false,
}: UIStyleDialogProps) {
  const { uiStyle, setUIStyle } = useUIStyle();

  const handleSelect = (style: UIStyle) => {
    setUIStyle(style);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isPopupMode
            ? 'w-[360px] max-h-[520px] overflow-hidden p-4 gap-3'
            : 'sm:max-w-md'
        }
      >
        <DialogHeader className={isPopupMode ? 'pb-1' : ''}>
          <DialogTitle
            className={`flex items-center gap-2 ${isPopupMode ? 'text-sm' : ''}`}
          >
            <Palette className={isPopupMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            UI Style
          </DialogTitle>
          <DialogDescription className={isPopupMode ? 'text-[11px]' : 'text-xs'}>
            Choose how the wallet interface looks. Applied instantly to every
            screen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {STYLE_OPTIONS.map((option) => {
            const isActive = uiStyle === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`group relative flex items-start gap-3 text-left p-3 border transition-all
                  ${isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/40'}
                `}
              >
                {/* Swatch strip */}
                <div className="flex flex-col gap-1 flex-shrink-0 mt-0.5">
                  {option.swatches.map((color, idx) => (
                    <span
                      key={idx}
                      className="w-5 h-2.5 rounded-sm border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-semibold ${isPopupMode ? 'text-xs' : 'text-sm'}`}
                    >
                      {option.name}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-primary font-medium">
                        <Check className="h-3 w-3" /> active
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-muted-foreground mt-0.5 ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}
                  >
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={isPopupMode ? 'h-7 text-[11px] px-3' : ''}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
