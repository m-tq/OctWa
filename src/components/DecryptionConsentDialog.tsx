/**
 * DecryptionConsentDialog - Dialog for explicit user consent before decryption
 * 
 * Requirements: 4.4
 */

import React from 'react';
import { Lock, AlertTriangle } from 'lucide-react';
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
import { EncryptedValue } from '../types/encrypted';

interface DecryptionConsentDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void;
  /** The encrypted value being decrypted */
  value?: EncryptedValue;
  /** Callback when user consents to decryption */
  onConsent: () => void;
  /** Callback when user denies decryption */
  onDeny: () => void;
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
}

export function DecryptionConsentDialog({
  open,
  onOpenChange,
  value,
  onConsent,
  onDeny,
  title = 'Decrypt Sensitive Data',
  description,
}: DecryptionConsentDialogProps) {
  const typeHint = value?.typeHint || 'unknown';
  
  const getTypeDescription = () => {
    switch (typeHint) {
      case 'balance':
        return 'balance information';
      case 'message':
        return 'message content';
      case 'contract_result':
        return 'contract execution result';
      default:
        return 'encrypted data';
    }
  };

  const defaultDescription = `You are about to decrypt ${getTypeDescription()}. This action requires your explicit consent. The decrypted data will be visible on screen.`;

  const handleConsent = () => {
    onConsent();
    onOpenChange(false);
  };

  const handleDeny = () => {
    onDeny();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-500" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>{description || defaultDescription}</p>
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-md border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Make sure no one is watching your screen before proceeding.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDeny}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConsent}>
            I Consent - Decrypt
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
