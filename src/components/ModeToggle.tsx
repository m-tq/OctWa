import { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Globe, Shield } from 'lucide-react';
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

  const isPrivate = displayMode === 'private';

  const handleToggle = () => {
    const newMode = isPrivate ? 'public' : 'private';
    
    if (newMode === 'private' && !privateEnabled) {
      return;
    }

    setIsTransitioning(true);

    // Trigger page transition effect
    document.body.classList.add('mode-switching');
    if (newMode === 'private') {
      document.body.classList.add('to-private');
      document.body.classList.remove('to-public');
    } else {
      document.body.classList.add('to-public');
      document.body.classList.remove('to-private');
    }

    // Small delay for visual effect
    setTimeout(() => {
      onModeChange(newMode);
      setDisplayMode(newMode);
    }, 150);

    // Remove transition classes
    setTimeout(() => {
      setIsTransitioning(false);
      document.body.classList.remove('mode-switching', 'to-private', 'to-public');
    }, 500);
  };

  // Tooltip text based on current state
  const getTooltipText = () => {
    if (!privateEnabled && !isPrivate) {
      return 'Encrypt some OCT to enable Private mode';
    }
    return isPrivate ? 'Switch to Public mode' : 'Switch to Private mode';
  };

  return (
    <div className="w-full">
      <div className={`flex items-center justify-between ${isCompact ? 'gap-3' : 'gap-4'}`}>
        {/* Left: Single Toggle Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggle}
                  disabled={!privateEnabled && !isPrivate}
                  className={`flex items-center justify-center relative overflow-hidden transition-all duration-300 shadow-md
                    ${isCompact ? 'h-12 w-12 p-0 rounded-xl' : 'h-14 w-14 p-0 rounded-xl'}
                    ${isPrivate 
                      ? 'bg-[#0000db] border-[#0000db] hover:bg-[#0000db]/90 hover:border-[#0000db]/90 shadow-[#0000db]/30' 
                      : 'bg-background border-2 border-border hover:bg-accent hover:border-foreground/20'
                    }
                    ${!privateEnabled && !isPrivate ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                  aria-label="Toggle public/private mode"
                >
                  {/* Public Icon */}
                  <Globe 
                    className={`absolute transition-all duration-300 ease-in-out
                      ${isCompact ? 'h-6 w-6' : 'h-7 w-7'}
                      ${isPrivate 
                        ? 'rotate-90 scale-0 opacity-0' 
                        : 'rotate-0 scale-100 opacity-100'
                      }
                    `}
                  />
                  {/* Private Icon */}
                  <Shield 
                    className={`absolute transition-all duration-300 ease-in-out text-white
                      ${isCompact ? 'h-6 w-6' : 'h-7 w-7'}
                      ${isPrivate 
                        ? 'rotate-0 scale-100 opacity-100' 
                        : '-rotate-90 scale-0 opacity-0'
                      }
                    `}
                  />
                  {/* Shimmer on transition */}
                  {isTransitioning && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{getTooltipText()}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Right: Animated Status Text */}
        <div className={`relative overflow-hidden flex items-center ${isCompact ? 'h-5' : 'h-6'}`}>
          {/* Public Mode Text */}
          <span
            className={`${isCompact ? 'text-xs' : 'text-sm'} font-medium text-muted-foreground whitespace-nowrap transition-all duration-300 ease-in-out
              ${isPrivate 
                ? '-translate-y-full opacity-0 absolute' 
                : 'translate-y-0 opacity-100'
              }
            `}
          >
            Public Mode
          </span>
          {/* Private Mode Text */}
          <span
            className={`${isCompact ? 'text-xs' : 'text-sm'} font-medium text-[#0000db] whitespace-nowrap transition-all duration-300 ease-in-out
              ${isPrivate 
                ? 'translate-y-0 opacity-100' 
                : 'translate-y-full opacity-0 absolute'
              }
            `}
          >
            Private Mode
          </span>
        </div>
      </div>
    </div>
  );
}
