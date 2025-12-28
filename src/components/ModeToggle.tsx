import { useState, useEffect } from 'react';
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
    <div className="w-full relative">
      {/* Full-width Tab Container */}
      <div className={`relative w-full grid grid-cols-2 ${isCompact ? 'h-9' : 'h-12'} bg-muted rounded-xl overflow-hidden border-2 border-border/50`}>
        {/* Animated Background Slider */}
        <div
          className={`absolute top-0 bottom-0 w-1/2 transition-all duration-300 ease-out ${
            displayMode === 'public'
              ? 'left-0 bg-background border border-border shadow-sm'
              : 'left-1/2 bg-gradient-to-r from-[#0000db] to-[#0000aa]'
          }`}
          style={{
            boxShadow: displayMode === 'private' 
              ? '0 0 20px rgba(0, 0, 219, 0.4)' 
              : undefined
          }}
        />

        {/* Public Mode Tab */}
        <button
          onClick={() => handleModeChange('public')}
          className={`relative z-10 flex items-center justify-center gap-1.5 transition-all duration-300 ${
            displayMode === 'public'
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe
            className={`${isCompact ? 'h-3.5 w-3.5' : 'h-5 w-5'} transition-transform duration-300 ${
              displayMode === 'public' ? 'scale-110' : 'scale-100'
            }`}
          />
          <span className={`${isCompact ? 'text-[11px]' : 'text-sm'} font-medium`}>
            Public
          </span>
        </button>

        {/* Private Mode Tab */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleModeChange('private')}
                disabled={!privateEnabled}
                className={`relative z-10 flex items-center justify-center gap-1.5 transition-all duration-300 ${
                  displayMode === 'private'
                    ? 'text-white font-semibold'
                    : privateEnabled
                      ? 'text-muted-foreground hover:text-[#0000db]'
                      : 'opacity-40 cursor-not-allowed text-muted-foreground'
                }`}
              >
                <div
                  className={`transition-transform duration-300 ${
                    displayMode === 'private' ? 'scale-110' : 'scale-100'
                  }`}
                >
                  {privateEnabled ? (
                    <Shield className={`${isCompact ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                  ) : (
                    <Lock className={`${isCompact ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                  )}
                </div>
                <span className={`${isCompact ? 'text-[11px]' : 'text-sm'} font-medium`}>
                  Private
                </span>
                {!privateEnabled && (
                  <Lock className={`${isCompact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} ml-0.5 opacity-60`} />
                )}
              </button>
            </TooltipTrigger>
            {!privateEnabled && (
              <TooltipContent side="bottom" className="max-w-[200px]">
                <p className="text-xs">Encrypt some OCT to access Private features</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Shimmer effect on transition */}
        {isTransitioning && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div
              className={`absolute inset-0 ${
                displayMode === 'private'
                  ? 'bg-gradient-to-r from-transparent via-[#0000db]/30 to-transparent'
                  : 'bg-gradient-to-r from-transparent via-foreground/10 to-transparent'
              } animate-shimmer`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
