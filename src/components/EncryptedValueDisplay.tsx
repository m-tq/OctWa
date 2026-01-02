/**
 * EncryptedValueDisplay - Displays encrypted values with lock icon and decrypt button
 * 
 * Requirements: 4.2, 4.3
 */

import { useState } from 'react';
import { Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EncryptedValue, isEncryptedValue, getDisplayValue } from '../types/encrypted';

interface EncryptedValueDisplayProps {
  /** The value to display (can be encrypted or plaintext) */
  value: EncryptedValue | number | string;
  /** Label for the value */
  label?: string;
  /** Callback when user requests decryption */
  onDecryptRequest?: (value: EncryptedValue) => void;
  /** Whether decryption is in progress */
  isDecrypting?: boolean;
  /** Custom locked text */
  lockedText?: string;
  /** Show/hide toggle for decrypted values */
  allowHide?: boolean;
  /** CSS class name */
  className?: string;
}

export function EncryptedValueDisplay({
  value,
  label,
  onDecryptRequest,
  isDecrypting = false,
  lockedText = 'Encrypted',
  allowHide = false,
  className = '',
}: EncryptedValueDisplayProps) {
  const [isHidden, setIsHidden] = useState(false);

  const isEncrypted = isEncryptedValue(value);
  const isDecrypted = isEncrypted && value.isDecrypted;
  const displayValue = getDisplayValue(value, `🔒 ${lockedText}`);

  const handleDecryptClick = () => {
    if (isEncrypted && !isDecrypted && onDecryptRequest) {
      onDecryptRequest(value);
    }
  };

  const toggleVisibility = () => {
    setIsHidden(!isHidden);
  };

  // Plaintext value - just display it
  if (!isEncrypted) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {label && <span className="text-muted-foreground text-sm">{label}:</span>}
        <span className="font-mono">{displayValue}</span>
      </div>
    );
  }

  // Encrypted but decrypted - show value with optional hide toggle
  if (isDecrypted) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {label && <span className="text-muted-foreground text-sm">{label}:</span>}
        <Unlock className="h-4 w-4 text-green-500" />
        <span className="font-mono">
          {isHidden ? '••••••' : displayValue}
        </span>
        {allowHide && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleVisibility}
            className="h-6 w-6 p-0"
          >
            {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  // Encrypted and not decrypted - show lock icon and decrypt button
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="text-muted-foreground text-sm">{label}:</span>}
      <Lock className="h-4 w-4 text-amber-500" />
      <span className="text-muted-foreground">{lockedText}</span>
      {onDecryptRequest && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDecryptClick}
          disabled={isDecrypting}
          className="h-6 px-2 text-xs"
        >
          {isDecrypting ? 'Decrypting...' : 'Decrypt'}
        </Button>
      )}
    </div>
  );
}
