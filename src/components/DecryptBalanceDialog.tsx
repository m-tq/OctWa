import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Unlock, AlertTriangle, Loader2 } from 'lucide-react';
import { Wallet, Transaction, EncryptedBalanceResponse } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { PvacOperationModal } from './PvacOperationModal';
import { FeeSelector, FeeOption, getEffectiveFee } from './FeeSelector';
import { InfoTooltip } from './InfoTooltip';
import { sendTransaction, fetchBalance, fetchEncryptedBalance, invalidateCacheAfterDecrypt, fetchRecommendedFee } from '@/utils/api';
import { usePvacOperation } from '@/hooks/usePvacOperation';

interface DecryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  encryptedBalance: number;
  currentCipher?: string;
  /** Called after tx confirmed + balances refreshed. Receives fresh data for immediate cache update. */
  onSuccess: (freshPublic: number, freshEnc: EncryptedBalanceResponse | null, freshNonce: number) => void;
  onBalanceUpdate?: (newBalance: number) => void;
  onEncryptedBalanceUpdate?: (encryptedBalance: EncryptedBalanceResponse | null) => void;
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
      fetchRecommendedFee('decrypt').then(fee => setRecommendedFee(fee)).catch(() => {});
    }
  }, [open]);

  const effectiveFee = getEffectiveFee(recommendedFee, feeOption, customFee);
  
  const handleTxModalOpenChange = (open: boolean) => {
    setShowTxModal(open);
    if (!open) {
      setTxModalStatus('idle');
    }
  };

  // Shared helper: submit a signed tx and refresh balances
  const submitAndRefresh = async (tx: Transaction, amountToDecrypt: number) => {
    const submitResult = await sendTransaction(tx);
    if (!submitResult.success) {
      throw new Error(submitResult.error || 'Failed to submit transaction to blockchain');
    }
    const txHash = submitResult.hash || 'unknown';

    setShowPvacModal(false);
    setShowTxModal(true);
    setTxModalStatus('success');
    setTxModalResult({ hash: txHash, amount: amountToDecrypt.toFixed(8) });

    toast({ title: "Decryption Successful", description: `Decrypted ${amountToDecrypt} OCT` });
    setAmount('');

    try {
      await invalidateCacheAfterDecrypt(wallet.address);
      const [freshBalance, freshEncrypted] = await Promise.all([
        fetchBalance(wallet.address, true),
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
      ]);
      if (onBalanceUpdate) onBalanceUpdate(freshBalance.balance);
      if (onEncryptedBalanceUpdate && freshEncrypted) onEncryptedBalanceUpdate(freshEncrypted);
      onSuccess(freshBalance.balance, freshEncrypted, freshBalance.nonce);
    } catch {
      onSuccess(0, null, 0);
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

    if (!currentCipher || currentCipher === '0' || !currentCipher.startsWith('hfhe_v1|')) {
      toast({
        title: "No Encrypted Balance",
        description: "No valid encrypted balance cipher available. Please encrypt some balance first.",
        variant: "destructive",
      });
      return;
    }

    setIsDecrypting(true);
    setShowPvacModal(true);
    pvacOp.reset();

    try {
      const amountRaw = BigInt(Math.floor(amountToDecrypt * 1_000_000));
      // Force-refresh both nonce AND encrypted balance cipher before decrypt.
      // After wallet switch, the UI may still show stale cipher/balance from
      // the previous wallet. Always fetch fresh data from the node.
      const [freshBalanceData, freshEncData] = await Promise.all([
        fetchBalance(wallet.address, true),
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
      ]);
      const currentNonce = freshBalanceData.nonce;

      // Use fresh cipher from node — never trust the prop which may be stale
      const freshCipher = freshEncData?.cipher;
      if (!freshCipher || freshCipher === '0' || !freshCipher.startsWith('hfhe_v1|')) {
        throw new Error('No valid encrypted balance found for this wallet. Please encrypt some balance first.');
      }

      const freshEncryptedBalance = freshEncData?.encrypted ?? 0;
      if (amountToDecrypt > freshEncryptedBalance) {
        throw new Error(`Insufficient encrypted balance: have ${freshEncryptedBalance.toFixed(6)} OCT, need ${amountToDecrypt.toFixed(6)} OCT`);
      }

      const result = await pvacOp.runWorker<{ tx: Transaction }>('decryptToPublic', {
        privateKey:    wallet.privateKey,
        publicKey:     wallet.publicKey || '',
        address:       wallet.address,
        amountRaw:     amountRaw.toString(),
        currentCipher: freshCipher,
        nonce:         currentNonce + 1,
        ou:            String(effectiveFee),
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Decryption failed');
      }

      await submitAndRefresh(result.data.tx as Transaction, amountToDecrypt);
    } catch (error) {
      console.error('Decrypt failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to decrypt balance';
      setTxModalStatus('error');
      setTxModalResult({ error: msg });
      toast({ title: "Decryption Failed", description: msg, variant: "destructive" });
    } finally {
      setIsDecrypting(false);
    }
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
              onClick={() => {
                const feeOct = effectiveFee / 1_000_000;
                const maxAmount = encryptedBalance - feeOct;
                if (maxAmount > 0) {
                  setAmount(maxAmount.toFixed(8));
                } else {
                  toast({
                    title: "Insufficient Balance",
                    description: encryptedBalance > 0
                      ? `Need more than ${feeOct.toFixed(7)} OCT to cover the network fee`
                      : "No encrypted balance available",
                    variant: "destructive",
                  });
                }
              }}
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
          disabled={isDecrypting}
          isPopupMode={isPopupMode}
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
              Decrypt
            </>
          )}
        </Button>
      </div>

    </div>
  );

  // Inline mode
  if (isInline) {
    return (
      <>
        {showPvacModal && (
          <PvacOperationModal
            opType="decrypt"
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
      {showPvacModal && (
        <PvacOperationModal
          opType="decrypt"
          {...pvacOp}
          onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
        />
      )}
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
    </>
  );
}
