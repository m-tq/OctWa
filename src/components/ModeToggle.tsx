import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Globe, Shield, Lock } from 'lucide-react';
import { OperationMode } from '../utils/modeStorage';

interface ModeToggleProps {
  currentMode: OperationMode;
  onModeChange: (mode: OperationMode) => void;
  privateEnabled: boolean;
  encryptedBalance: number;
}

export function ModeToggle({ 
  currentMode, 
  onModeChange, 
  privateEnabled, 
  encryptedBalance 
}: ModeToggleProps) {
  const handleModeChange = (mode: OperationMode) => {
    if (mode === 'private' && !privateEnabled) {
      return; // Don't allow switching to private if not enabled
    }
    onModeChange(mode);
  };

  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      {/* Public Mode Button */}
      <Button
        variant={currentMode === 'public' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => handleModeChange('public')}
        className={`flex items-center gap-1.5 px-5 py-1.5 h-8 transition-all ${
          currentMode === 'public' 
            ? 'bg-background shadow-sm text-foreground border border-border' 
            : 'hover:bg-background/50 text-muted-foreground'
        }`}
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Public</span>
      </Button>

      {/* Private Mode Button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                variant={currentMode === 'private' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => handleModeChange('private')}
                disabled={!privateEnabled}
                className={`flex items-center gap-1.5 px-5 py-1.5 h-8 transition-all ${
                  currentMode === 'private'
                    ? 'bg-[#0000db] text-white hover:bg-[#0000db]/90 shadow-sm'
                    : privateEnabled
                      ? 'hover:bg-background/50 text-[#0000db]'
                      : 'opacity-50 cursor-not-allowed text-muted-foreground'
                }`}
              >
                {privateEnabled ? (
                  <Shield className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                <span className="text-xs font-medium">Private</span>
              </Button>
            </div>
          </TooltipTrigger>
          {!privateEnabled && (
            <TooltipContent side="bottom" className="max-w-[200px]">
              <p className="text-xs">
                Encrypt some OCT to access Private features
              </p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
