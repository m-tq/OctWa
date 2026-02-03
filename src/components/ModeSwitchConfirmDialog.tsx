import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Shield, Globe } from 'lucide-react';

// Storage key for "don't remind me" preference
export const MODE_SWITCH_REMINDER_KEY = 'octra_mode_switch_reminder_disabled';

// Helper to check if reminder is disabled
export function isModeSwitchReminderDisabled(): boolean {
  return localStorage.getItem(MODE_SWITCH_REMINDER_KEY) === 'true';
}

// Helper to reset the reminder preference (for wallet reset)
export function resetModeSwitchReminder(): void {
  localStorage.removeItem(MODE_SWITCH_REMINDER_KEY);
}

interface ModeSwitchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isCompact?: boolean;
}

export function ModeSwitchConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  isCompact = false,
}: ModeSwitchConfirmDialogProps) {
  const [dontRemind, setDontRemind] = useState(false);

  const handleConfirm = () => {
    if (dontRemind) {
      localStorage.setItem(MODE_SWITCH_REMINDER_KEY, 'true');
    }
    onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={isCompact ? 'w-[340px] p-4' : 'max-w-md'}>
        <AlertDialogHeader className={isCompact ? 'pb-1' : ''}>
          <AlertDialogTitle
            className={`flex items-center gap-2 ${isCompact ? 'text-sm' : ''}`}
          >
            <AlertTriangle className={`${isCompact ? 'h-4 w-4' : 'h-5 w-5'} text-[#F2C94C]`} />
            Leaving Private Mode
          </AlertDialogTitle>
          <AlertDialogDescription
            className={`${isCompact ? 'space-y-2 pt-1' : 'space-y-3 pt-2'}`}
            asChild
          >
            <div>
              <p className={isCompact ? 'text-xs' : 'text-sm'}>
                You are about to switch to{' '}
                <span className="font-medium text-foreground">Public Mode</span>.
              </p>
              <div
                className={`flex items-start gap-2 ${isCompact ? 'p-2' : 'p-3'} bg-[#F2C94C]/10 dark:bg-[#F2C94C]/15 border border-[#F2C94C]/40 dark:border-[#F2C94C]/50`}
              >
                <AlertTriangle
                  className={`${isCompact ? 'h-3 w-3' : 'h-4 w-4'} text-[#F2C94C] mt-0.5 flex-shrink-0`}
                />
                <div
                  className={`${isCompact ? 'text-[10px]' : 'text-xs'} text-[#F2C94C] text-left`}
                >
                  <p className="font-medium mb-0.5">Important:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-left">
                    <li>Transactions will be publicly visible</li>
                    <li>Your balance will be exposed</li>
                    {!isCompact && <li>Past private transfers remain private</li>}
                  </ul>
                </div>
              </div>

              {/* Don't remind me checkbox */}
              <div className={`flex items-center gap-2 ${isCompact ? 'pt-1' : 'pt-2'}`}>
                <Checkbox
                  id="dont-remind"
                  checked={dontRemind}
                  onCheckedChange={(checked) => setDontRemind(checked === true)}
                  className={isCompact ? 'h-3.5 w-3.5' : ''}
                />
                <Label
                  htmlFor="dont-remind"
                  className={`${isCompact ? 'text-[10px]' : 'text-xs'} text-muted-foreground cursor-pointer`}
                >
                  Don't remind me again
                </Label>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2">
          <AlertDialogCancel
            className={`flex-1 flex items-center justify-center gap-1.5 mt-0 ${isCompact ? 'h-8 text-xs' : ''}`}
          >
            <Shield className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            Stay Private
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={`flex-1 bg-[#F2C94C] hover:bg-[#E5BF45] text-black ${isCompact ? 'h-8 text-xs' : ''}`}
          >
            <Globe className={`${isCompact ? 'h-3.5 w-3.5 mr-1' : 'h-4 w-4 mr-2'}`} />
            {isCompact ? 'Continue' : 'Continue to Public'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
