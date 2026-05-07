import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { Wallet, Transaction, EncryptedBalanceResponse } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { PvacOperationModal } from './PvacOperationModal';
import { FeeSelector, FeeOption, getEffectiveFee } from './FeeSelector';
import { sendTransaction, fetchBalance, fetchEncryptedBalance, invalidateCacheAfterEncrypt, fetchRecommendedFee } from '@/utils/api';
import { usePvacOperation } from '@/hooks/usePvacOperation';

interface EncryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  publicBalance: number;
  /** Called after tx confirmed + balances refreshed. Receives fresh data for immediate cache update. */
  onSuccess: (freshPublic: number, freshEnc: EncryptedBalanceResponse | null, freshNonce: number) => void;
  onBalanceUpdate?: (newBalance: number) => void;
  onEncryptedBalanceUpdate?: (encryptedBalance: EncryptedBalanceResponse | null) => void;
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
  const [showPvacModal, setShowPvacModal] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [recommendedFee, setRecommendedFee] = useState(3000);
  const [feeOption, setFeeOption] = useState<FeeOption>('recommended');
  const [customFee, setCustomFee] = useState('');
  const { toast } = useToast();
  const pvacOp = usePvacOperation();

  useEffect(() => {
    if (open) {
      fetchRecommendedFee('encrypt').then(fee => setRecommendedFee(fee)).catch(() => {});
    }
  }, [open]);

  const effectiveFee = getEffectiveFee(recommendedFee, feeOption, customFee);
  const feeReserveOct = (effectiveFee / 1_000_000) + 0.0001;
  
  const handleTxModalOpenChange = (open: boolean) => {
    setShowTxModal(open);
    if (!open) {
      setTxModalStatus('idle');
    }
  };

  const maxEncryptable = Math.max(0, publicBalance - feeReserveOct);

  // Shared helper: submit a signed tx and refresh balances
  const submitAndRefresh = async (tx: Transaction, amountToEncrypt: number) => {
    const submitResult = await sendTransaction(tx);

    if (!submitResult.success) {
      throw new Error(submitResult.error || 'Failed to submit transaction to blockchain');
    }

    const txHash = submitResult.hash || 'unknown';

    // Close pvac modal, show tx result modal
    setShowPvacModal(false);
    setShowTxModal(true);
    setTxModalStatus('success');
    setTxModalResult({ hash: txHash, amount: amountToEncrypt.toFixed(8) });

    toast({ title: "Encryption Successful", description: `Encrypted ${amountToEncrypt} OCT` });
    setAmount('');

    try {
      await invalidateCacheAfterEncrypt(wallet.address);
      const [freshBalance, freshEncrypted] = await Promise.all([
        fetchBalance(wallet.address, true),
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
      ]);
      if (onBalanceUpdate) onBalanceUpdate(freshBalance.balance);
      if (onEncryptedBalanceUpdate && freshEncrypted) onEncryptedBalanceUpdate(freshEncrypted);
      onSuccess(freshBalance.balance, freshEncrypted, freshBalance.nonce);
    } catch {
      onSuccess(publicBalance, null, 0);
    }
  };

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
    setShowPvacModal(true);  // show fullscreen operation modal
    pvacOp.reset();

    try {
      const amountRaw = BigInt(Math.floor(amountToEncrypt * 1_000_000));
      const freshBalanceData = await fetchBalance(wallet.address);
      const currentNonce = freshBalanceData.nonce;

      const result = await pvacOp.runWorker<{ tx: Transaction }>('encryptBalance', {
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey || '',
        address: wallet.address,
        amountRaw: amountRaw.toString(),
        nonce: currentNonce + 1,
        ou: String(effectiveFee),
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Encryption failed');
      }

      await submitAndRefresh(result.data.tx as Transaction, amountToEncrypt);
    } catch (error) {
      console.error('Encrypt failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to encrypt balance';
      setTxModalStatus('error');
      setTxModalResult({ error: msg });
      toast({ title: "Encryption Failed", description: msg, variant: "destructive" });
    } finally {
      setIsEncrypting(false);
    }
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
      </div>

      {/* Network Fee */}
      <div className={isPopupMode ? "space-y-1" : "space-y-1.5"}>
        <Label className={isPopupMode ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          Network Fee
        </Label>
        <FeeSelector
          recommendedFee={recommendedFee}
          feeOption={feeOption}
          customFee={customFee}
          onFeeOptionChange={setFeeOption}
          onCustomFeeChange={setCustomFee}
          disabled={isEncrypting}
          isPopupMode={isPopupMode}
        />
      </div>

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
                  disabled={isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0}
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
                      Encrypt
                    </>
                  )}
                </Button>
              </div>
            </TooltipTrigger>
            {!isEncrypting && (!amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0) && (
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
    return (
      <>
        {showPvacModal && (
          <PvacOperationModal
            opType="encrypt"
            {...pvacOp}
            onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
          />
        )}
        {content}
      </>
    );
  }

  return (
    <>
      {/* Fullscreen PVAC operation modal — shown during crypto work */}
      {showPvacModal && (
        <PvacOperationModal
          opType="encrypt"
          {...pvacOp}
          onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
        />
      )}
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
    </>
  );
}
