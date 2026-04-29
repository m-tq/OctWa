import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Unlock, AlertTriangle, Server, Zap, Loader2 } from 'lucide-react';
import { Wallet, Transaction } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { InfoTooltip } from './InfoTooltip';
import { pvacServerService } from '@/services/pvacServerService';
import { sendTransaction, fetchBalance, fetchEncryptedBalance, invalidateCacheAfterDecrypt, fetchRecommendedFee } from '@/utils/api';
import { ensurePvacRegistered } from '@/utils/ensurePvacRegistered';

interface DecryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  encryptedBalance: number;
  currentCipher?: string;
  onSuccess: () => void;
  onBalanceUpdate?: (newBalance: number) => void;
  onEncryptedBalanceUpdate?: (encryptedBalance: any) => void;
  isPopupMode?: boolean;
  isInline?: boolean;
}

export function DecryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet,
  encryptedBalance,
  currentCipher,
  onSuccess,
  onBalanceUpdate,
  onEncryptedBalanceUpdate,
  isPopupMode = false,
  isInline = false
}: DecryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [usePvacServer, setUsePvacServer] = useState(false);
  const [isPvacAvailable, setIsPvacAvailable] = useState(false);
  const [recommendedFee, setRecommendedFee] = useState(3000); // decrypt default
  const [customFee, setCustomFee] = useState('');
  const { toast } = useToast();
  
  // Check PVAC availability when dialog opens + fetch dynamic fee
  useEffect(() => {
    if (open) {
      const available = pvacServerService.isEnabled();
      setIsPvacAvailable(available);
      setUsePvacServer(available);
      // Always refetch to get latest fee from node
      fetchRecommendedFee('decrypt').then(fee => setRecommendedFee(fee)).catch(() => {});
    }
  }, [open]);

  const effectiveFee = customFee ? (parseInt(customFee) || recommendedFee) : recommendedFee;
  
  const handleTxModalOpenChange = (open: boolean) => {
    
    setShowTxModal(open);
    if (!open) {
      setTxModalStatus('idle');
      
    }
  };

  const handleDecrypt = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to decrypt",
        variant: "destructive",
      });
      return;
    }

    const amountToDecrypt = parseFloat(amount);
    if (amountToDecrypt > encryptedBalance) {
      toast({
        title: "Insufficient Balance",
        description: "Amount exceeds encrypted balance",
        variant: "destructive",
      });
      return;
    }

    setIsDecrypting(true);
    setShowTxModal(true);
    setTxModalStatus('sending');

    try {
      if (usePvacServer && isPvacAvailable) {
        await handleDecryptWithPvac(amountToDecrypt);
      } else {
        await handleDecryptWithBrowser(amountToDecrypt);
      }
    } catch (error: any) {
      console.error('Decrypt failed:', error);
      setTxModalStatus('error');
      setTxModalResult({
        error: error.message || 'Failed to decrypt balance'
      });
      
      toast({
        title: "Decryption Failed",
        description: error.message || 'Failed to decrypt balance',
        variant: "destructive",
      });
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleDecryptWithPvac = async (amountToDecrypt: number) => {
    try {
      // Ensure PVAC pubkey is registered on the node before decrypting
      const regResult = await ensurePvacRegistered(
        wallet.address,
        wallet.privateKey,
        wallet.publicKey || ''
      );
      if (!regResult.success) {
        throw new Error(regResult.error || 'Failed to register PVAC pubkey on node');
      }

      // Convert amount to raw units (1 OCT = 1,000,000 raw units)
      const amountRaw = Math.floor(amountToDecrypt * 1_000_000);
      
      // Fetch fresh nonce from blockchain
      const freshBalanceData = await fetchBalance(wallet.address);
      const currentNonce = freshBalanceData.nonce;

      // Get current encrypted balance cipher
      if (!currentCipher || currentCipher === '0' || !currentCipher.startsWith('hfhe_v1|')) {
        throw new Error('No valid encrypted balance cipher available. Please encrypt some balance first.');
      }

      // Call PVAC server to decrypt balance to public
      const result = await pvacServerService.decryptToPublic({
        amount: amountRaw,
        private_key: wallet.privateKey,
        public_key: wallet.publicKey || '',
        current_cipher: currentCipher,
        address: wallet.address,
        nonce: currentNonce + 1,
        ou: String(effectiveFee)
      });

      if (!result.success) {
        throw new Error(result.error || 'PVAC server returned error');
      }

      if (!result.tx) {
        throw new Error('PVAC server did not return transaction data');
      }

      const submitResult = await sendTransaction(result.tx as Transaction);

      if (!submitResult.success) {
        throw new Error(submitResult.error || 'Failed to submit transaction to blockchain');
      }

      const txHash = submitResult.hash || 'unknown';
      
      setTxModalStatus('success');
      setTxModalResult({
        hash: txHash,
        amount: amountToDecrypt.toFixed(8)
      });

      toast({
        title: "Decryption Successful",
        description: `Decrypted ${amountToDecrypt} OCT and submitted to blockchain`,
      });

      // Reset form
      setAmount('');

      // Immediately refresh both balances after successful decrypt
      try {
        await invalidateCacheAfterDecrypt(wallet.address);
        const [freshBalance, freshEncrypted] = await Promise.all([
          fetchBalance(wallet.address, true),
          fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
        ]);
        if (onBalanceUpdate) onBalanceUpdate(freshBalance.balance);
        if (onEncryptedBalanceUpdate && freshEncrypted) onEncryptedBalanceUpdate(freshEncrypted);
        onSuccess();
      } catch (error) {
        console.error('[Decrypt] Failed to refresh balance:', error);
        onSuccess();
      }
            
    } catch (error: any) {
      console.error('[Decrypt] Error:', error);
      
      // If PVAC fails with connection error, fallback to browser
      if (error.message.includes('Cannot connect')) {
        toast({
          title: "PVAC Server Unavailable",
          description: "Falling back to browser-based decryption...",
        });
        await handleDecryptWithBrowser(amountToDecrypt);
      } else {
        throw error;
      }
    }
  };

  const handleDecryptWithBrowser = async (_amountToDecrypt: number) => {
    // Browser-based decryption (slower fallback)
    toast({
      title: "Using Browser Decryption",
      description: "This may take longer. Consider using PVAC server for faster operations.",
    });
    
    // Simulate browser-based decryption
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // TODO: Implement actual browser-based decryption
    toast({
      title: "Coming Soon",
      description: "Browser-based encrypted balance feature will be available in a future release.",
      variant: "default",
    });
    
    setTxModalStatus('error');
    setTxModalResult({
      error: 'Browser-based decryption not yet implemented. Please use PVAC server.'
    });
  };

  const content = showTxModal ? (
    <TransactionModal
      open={showTxModal}
      onOpenChange={handleTxModalOpenChange}
      status={txModalStatus}
      result={txModalResult}
      type="decrypt"
      isPopupMode={isPopupMode}
    />
  ) : (
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

      {/* Network Fee */}
      <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
        <div className="flex items-center justify-between">
          <Label className={isPopupMode ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
            Network Fee (OU)
          </Label>
          <span className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
            Recommended: <span className="font-mono text-[#00E5C0]">{recommendedFee.toLocaleString()}</span>
            <span className="ml-1">≈ {(recommendedFee / 1_000_000).toFixed(6)} OCT</span>
          </span>
        </div>
        <Input
          type="number"
          placeholder={String(recommendedFee)}
          value={customFee}
          onChange={(e) => setCustomFee(e.target.value)}
          min="1"
          disabled={isDecrypting}
          className={`font-mono ${isPopupMode ? 'h-9 text-xs' : ''}`}
        />
      </div>

      {/* PVAC Server Option */}
      {isPvacAvailable && !isInline && (
        <div className={`flex items-center justify-between p-3 bg-muted/50 rounded-lg ${isPopupMode ? 'py-2' : ''}`}>
          <div className="flex items-center gap-2">
            <Server className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} text-primary`} />
            <div>
              <Label className={`${isPopupMode ? 'text-xs' : 'text-sm'} font-medium cursor-pointer`}>
                Use PVAC Server
              </Label>
              <p className={`${isPopupMode ? 'text-[10px]' : 'text-xs'} text-muted-foreground`}>
                {usePvacServer ? '~500ms' : '~5s'} decryption time
              </p>
            </div>
          </div>
          <Switch
            checked={usePvacServer}
            onCheckedChange={setUsePvacServer}
            disabled={isDecrypting}
          />
        </div>
      )}

      {/* Performance Info */}
      {usePvacServer && isPvacAvailable && !isInline && (
        <Alert className={isPopupMode ? 'py-2' : ''}>
          <Zap className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
          <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
            PVAC server will process this operation ~10x faster than browser-based decryption.
            Expected time: 500-1000ms
          </AlertDescription>
        </Alert>
      )}

      {/* PVAC Not Available Warning */}
      {!isPvacAvailable && !isInline && (
        <Alert variant="destructive" className={isPopupMode ? 'py-2' : ''}>
          <AlertTriangle className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
          <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
            PVAC server not configured. Browser-based decryption not yet available.
            Please configure PVAC server in settings.
          </AlertDescription>
        </Alert>
      )}

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
          disabled={isDecrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > encryptedBalance || (!isPvacAvailable && !usePvacServer)}
          className={`flex-1 ${isPopupMode ? 'h-10 text-sm' : 'h-12 text-base'}`}
        >
          {isDecrypting ? (
            <div className="flex items-center gap-2">
              <Loader2 className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} animate-spin`} />
              <span>Decrypting...</span>
            </div>
          ) : (
            <>
              <Unlock className={`${isPopupMode ? 'h-4 w-4 mr-1.5' : 'h-4 w-4 mr-2'}`} />
              Decrypt {usePvacServer && isPvacAvailable && '(PVAC)'}
            </>
          )}
        </Button>
      </div>

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
