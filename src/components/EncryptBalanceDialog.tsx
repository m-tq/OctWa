import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { encryptBalance, invalidateCacheAfterEncrypt } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';

interface EncryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  publicBalance: number;
  onSuccess: () => void;
  isPopupMode?: boolean;
  isInline?: boolean;
}

export function EncryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet, 
  publicBalance, 
  onSuccess,
  isPopupMode = false,
  isInline = false
}: EncryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const { toast } = useToast();

  const maxEncryptable = Math.max(0, publicBalance - 0.001); // Reserve 0.001 OCT for fees

  const handleEncrypt = async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (amountNum > maxEncryptable) {
      toast({
        title: "Error",
        description: `Amount too large. Maximum: ${maxEncryptable.toFixed(6)} OCT`,
        variant: "destructive",
      });
      return;
    }

    setIsEncrypting(true);
    
    // Show modal with sending state
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);
    
    try {
      const result = await encryptBalance(wallet.address, amountNum, wallet.privateKey);
      
      if (result.success) {
        // Invalidate cache after encrypt
        await invalidateCacheAfterEncrypt(wallet.address);
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ hash: result.tx_hash, amount: amountNum.toFixed(8) });
        setAmount('');
        onSuccess();
      } else {
        // Update modal to error state
        setTxModalStatus('error');
        setTxModalResult({ error: result.error || "Unknown error occurred" });
      }
    } catch (error) {
      // Update modal to error state
      setTxModalStatus('error');
      setTxModalResult({ error: "Failed to encrypt balance" });
    } finally {
      setIsEncrypting(false);
    }
  };

  const content = (
    <div className={isPopupMode ? "space-y-3" : "space-y-4"}>
      {/* Animated Icon - in inline mode */}
      {isInline && (
        <AnimatedIcon type="encrypt" size="sm" />
      )}

      {/* Description text - no border, aligned with icon */}
      {isPopupMode && isInline ? (
        <p className="text-xs text-center text-muted-foreground">
          Convert public OCT to private OCT.
        </p>
      ) : isInline ? (
        <p className="text-sm text-center text-muted-foreground">
          Convert public OCT to private OCT.
        </p>
      ) : (
        <div className={`flex items-center gap-2 ${isPopupMode ? "py-2" : "py-3"}`}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-500" />
          <span className={`text-muted-foreground ${isPopupMode ? "text-xs leading-normal" : "text-sm"}`}>
            {isPopupMode ? "Convert public OCT to private OCT." : "Encrypting balance converts public OCT to private OCT."}
          </span>
        </div>
      )}

      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <Label className={isPopupMode ? "text-xs" : ""}>Current Public Balance</Label>
        <div className={`bg-muted  font-mono ${isPopupMode ? 'p-2 text-xs' : 'p-3'}`}>
          {publicBalance.toFixed(8)} OCT
        </div>
      </div>

      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <Label className={isPopupMode ? "text-xs" : ""}>Maximum Encryptable</Label>
        <div className={`bg-muted  font-mono ${isPopupMode ? 'p-2 text-xs' : 'p-3'}`}>
          {maxEncryptable.toFixed(8)} OCT
        </div>
        <p className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
          (0.001 OCT reserved for fees)
        </p>
      </div>

      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <Label htmlFor="encrypt-amount" className={isPopupMode ? "text-xs" : ""}>Amount to Encrypt</Label>
        <Input
          id="encrypt-amount"
          type="number"
          placeholder="0.00000000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.1"
          min="0"
          max={maxEncryptable}
          disabled={isEncrypting}
          className={isPopupMode ? "h-9 text-sm" : ""}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isEncrypting}
          className={`flex-1 ${isPopupMode ? 'h-10 text-sm' : ''}`}
        >
          Cancel
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-1">
                <Button
                  onClick={handleEncrypt}
                  disabled={isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0}
                  className={`w-full ${isPopupMode ? 'h-10 text-sm' : ''}`}
                >
                  {isEncrypting ? (
                    <div className="flex items-center gap-2">
                      <div className="relative w-4 h-4">
                        <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
                      </div>
                      <span>Encrypting...</span>
                    </div>
                  ) : (
                    <>
                      <Lock className={`${isPopupMode ? 'h-4 w-4 mr-1.5' : 'h-4 w-4 mr-2'}`} />
                      Encrypt
                    </>
                  )}
                </Button>
              </div>
            </TooltipTrigger>
            {(isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0) && !isEncrypting && (
              <TooltipContent side="top" className="max-w-[250px]">
                <p className="text-xs">
                  {maxEncryptable <= 0 
                    ? "Insufficient balance. Need at least 0.001 OCT for fees."
                    : !amount || parseFloat(amount) <= 0
                      ? "Enter an amount to encrypt"
                      : parseFloat(amount) > maxEncryptable
                        ? `Amount exceeds maximum (${maxEncryptable.toFixed(6)} OCT)`
                        : ""}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Transaction Modal */}
      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        status={txModalStatus}
        result={txModalResult}
        type="encrypt"
        isPopupMode={isPopupMode}
      />
    </div>
  );

  // Inline mode - render content directly without Dialog wrapper
  if (isInline) {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isPopupMode ? "w-[320px] p-3" : "sm:max-w-md"}>
        <DialogHeader className={isPopupMode ? "pb-2" : ""}>
          <DialogTitle className={`flex items-center gap-2 ${isPopupMode ? 'text-sm' : ''}`}>
            <Lock className={isPopupMode ? "h-4 w-4" : "h-5 w-5"} />
            Encrypt Balance
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
