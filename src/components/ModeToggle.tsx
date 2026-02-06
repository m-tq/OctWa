import { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Globe, Shield, Check, AlertTriangle } from 'lucide-react';
import { OperationMode } from '../utils/modeStorage';
import { ModeSwitchConfirmDialog, isModeSwitchReminderDisabled } from './ModeSwitchConfirmDialog';

interface ModeToggleProps {
  currentMode: OperationMode;
  onModeChange: (mode: OperationMode) => void;
  privateEnabled: boolean;
  encryptedBalance?: number;
  pendingTransfersCount?: number;
  isCompact?: boolean;
  showConfirmation?: boolean;
}

export function ModeToggle({
  currentMode,
  onModeChange,
  privateEnabled,
  encryptedBalance = 0,
  pendingTransfersCount = 0,
  isCompact = false,
  showConfirmation = true
}: ModeToggleProps) {
  const [displayMode, setDisplayMode] = useState(currentMode);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<OperationMode | null>(null);

  useEffect(() => {
    setDisplayMode(currentMode);
  }, [currentMode]);

  // Determine if user is "exposed" (public mode or no encrypted balance/pending transfers)
  const isExposed = currentMode === 'public' || (encryptedBalance <= 0 && pendingTransfersCount <= 0);
  const isProtected = currentMode === 'private' && (encryptedBalance > 0 || pendingTransfersCount > 0);

  const isPrivate = displayMode === 'private';

  const executeToggle = (newMode: OperationMode) => {
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
      document.body.classList.remove('mode-switching', 'to-private', 'to-public');
    }, 500);
  };

  const handleToggle = () => {
    const newMode = isPrivate ? 'public' : 'private';
    
    if (newMode === 'private' && !privateEnabled) {
      return;
    }

    // Show confirmation dialog only when leaving private mode (switching to public)
    // Skip if user has disabled the reminder
    if (showConfirmation && newMode === 'public' && isPrivate && !isModeSwitchReminderDisabled()) {
      setPendingMode(newMode);
      setShowConfirmDialog(true);
      return;
    }

    executeToggle(newMode);
  };

  const handleConfirmSwitch = () => {
    if (pendingMode) {
      executeToggle(pendingMode);
      setPendingMode(null);
    }
    setShowConfirmDialog(false);
  };

  // Tooltip text based on current state
  const getTooltipText = () => {
    if (!privateEnabled && !isPrivate) {
      return 'Encrypt some OCT or have pending transfers to enable Private mode';
    }
    return isPrivate ? 'Switch to Public mode' : 'Switch to Private mode';
  };

  const buttonSize = isCompact ? 'h-14 w-14' : 'h-16 w-16';
  const iconSize = isCompact ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <div className={`w-full ${isCompact ? 'pl-2' : ''}`}>
      <div className={`flex items-center justify-between ${isCompact ? 'gap-3' : 'gap-4'}`}>
        {/* Left: Toggle Button + Status Text */}
        <div className="flex items-center gap-3">
          {/* Animated Toggle Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <button
                    onClick={handleToggle}
                    disabled={!privateEnabled && !isPrivate}
                    className={`relative ${buttonSize} rounded-full flex items-center justify-center transition-all duration-300
                      ${!privateEnabled && !isPrivate ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                    aria-label="Toggle public/private mode"
                  >
                    {/* Outer glow/shadow */}
                    <div 
                      className={`absolute rounded-full transition-all duration-500 ${
                        isCompact ? 'inset-1' : 'inset-0'
                      } ${
                        isPrivate 
                          ? isCompact
                            ? 'shadow-[0_0_12px_4px_rgba(0,229,192,0.4)] bg-[#00E5C0]/10'
                            : 'shadow-[0_0_30px_8px_rgba(0,229,192,0.5)] bg-[#00E5C0]/10' 
                          : isCompact
                            ? 'shadow-[0_0_10px_3px_rgba(0,0,0,0.12)] dark:shadow-[0_0_10px_3px_rgba(255,255,255,0.12)] bg-muted/40'
                            : 'shadow-[0_0_25px_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_25px_6px_rgba(255,255,255,0.15)] bg-muted/40'
                      }`}
                    />

                    {/* Rotating ring */}
                    <div 
                      className={`absolute inset-0 rounded-full border-2 border-transparent animate-spin ${
                        isPrivate ? 'border-t-[#00E5C0]/60' : 'border-t-foreground/40'
                      }`}
                      style={{ animationDuration: '3s' }}
                    />

                    {/* Inner circle background */}
                    <div 
                      className={`absolute inset-2 rounded-full transition-all duration-300 ${
                        isPrivate 
                          ? 'bg-[#00E5C0] border-2 border-[#00E5C0]' 
                          : 'bg-background border-2 border-border'
                      }`}
                    />

                    {/* Icon container */}
                    <div className="relative z-10">
                      {/* Public Icon */}
                      <Globe 
                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-in-out
                          ${iconSize}
                          ${isPrivate 
                            ? 'rotate-90 scale-0 opacity-0 text-white' 
                            : 'rotate-0 scale-100 opacity-100 text-foreground'
                          }
                        `}
                      />
                      {/* Private Icon */}
                      <Shield 
                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-in-out text-white
                          ${iconSize}
                          ${isPrivate 
                            ? 'rotate-0 scale-100 opacity-100' 
                            : '-rotate-90 scale-0 opacity-0'
                          }
                        `}
                      />
                    </div>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={isCompact ? "px-2 py-1 max-w-[100px]" : ""}>
                <p className={isCompact ? "text-[10px] whitespace-normal" : "text-xs"}>{getTooltipText()}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Animated Status Text */}
          <div className="flex flex-col gap-0.5">
            <div className={`relative overflow-hidden flex items-center ${isCompact ? 'h-7' : 'h-8'}`}>
              {/* Public Mode Text */}
              <button
                onClick={handleToggle}
                disabled={!privateEnabled && !isPrivate}
                className={`${isCompact ? 'text-lg' : 'text-xl'} font-medium text-muted-foreground whitespace-nowrap transition-all duration-300 ease-in-out cursor-pointer hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50
                  ${isPrivate 
                    ? '-translate-y-full opacity-0 absolute' 
                    : 'translate-y-0 opacity-100'
                  }
                `}
              >
                Public Mode
              </button>
              {/* Private Mode Text */}
              <button
                onClick={handleToggle}
                disabled={!privateEnabled && !isPrivate}
                className={`${isCompact ? 'text-lg' : 'text-xl'} font-medium text-[#00E5C0] whitespace-nowrap transition-all duration-300 ease-in-out cursor-pointer hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50
                  ${isPrivate 
                    ? 'translate-y-0 opacity-100' 
                    : 'translate-y-full opacity-0 absolute'
                  }
                `}
              >
                Private Mode
              </button>
            </div>
            {/* Helper text */}
            <span className={`${isCompact ? 'text-[10px]' : 'text-xs'} text-muted-foreground/60`}>
              ← click here to change mode
            </span>
          </div>
        </div>
        
        {/* Right: Status message - same for both compact and expanded */}
        {isProtected && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`flex items-center gap-1 ${isCompact ? 'text-[10px]' : 'text-xs'} font-medium text-[#00E5C0] cursor-help`}>
                  <Check className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                  <span>Encrypted.</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={isCompact ? "px-2 py-1" : ""}>
                <p className={isCompact ? "text-[10px]" : "text-xs"}>{isCompact ? "Untraceable" : "You're untraceable"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {isExposed && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`flex items-center gap-1 ${isCompact ? 'text-[10px]' : 'text-xs'} font-medium text-[#F2C94C] cursor-help`}>
                  <AlertTriangle className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-[#F2C94C]`} />
                  <span>Exposed.</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={isCompact ? "px-2 py-1 max-w-[120px]" : "max-w-[200px]"}>
                <p className={isCompact ? "text-[10px] whitespace-normal" : "text-xs"}>Your transactions are publicly visible on the blockchain. Encrypt your balance to enable Private Mode.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Mode Switch Confirmation Dialog */}
      <ModeSwitchConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handleConfirmSwitch}
        isCompact={isCompact}
      />
    </div>
  );
}
