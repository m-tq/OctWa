import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Globe, Shield, Lock } from 'lucide-react';
import { OperationMode } from '../utils/modeStorage';

interface ModeToggleProps {
  currentMode: OperationMode;
  onModeChange: (mode: OperationMode) => void;
  privateEnabled: boolean;
  encryptedBalance?: number;
  isCompact?: boolean;
}

export function ModeToggle({
  currentMode,
  onModeChange,
  privateEnabled,
  isCompact = false
}: ModeToggleProps) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayMode, setDisplayMode] = useState(currentMode);

  useEffect(() => {
    setDisplayMode(currentMode);
  }, [currentMode]);

  const handleModeChange = (mode: OperationMode) => {
    if (mode === 'private' && !privateEnabled) {
      return;
    }
    if (mode === currentMode) return;

    setIsTransitioning(true);

    // Trigger page transition effect
    document.body.classList.add('mode-switching');
    if (mode === 'private') {
      document.body.classList.add('to-private');
      document.body.classList.remove('to-public');
    } else {
      document.body.classList.add('to-public');
      document.body.classList.remove('to-private');
    }

    // Small delay for visual effect
    setTimeout(() => {
      onModeChange(mode);
      setDisplayMode(mode);
    }, 150);

    // Remove transition classes
    setTimeout(() => {
      setIsTransitioning(false);
      document.body.classList.remove('mode-switching', 'to-private', 'to-public');
    }, 500);
  };

  return (
    <div className={`relative grid grid-cols-2 gap-0.5 ${isCompact ? 'p-0.5' : 'p-1'} bg-muted rounded-lg`}>
      {/* Animated Background Slider */}
      <div
        className={`absolute top-0.5 bottom-0.5 left-0.5 right-0.5 rounded-md transition-all duration-300 ease-out pointer-events-none ${
          displayMode === 'public'
            ? 'bg-background shadow-md border border-border'
            : 'bg-[#0000db] shadow-lg shadow-[#0000db]/30'
        }`}
        style={{
          width: isCompact ? 'calc(50% - 3px)' : 'calc(50% - 6.5px)',
          transform: displayMode === 'private' ? `translateX(calc(100% + ${isCompact ? '2px' : '4px'}))` : 'translateX(0)'
        }}
      />

      {/* Public Mode Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleModeChange('public')}
        className={`relative z-10 flex items-center justify-center ${isCompact ? 'gap-1 px-2 py-1 h-6' : 'gap-1.5 px-4 py-1.5 h-8'} transition-all duration-300 bg-transparent hover:bg-transparent ${
          displayMode === 'public'
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Globe
          className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} transition-transform duration-300 ${
            displayMode === 'public' ? 'scale-110' : 'scale-100'
          }`}
        />
        <span className={`${isCompact ? 'text-[10px]' : 'text-xs'} font-medium`}>Public</span>
      </Button>

      {/* Private Mode Button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleModeChange('private')}
                disabled={!privateEnabled}
                className={`relative z-10 flex items-center justify-center ${isCompact ? 'gap-1 px-2 py-1 h-6' : 'gap-1.5 px-4 py-1.5 h-8'} transition-all duration-300 bg-transparent hover:bg-transparent ${
                  displayMode === 'private'
                    ? 'text-white'
                    : privateEnabled
                      ? 'text-muted-foreground hover:text-[#0000db]'
                      : 'opacity-50 cursor-not-allowed text-muted-foreground'
                }`}
              >
                <div
                  className={`transition-transform duration-300 ${
                    displayMode === 'private' ? 'scale-110' : 'scale-100'
                  }`}
                >
                  {privateEnabled ? (
                    <Shield className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                  ) : (
                    <Lock className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                  )}
                </div>
                <span className={`${isCompact ? 'text-[10px]' : 'text-xs'} font-medium`}>Private</span>
              </Button>
            </span>
          </TooltipTrigger>
          {!privateEnabled && (
            <TooltipContent side="bottom" className="max-w-[200px]">
              <p className="text-xs">Encrypt some OCT to access Private features</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {/* Sparkle effect on transition */}
      {isTransitioning && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
          <div
            className={`absolute inset-0 ${
              displayMode === 'private'
                ? 'bg-gradient-to-r from-transparent via-[#0000db]/20 to-transparent'
                : 'bg-gradient-to-r from-transparent via-white/20 to-transparent'
            } animate-shimmer`}
          />
        </div>
      )}
    </div>
  );
}
