/**
 * ClaimTransfers — scan and claim incoming stealth transfers.
 *
 * 100% browser-based: scan uses pure TypeScript (Web Crypto),
 * claim uses PVAC WASM. No local server required.
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Gift, RefreshCw, Wallet as WalletIcon, Package } from 'lucide-react';
import { Wallet, EncryptedBalanceResponse } from '../types/wallet';
import { invalidateCacheAfterClaim, fetchBalance, fetchEncryptedBalance, sendTransaction, fetchRecommendedFee } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { PvacOperationModal } from './PvacOperationModal';
import { FeeSelector, FeeOption, getEffectiveFee } from './FeeSelector';
import { scanStealthOutputs, getCachedScanResults, invalidateScanCache, ClaimableTransfer } from '@/services/stealthScanService';
import { usePvacOperation } from '@/hooks/usePvacOperation';
import { logger } from '@/utils/logger';
import type { StealthOutput } from '@/lib/pvac/types';

interface ClaimTransfersProps {
  wallet: Wallet | null;
  onTransactionSuccess: () => void;
  /** Called with fresh encrypted balance right after a claim completes. */
  onEncryptedBalanceUpdate?: (enc: EncryptedBalanceResponse | null) => void;
  onPendingCountChange?: (count: number) => void;
  isPopupMode?: boolean;
  hideBorder?: boolean;
}

