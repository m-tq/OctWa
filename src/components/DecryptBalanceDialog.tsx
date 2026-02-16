import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Unlock, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { decryptBalance, invalidateCacheAfterDecrypt } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { InfoTooltip } from './InfoTooltip';

interface DecryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  encryptedBalance: number;
  onSuccess: () => void;
  isPopupMode?: boolean;
  isInline?: boolean;
}

export function DecryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet, 
  encryptedBalance, 
  onSuccess,
  isPopupMode = false,
  isInline = false
}: DecryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const { toast } = useToast();

  const handleDecrypt = async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (amountNum > encryptedBalance) {
      toast({
        title: "Error",
        description: `Amount too large. Maximum: ${encryptedBalance.toFixed(6)} OCT`,
        variant: "destructive",
      });
      return;
    }

    setIsDecrypting(true);
    
    // Show modal with sending state
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);
    
    try {
      const result = await decryptBalance(wallet.address, amountNum, wallet.privateKey);
      
      if (result.success) {
        // Invalidate cache after decrypt
        await invalidateCacheAfterDecrypt(wallet.address);
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
      setTxModalResult({ error: "Failed to decrypt balance" });
    } finally {
      setIsDecrypting(false);
    }
  };

  const content = (
    <div className={isPopupMode ? "space-y-3" : "space-y-4 pt-8"}>
      {/* Animated Icon - in inline mode */}
      {isInline && (
        <div className="text-muted-foreground">
          <AnimatedIcon type="decrypt" size="sm" />
        </div>
      )}

      {/* Description text - no border, aligned with icon */}
      {isPopupMode && isInline ? (
        <p className="text-xs text-center text-muted-foreground">
          Convert private OCT back to public OCT.
        </p>
      ) : isInline ? (
        <p className="text-sm text-center text-muted-foreground">
          Convert private OCT back to public OCT.
        </p>
      ) : (
        <div className={`flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 ${isPopupMode ? "py-2" : "py-3"}`}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-orange-500 mt-0.5" />
          <div className="flex-1">
            <span className={`text-orange-800 dark:text-orange-200 ${isPopupMode ? "text-xs leading-normal" : "text-sm"}`}>
              {isPopupMode ? "Convert private OCT back to public OCT." : "Decrypting balance converts private OCT back to public OCT."}
            </span>
            <p className={`text-orange-600 dark:text-orange-300 mt-1 ${isPopupMode ? "text-[10px]" : "text-xs"}`}>
              Your decrypted balance will be visible on the blockchain.
            </p>
          </div>
        </div>
      )}

      <div className={isPopupMode ? "space-y-1 pt-4" : "space-y-2 pt-6"}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Label htmlFor="decrypt-amount" className={isPopupMode ? "text-xs" : ""}>Amount to Decrypt</Label>
            <InfoTooltip 
              content="The amount you decrypt will become publicly visible on the blockchain."
              side="top"
            />
          </div>
          <div className={`flex items-center gap-2 ${isPopupMode ? 'text-xs' : 'text-sm'}`}>
            <span className="text-muted-foreground">
              Balance: <span className="font-mono">{encryptedBalance.toFixed(4)}</span>
            </span>
            <button
              type="button"
              onClick={() => setAmount(encryptedBalance.toFixed(8))}
              className="text-[#00E5C0] hover:text-[#6C63FF]/80 font-medium hover:underline"
              disabled={isDecrypting || encryptedBalance <= 0}
            >
              Max
            </button>
          </div>
        </div>
        <Input
          id="decrypt-amount"
          type="number"
          placeholder="0.00000000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.1"
          min="0"
          max={encryptedBalance}
          disabled={isDecrypting}
          className={isPopupMode ? "h-9 text-sm" : ""}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isDecrypting}
          className={`flex-1 ${isPopupMode ? 'h-10 text-sm' : 'h-12 text-base'}`}
        >
          Cancel
        </Button>
        <Button
          onClick={handleDecrypt}
          disabled={isDecrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > encryptedBalance}
          className={`flex-1 bg-muted text-muted-foreground hover:bg-muted/80 ${isPopupMode ? 'h-10 text-sm' : 'h-12 text-base'}`}
        >
          {isDecrypting ? (
            <div className="flex items-center gap-2">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
              </div>
              <span>Decrypting...</span>
            </div>
          ) : (
            <>
              <Unlock className={`${isPopupMode ? 'h-4 w-4 mr-1.5' : 'h-4 w-4 mr-2'}`} />
              Decrypt
            </>
          )}
        </Button>
      </div>

      {/* Transaction Modal */}
      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        status={txModalStatus}
        result={txModalResult}
        type="decrypt"
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
            <Unlock className={isPopupMode ? "h-4 w-4" : "h-5 w-5"} />
            Decrypt Balance
          </DialogTitle>
          <DialogDescription className="sr-only">
            Convert private OCT back to public OCT
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
