import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Unlock, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { decryptBalance, invalidateCacheAfterDecrypt } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';

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
    <div className={isPopupMode ? "space-y-3" : "space-y-4"}>
      {/* Animated Icon - only in popup inline mode */}
      {isPopupMode && isInline && (
        <AnimatedIcon type="decrypt" size="sm" />
      )}

      {/* Description text - no border, aligned with icon */}
      {isPopupMode && isInline ? (
        <p className="text-xs text-center text-[#0000db]">
          Convert private OCT back to public OCT.
        </p>
      ) : (
        <div className={`flex items-center gap-2 ${isPopupMode ? "py-2" : "py-3"}`}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-500" />
          <span className={`text-muted-foreground ${isPopupMode ? "text-xs leading-normal" : "text-sm"}`}>
            {isPopupMode ? "Convert private OCT back to public OCT." : "Decrypting balance converts private OCT back to public OCT."}
          </span>
        </div>
      )}

      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <Label className={isPopupMode ? "text-xs" : ""}>Current Private Balance</Label>
        <div className={`bg-[#0000db]/5 border border-[#0000db]/20  font-mono text-[#0000db] ${isPopupMode ? 'p-2 text-xs' : 'p-3'}`}>
          {encryptedBalance.toFixed(8)} OCT
        </div>
      </div>

      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <Label htmlFor="decrypt-amount" className={isPopupMode ? "text-xs" : ""}>Amount to Decrypt</Label>
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
          className={`flex-1 ${isPopupMode ? 'h-10 text-sm' : ''}`}
        >
          Cancel
        </Button>
        <Button
          onClick={handleDecrypt}
          disabled={isDecrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > encryptedBalance}
          className={`flex-1 bg-[#0000db] hover:bg-[#0000db]/90 ${isPopupMode ? 'h-10 text-sm' : ''}`}
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
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