export function ClaimTransfers({
  wallet,
  onTransactionSuccess,
  onEncryptedBalanceUpdate,
  onPendingCountChange,
  isPopupMode = false,
  hideBorder = false,
}: ClaimTransfersProps) {
  const [transfers, setTransfers] = useState<ClaimableTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  // Single claim uses PvacOperationModal
  const [showPvacModal, setShowPvacModal] = useState(false);
  // Claim All uses its own PvacOperationModal with a separate hook instance
  const [showClaimAllModal, setShowClaimAllModal] = useState(false);
  const [recommendedClaimFee, setRecommendedClaimFee] = useState(5000);
  const [claimFeeOption, setClaimFeeOption] = useState<FeeOption>('recommended');
  const [claimCustomFee, setClaimCustomFee] = useState('');
  const isClaimingRef = useRef(false);
  const { toast } = useToast();
  const pvacOp = usePvacOperation();
  const pvacOpAll = usePvacOperation();  // separate hook for claim all

  useEffect(() => {
    fetchRecommendedFee('stealth').then(fee => setRecommendedClaimFee(fee)).catch(() => {});
  }, []);

  // ── Fetch / scan ────────────────────────────────────────────────────────────

  const fetchTransfers = async (forceRefresh = false) => {
    if (!wallet?.privateKey) return;

    // Use cached results only when not forcing a refresh.
    if (!forceRefresh) {
      const cached = getCachedScanResults(wallet.address);
      if (cached !== null) {
        setTransfers(cached);
        onPendingCountChange?.(cached.length);
        setIsLoading(false);
        return;
      }
    }

    if (forceRefresh) {
      setIsRefreshing(true);
      // Clear stale data immediately so user doesn't see claimed transfers
      setTransfers([]);
    }
    setIsLoading(true);
    try {
      const claimable = await scanStealthOutputs(wallet.privateKey, wallet.address);
      setTransfers(claimable);
      onPendingCountChange?.(claimable.length);
    } catch (err) {
      logger.error('Error scanning stealth outputs', err);
      toast({ title: 'Error', description: 'Failed to scan for claimable transfers', variant: 'destructive' });
    } finally {
      setIsLoading(false);
      if (forceRefresh) setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  useEffect(() => {
    if (wallet) fetchTransfers();
  }, [wallet?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Single claim ────────────────────────────────────────────────────────────

  const handleClaim = async (transfer: ClaimableTransfer) => {
    if (!wallet || isClaimingRef.current) return;
    isClaimingRef.current = true;
    setClaimingId(transfer.id);
    setShowPvacModal(true);
    pvacOp.reset();

    try {
      const txHash = await claimOne(transfer, undefined, pvacOp);
      setShowPvacModal(false);

      // Invalidate cache immediately after successful submit — don't wait for confirmation.
      // This ensures the claimed transfer disappears from the list right away.
      invalidateScanCache(wallet.address);
      invalidateCacheAfterClaim(wallet.address).catch(() => {});
      // Remove the claimed transfer from local state immediately
      setTransfers(prev => {
        const next = prev.filter(t => t.id !== transfer.id);
        onPendingCountChange?.(next.length);
        return next;
      });

      setShowTxModal(true);
      setTxModalStatus('success');
      setTxModalResult({
        hash: txHash,
        amount: transfer.amount.toFixed(8),
        finality: 'pending',
        onStatusConfirmed: async () => {
          // Force fresh scan after confirmation to sync with node
          await fetchTransfers(true);
          onTransactionSuccess();
        },
      });

      // Refresh encrypted balance in background so WalletDashboard shows updated value
      if (wallet?.privateKey) {
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true)
          .then((freshEnc) => onEncryptedBalanceUpdate?.(freshEnc))
          .catch(() => {});
      }
    } catch (err) {
      logger.error('Claim error', err);
      setShowPvacModal(false);
      setShowTxModal(true);
      setTxModalStatus('error');
      setTxModalResult({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setClaimingId(null);
      isClaimingRef.current = false;
    }
  };

  // ── Claim All — uses PvacOperationModal with live log ───────────────────────

  const handleClaimAll = async () => {
    if (!wallet || transfers.length === 0 || isClaimingRef.current) return;
    isClaimingRef.current = true;
    setClaimingAll(true);
    setShowClaimAllModal(true);
    pvacOpAll.reset();

    let successCount = 0;
    const errors: string[] = [];

    const freshBalance = await fetchBalance(wallet.address, true);
    let nextNonce = freshBalance.nonce + 1;

    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i];
      pvacOpAll.onProgress({
        step: 'encrypting',
        label: `Claiming transfer ${i + 1}/${transfers.length} (#${transfer.id}, ${transfer.amount.toFixed(4)} OCT)...`,
        percent: Math.round(((i) / transfers.length) * 90),
      });

      try {
        await claimOne(transfer, nextNonce, pvacOpAll);
        nextNonce++;
        successCount++;
        pvacOpAll.onProgress({
          step: 'encrypting',
          label: `Claimed ${successCount}/${transfers.length} — #${transfer.id} done`,
          percent: Math.round(((i + 1) / transfers.length) * 90),
        });
        // Small delay between claims to avoid nonce collisions
        if (i < transfers.length - 1) await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`#${transfer.id}: ${msg}`);
        pvacOpAll.onProgress({
          step: 'encrypting',
          label: `Failed #${transfer.id}: ${msg}`,
          percent: Math.round(((i + 1) / transfers.length) * 90),
        });
        try {
          const refetch = await fetchBalance(wallet.address, true);
          nextNonce = refetch.nonce + 1;
        } catch { /* keep current nonce */ }
      }
    }

    setClaimingAll(false);
    isClaimingRef.current = false;

    if (successCount > 0) {
      pvacOpAll.onProgress({
        step: 'done',
        label: `Claimed ${successCount}/${transfers.length} transfers successfully`,
        percent: 100,
      });

      // Invalidate cache and clear list immediately — don't wait for scan
      invalidateScanCache(wallet.address);
      // Track which transfers were successfully claimed (first successCount items)
      const claimedIds = new Set(transfers.slice(0, successCount).map(t => t.id));
      // Remove successfully claimed transfers from local state right away
      setTransfers(prev => {
        const next = prev.filter(t => !claimedIds.has(t.id));
        onPendingCountChange?.(next.length);
        return next;
      });
      // Then do a full refresh in background
      invalidateCacheAfterClaim(wallet.address).then(() => {
        fetchTransfers(true).then(() => onTransactionSuccess());
      }).catch(() => {});

      // Refresh encrypted balance so WalletDashboard shows updated value
      if (wallet?.privateKey) {
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true)
          .then((freshEnc) => onEncryptedBalanceUpdate?.(freshEnc))
          .catch(() => {});
      }
    } else {
      pvacOpAll.onProgress({
        step: 'done',
        label: errors.length > 0 ? `All failed: ${errors[0]}` : 'No transfers claimed',
        percent: 100,
      });
    }
  };

  // ── Core claim — WASM only ──────────────────────────────────────────────────

  const claimOne = async (
    transfer: ClaimableTransfer,
    overrideNonce?: number,
    opHook = pvacOp,
  ): Promise<string> => {
    if (!wallet) throw new Error('No wallet');

    const nonce = overrideNonce ?? (await fetchBalance(wallet.address, true)).nonce + 1;

    const result = await opHook.runWorker<{ tx: import('../types/wallet').Transaction }>(
      'claimStealth',
      {
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey || '',
        address: wallet.address,
        stealthOutput: transfer.rawOutput as StealthOutput,
        nonce,
        ou: String(getEffectiveFee(recommendedClaimFee, claimFeeOption, claimCustomFee)),
      }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Claim failed');
    }

    const submitResult = await sendTransaction(result.data.tx);
    if (!submitResult.success) throw new Error(submitResult.error || 'Submit failed');
    return submitResult.hash || 'pending';
  };

  if (!wallet) {
    return (
      <Alert>
        <WalletIcon className="h-4 w-4" />
        <AlertDescription>No wallet available.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {/* Single claim modal */}
      {showPvacModal && (
        <PvacOperationModal
          opType="claim"
          {...pvacOp}
          onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
        />
      )}

      {/* Claim All modal — full backdrop with live log */}
      {showClaimAllModal && (
        <PvacOperationModal
          opType="claim"
          {...pvacOpAll}
          onDismiss={() => {
            setShowClaimAllModal(false);
            pvacOpAll.reset();
          }}
        />
      )}

      <Card className={`${hideBorder || isPopupMode ? 'border-0 shadow-none' : 'border-[#3B567F]/20'}`}>
      <CardContent className={isPopupMode ? 'px-0 pb-0 pt-0' : 'pt-0'}>

        {/* Refresh button */}
        {isPopupMode && (
          <div className="flex justify-end mb-2">
            <Button variant="outline" size="sm" onClick={() => fetchTransfers(true)}
              disabled={isLoading || isRefreshing} className="h-7 px-2">
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        )}

        {/* Fee selector */}
        {transfers.length > 0 && !isLoading && (
          <div className={isPopupMode ? 'mb-2 space-y-1' : 'mb-3 space-y-1.5'}>
            <span className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
              Network Fee
            </span>
            <FeeSelector
              recommendedFee={recommendedClaimFee}
              feeOption={claimFeeOption}
              customFee={claimCustomFee}
              onFeeOptionChange={setClaimFeeOption}
              onCustomFeeChange={setClaimCustomFee}
              disabled={claimingAll || claimingId !== null}
              isPopupMode={isPopupMode}
            />
          </div>
        )}

        {/* Claim All button */}
        {transfers.length > 1 && (
          <div className={isPopupMode ? 'mb-2' : 'mb-4'}>
            <Button onClick={handleClaimAll}
              disabled={claimingAll || claimingId !== null}
              className={`w-full bg-[#00E5C0] hover:bg-[#00E5C0]/80 ${isPopupMode ? 'h-8 text-xs' : ''}`}>
              <Package className={isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />
              Claim All {transfers.length}
            </Button>
          </div>
        )}

        {/* Transfer list */}
        {isLoading ? (
          <div className={isPopupMode ? 'space-y-2' : 'space-y-4'}>
            <div className={`text-muted-foreground ${isPopupMode ? 'text-xs' : 'text-sm'}`}>Scanning...</div>
            {[...Array(isPopupMode ? 1 : 2)].map((_, i) => (
              <div key={i} className={`space-y-2 border ${isPopupMode ? 'p-2' : 'p-4'}`}>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : transfers.length === 0 ? (
          <div className={`flex items-start ${isPopupMode ? 'space-x-2 py-2' : 'space-x-3 py-3'}`}>
            <Gift className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mt-0.5 flex-shrink-0 text-muted-foreground`} />
            <span className={`text-muted-foreground ${isPopupMode ? 'text-[11px] leading-tight' : 'text-sm'}`}>
              {isPopupMode
                ? 'No claimable stealth transfers.'
                : 'No claimable stealth transfers found. When someone sends you a stealth transfer, it will appear here.'}
            </span>
          </div>
        ) : (
          <ScrollArea className={isPopupMode ? 'h-auto' : 'h-[calc(100vh-450px)] pr-3'}>
            <div className={isPopupMode ? 'space-y-2' : 'space-y-4 pr-1 pb-4'}>
              {!isPopupMode && (
                <div className="text-sm text-muted-foreground">
                  Found {transfers.length} claimable transfer{transfers.length !== 1 ? 's' : ''}
                </div>
              )}
              {transfers.map((transfer) => (
                <div key={transfer.id} className={`border ${isPopupMode ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}>
                  <div className="flex items-center justify-between">
                    <div className={isPopupMode ? 'space-y-0.5' : 'space-y-1'}>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${isPopupMode ? 'text-xs' : 'text-sm'}`}>#{transfer.id}</span>
                        <Badge variant="outline" className={isPopupMode ? 'text-[9px] px-1 py-0' : 'text-xs'}>
                          E.{transfer.epoch}
                        </Badge>
                      </div>
                      <div className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                        {transfer.sender
                          ? (isPopupMode
                              ? `${transfer.sender.slice(0, 6)}...${transfer.sender.slice(-4)}`
                              : `From: ${transfer.sender.slice(0, 12)}...${transfer.sender.slice(-8)}`)
                          : 'Unknown sender'}
                      </div>
                    </div>
                    <div className={`text-right ${isPopupMode ? 'space-y-0' : 'space-y-1'}`}>
                      <div className={`font-mono font-bold text-[#00E5C0] ${isPopupMode ? 'text-xs' : ''}`}>
                        +{transfer.amount.toFixed(isPopupMode ? 4 : 8)} OCT
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={() => handleClaim(transfer)}
                      disabled={claimingId === transfer.id || claimingAll}
                      size="sm"
                      className={`flex items-center gap-1.5 bg-[#00E5C0] hover:bg-[#00E5C0]/80 ${isPopupMode ? 'h-7 text-xs px-2' : ''}`}>
                      {claimingId === transfer.id ? (
                        <div className="flex items-center gap-1">
                          <div className="relative w-3 h-3">
                            <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
                          </div>
                          <span>Claiming...</span>
                        </div>
                      ) : (
                        <><Gift className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />Claim</>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <TransactionModal
          open={showTxModal}
          onOpenChange={setShowTxModal}
          status={txModalStatus}
          result={txModalResult}
          type="claim"
          isPopupMode={isPopupMode}
        />
      </CardContent>
    </Card>
    </>
  );
}
