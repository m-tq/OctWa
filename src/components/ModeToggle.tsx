import { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Globe, Shield, Check, AlertTriangle } from 'lucide-react';
import { OperationMode } from '../utils/modeStorage';
import { ModeSwitchConfirmDialog, isModeSwitchReminderDisabled } from './ModeSwitchConfirmDialog';
import { InfoTooltip } from './InfoTooltip';

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
                            ? 'shadow-[0_0_12px_4px_rgba(0,0,219,0.4)] bg-[#0000db]/10'
                            : 'shadow-[0_0_30px_8px_rgba(0,0,219,0.5)] bg-[#0000db]/10' 
                          : isCompact
                            ? 'shadow-[0_0_10px_3px_rgba(0,0,0,0.12)] dark:shadow-[0_0_10px_3px_rgba(255,255,255,0.12)] bg-muted/40'
                            : 'shadow-[0_0_25px_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_25px_6px_rgba(255,255,255,0.15)] bg-muted/40'
                      }`}
                    />

                    {/* Rotating ring */}
                    <div 
                      className={`absolute inset-0 rounded-full border-2 border-transparent animate-spin ${
                        isPrivate ? 'border-t-[#0000db]/60' : 'border-t-foreground/40'
                      }`}
                      style={{ animationDuration: '3s' }}
                    />

                    {/* Inner circle background */}
                    <div 
                      className={`absolute inset-2 rounded-full transition-all duration-300 ${
                        isPrivate 
                          ? 'bg-[#0000db] border-2 border-[#0000db]' 
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
              <TooltipContent side="bottom">
                <p className="text-xs">{getTooltipText()}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Animated Status Text */}
          <div className={`relative overflow-hidden flex items-center ${isCompact ? 'h-7' : 'h-8'}`}>
            {/* Public Mode Text */}
            <span
              className={`${isCompact ? 'text-lg' : 'text-xl'} font-medium text-muted-foreground whitespace-nowrap transition-all duration-300 ease-in-out
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
              className={`${isCompact ? 'text-lg' : 'text-xl'} font-medium text-[#0000db] whitespace-nowrap transition-all duration-300 ease-in-out
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
        
        {/* Right: Status message - same for both compact and expanded */}
        {isProtected && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`flex items-center gap-1 ${isCompact ? 'text-[10px]' : 'text-xs'} font-medium text-[#0000db] cursor-help`}>
                  <Check className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                  <span>Encrypted.</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">You're untraceable</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {isExposed && (
          <div className={`flex items-center gap-1 ${isCompact ? 'text-[10px]' : 'text-xs'} font-medium text-orange-500`}>
            <AlertTriangle className={`${isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
            <span>Exposed.</span>
            <InfoTooltip
              content="Your transactions are publicly visible on the blockchain. Encrypt your balance to enable Private Mode."
              side="bottom"
              iconSize="sm"
            />
          </div>
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
