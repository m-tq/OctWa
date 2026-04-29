import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, AlertTriangle, Server, Zap, Loader2 } from 'lucide-react';
import { Wallet, Transaction } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { pvacServerService } from '@/services/pvacServerService';
import { sendTransaction, fetchBalance, fetchEncryptedBalance, invalidateCacheAfterEncrypt, fetchRecommendedFee } from '@/utils/api';
import { ensurePvacRegistered } from '@/utils/ensurePvacRegistered';

interface EncryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  publicBalance: number;
  onSuccess: () => void;
  onBalanceUpdate?: (newBalance: number) => void;
  onEncryptedBalanceUpdate?: (encryptedBalance: any) => void;
  isPopupMode?: boolean;
  isInline?: boolean;
}

export function EncryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet,
  publicBalance, 
  onSuccess,
  onBalanceUpdate,
  onEncryptedBalanceUpdate,
  isPopupMode = false,
  isInline = false
}: EncryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [usePvacServer, setUsePvacServer] = useState(false);
  const [isPvacAvailable, setIsPvacAvailable] = useState(false);
  const [recommendedFee, setRecommendedFee] = useState(3000); // encrypt default
  const [customFee, setCustomFee] = useState('');
  const { toast } = useToast();
  
  // Check PVAC availability when dialog opens + fetch dynamic fee
  useEffect(() => {
    if (open) {
      const available = pvacServerService.isEnabled();
      setIsPvacAvailable(available);
      setUsePvacServer(available);
      // Always refetch to get latest fee from node
      fetchRecommendedFee('encrypt').then(fee => setRecommendedFee(fee)).catch(() => {});
    }
  }, [open]);

  const effectiveFee = customFee ? (parseInt(customFee) || recommendedFee) : recommendedFee;
  // Reserve = effectiveFee OU converted to OCT + small buffer
  const feeReserveOct = (effectiveFee / 1_000_000) + 0.0001;
  
  const handleTxModalOpenChange = (open: boolean) => {
    setShowTxModal(open);
    if (!open) {
      setTxModalStatus('idle');
    }
  };

  const maxEncryptable = Math.max(0, publicBalance - feeReserveOct);

  const handleEncrypt = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to encrypt",
        variant: "destructive",
      });
      return;
    }

    const amountToEncrypt = parseFloat(amount);
    if (amountToEncrypt > maxEncryptable) {
      toast({
        title: "Insufficient Balance",
        description: "Amount exceeds available balance (after fees)",
        variant: "destructive",
      });
      return;
    }

    setIsEncrypting(true);
    setShowTxModal(true);
    setTxModalStatus('sending');

    try {
      if (usePvacServer && isPvacAvailable) {
        await handleEncryptWithPvac(amountToEncrypt);
      } else {
        await handleEncryptWithBrowser(amountToEncrypt);
      }
    } catch (error: any) {
      console.error('Encrypt failed:', error);
      setTxModalStatus('error');
      setTxModalResult({
        error: error.message || 'Failed to encrypt balance'
      });
      
      toast({
        title: "Encryption Failed",
        description: error.message || 'Failed to encrypt balance',
        variant: "destructive",
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleEncryptWithPvac = async (amountToEncrypt: number) => {
    try {
      // Ensure PVAC pubkey is registered on the node before encrypting
      const regResult = await ensurePvacRegistered(
        wallet.address,
        wallet.privateKey,
        wallet.publicKey || ''
      );
      if (!regResult.success) {
        throw new Error(regResult.error || 'Failed to register PVAC pubkey on node');
      }

      // Convert amount to raw units (1 OCT = 1,000,000 raw units)
      const amountRaw = Math.floor(amountToEncrypt * 1_000_000);
      
      // Fetch fresh nonce from blockchain
      const freshBalanceData = await fetchBalance(wallet.address);
      const currentNonce = freshBalanceData.nonce;

      // Call PVAC server to encrypt balance
      const result = await pvacServerService.encryptBalance({
        amount: amountRaw,
        private_key: wallet.privateKey,
        public_key: wallet.publicKey || '',
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
        amount: amountToEncrypt.toFixed(8)
      });

      toast({
        title: "Encryption Successful",
        description: `Encrypted ${amountToEncrypt} OCT and submitted to blockchain`,
      });

      // Reset form
      setAmount('');

      // Immediately invalidate cache and refresh both balances
      try {
        await invalidateCacheAfterEncrypt(wallet.address);
        const [freshBalance, freshEncrypted] = await Promise.all([
          fetchBalance(wallet.address, true),
          fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
        ]);
        if (onBalanceUpdate) onBalanceUpdate(freshBalance.balance);
        if (onEncryptedBalanceUpdate && freshEncrypted) onEncryptedBalanceUpdate(freshEncrypted);
        onSuccess();
      } catch (error) {
        console.error('[Encrypt] Failed to refresh balance:', error);
        onSuccess();
      }
            
    } catch (error: any) {
      console.error('[Encrypt] Error:', error);
      
      // If PVAC fails with connection error, fallback to browser
      if (error.message.includes('Cannot connect')) {
        toast({
          title: "PVAC Server Unavailable",
          description: "Falling back to browser-based encryption...",
        });
        await handleEncryptWithBrowser(amountToEncrypt);
      } else {
        throw error;
      }
    }
  };

  const handleEncryptWithBrowser = async (_amountToEncrypt: number) => {
    // Browser-based encryption (slower fallback)
    toast({
      title: "Using Browser Encryption",
      description: "This may take longer. Consider using PVAC server for faster operations.",
    });
    
    // Simulate browser-based encryption
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // TODO: Implement actual browser-based encryption
    toast({
      title: "Coming Soon",
      description: "Browser-based encrypted balance feature will be available in a future release.",
      variant: "default",
    });
    
    setTxModalStatus('error');
    setTxModalResult({
      error: 'Browser-based encryption not yet implemented. Please use PVAC server.'
    });
  };

  const content = showTxModal ? (
    <TransactionModal
      open={showTxModal}
      onOpenChange={handleTxModalOpenChange}
      status={txModalStatus}
      result={txModalResult}
      type="encrypt"
      isPopupMode={isPopupMode}
    />
  ) : (
    <div className={isPopupMode ? "space-y-3" : "space-y-4 pt-8"}>
      {/* Animated Icon - in inline mode */}
      {isInline && (
        <AnimatedIcon type="encrypt" size="sm" />
      )}

      {/* Description text - no border, aligned with icon */}
      {isPopupMode && isInline ? (
        <p className="text-xs text-center text-[#00E5C0]">
          Convert public OCT to private OCT.
        </p>
      ) : isInline ? (
        <p className="text-sm text-center text-[#00E5C0]">
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

      <div className={isPopupMode ? "space-y-1 pt-4" : "space-y-2 pt-10"}>
        <div className="flex items-center justify-between">
          <Label htmlFor="encrypt-amount" className={isPopupMode ? "text-xs" : ""}>Amount to Encrypt</Label>
          <div className={`flex items-center gap-2 ${isPopupMode ? 'text-xs' : 'text-sm'}`}>
            <span className="text-muted-foreground">
              Balance: <span className="font-mono">{maxEncryptable.toFixed(4)}</span>
            </span>
            <button
              type="button"
              onClick={() => setAmount(maxEncryptable.toFixed(8))}
              className="text-[#00E5C0] hover:text-[#6C63FF]/80 font-medium hover:underline"
              disabled={isEncrypting || maxEncryptable <= 0}
            >
              Max
            </button>
          </div>
        </div>
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
        <p className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
          ({feeReserveOct.toFixed(6)} OCT reserved for fees)
        </p>
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
          disabled={isEncrypting}
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
                {usePvacServer ? '~700ms' : '~10s'} encryption time
              </p>
            </div>
          </div>
          <Switch
            checked={usePvacServer}
            onCheckedChange={setUsePvacServer}
            disabled={isEncrypting}
          />
        </div>
      )}

      {/* Performance Info */}
      {usePvacServer && isPvacAvailable && !isInline && (
        <Alert className={isPopupMode ? 'py-2' : ''}>
          <Zap className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
          <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
            PVAC server will process this operation ~14x faster than browser-based encryption.
            Expected time: 500-1000ms
          </AlertDescription>
        </Alert>
      )}

      {/* PVAC Not Available Warning */}
      {!isPvacAvailable && !isInline && (
        <Alert variant="destructive" className={isPopupMode ? 'py-2' : ''}>
          <AlertTriangle className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
          <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
            PVAC server not configured. Browser-based encryption not yet available.
            Please configure PVAC server in settings.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isEncrypting}
          className={`flex-1 ${isPopupMode ? 'h-10 text-sm' : 'h-12 text-base'}`}
        >
          Cancel
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-1">
                <Button
                  onClick={handleEncrypt}
                  disabled={isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0 || (!isPvacAvailable && !usePvacServer)}
                  className={`w-full bg-[#00E5C0] hover:bg-[#00E5C0]/90 ${isPopupMode ? 'h-10 text-sm' : 'h-12 text-base'}`}
                >
                  {isEncrypting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} animate-spin`} />
                      <span>Encrypting...</span>
                    </div>
                  ) : (
                    <>
                      <Lock className={`${isPopupMode ? 'h-4 w-4 mr-1.5' : 'h-4 w-4 mr-2'}`} />
                      Encrypt {usePvacServer && isPvacAvailable && '(PVAC)'}
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
          <DialogDescription className="sr-only">
            Convert public OCT to private OCT for enhanced privacy
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
