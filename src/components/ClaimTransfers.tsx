import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Gift, RefreshCw, Wallet as WalletIcon, Package, Server, Zap, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { invalidateCacheAfterClaim, fetchBalance, sendTransaction, fetchRecommendedFee } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { pvacServerService } from '@/services/pvacServerService';
import { scanStealthOutputs, ClaimableTransfer } from '@/services/stealthScanService';
import { logger } from '@/utils/logger';

interface ClaimTransfersProps {
  wallet: Wallet | null;
  onTransactionSuccess: () => void;
  isPopupMode?: boolean;
  hideBorder?: boolean;
}

export function ClaimTransfers({ wallet, onTransactionSuccess, isPopupMode = false, hideBorder = false }: ClaimTransfersProps) {
  const [transfers, setTransfers] = useState<ClaimableTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [usePvacServer, setUsePvacServer] = useState(false);
  const [isPvacAvailable, setIsPvacAvailable] = useState(false);
  const [recommendedClaimFee, setRecommendedClaimFee] = useState(5000); // stealth claim
  const isClaimingRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    const available = pvacServerService.isEnabled();
    setIsPvacAvailable(available);
    setUsePvacServer(available);
    fetchRecommendedFee('stealth').then(fee => setRecommendedClaimFee(fee)).catch(() => {});
  }, []);

  const fetchTransfers = async (showRefreshAnimation = false) => {
    if (!wallet?.privateKey) return;
    if (showRefreshAnimation) setIsRefreshing(true);
    setIsLoading(true);
    try {
      const claimable = await scanStealthOutputs(wallet.privateKey);
      setTransfers(claimable);
    } catch (err) {
      logger.error('Error scanning stealth outputs', err);
      toast({ title: 'Error', description: 'Failed to scan for claimable transfers', variant: 'destructive' });
    } finally {
      setIsLoading(false);
      if (showRefreshAnimation) setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  useEffect(() => {
    if (wallet) fetchTransfers();
  }, [wallet?.address]);

  // ── Single claim ────────────────────────────────────────────────────────────
  const handleClaim = async (transfer: ClaimableTransfer) => {
    if (!wallet || isClaimingRef.current) return;
    isClaimingRef.current = true;
    setClaimingId(transfer.id);
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);

    try {
      const txHash = await claimOne(transfer);
      // Wire onStatusConfirmed: re-scan + refresh only after node confirms
      setTxModalStatus('success');
      setTxModalResult({
        hash: txHash,
        amount: transfer.amount.toFixed(8),
        finality: 'pending',
        onStatusConfirmed: async () => {
          await invalidateCacheAfterClaim(wallet.address);
          await fetchTransfers();
          onTransactionSuccess();
        },
      });
    } catch (err: any) {
      logger.error('Claim error', err);
      setTxModalStatus('error');
      setTxModalResult({ error: err.message || 'Unknown error' });
    } finally {
      setClaimingId(null);
      isClaimingRef.current = false;
    }
  };

  // ── Claim all ───────────────────────────────────────────────────────────────
  const handleClaimAll = async () => {
    if (!wallet || transfers.length === 0 || isClaimingRef.current) return;
    isClaimingRef.current = true;
    setClaimingAll(true);

    let successCount = 0;
    const errors: string[] = [];

    // Fetch nonce once, then increment locally for each sequential claim
    const freshBalance = await fetchBalance(wallet.address, true);
    let nextNonce = freshBalance.nonce + 1;

    for (const transfer of transfers) {
      try {
        await claimOne(transfer, nextNonce);
        nextNonce++;
        successCount++;
        // Small delay to avoid overwhelming the node
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        errors.push(`#${transfer.id}: ${err.message}`);
        // On error, re-fetch nonce to stay in sync
        try {
          const refetch = await fetchBalance(wallet.address, true);
          nextNonce = refetch.nonce + 1;
        } catch {
          // keep current nonce if refetch fails
        }
      }
    }

    setClaimingAll(false);
    isClaimingRef.current = false;

    if (successCount > 0) {
      toast({
        title: 'Claim All Completed',
        description: `Claimed ${successCount}/${transfers.length} transfers`,
      });
      // Wait for node to confirm all txs before re-scanning
      // (immediate scan would still show outputs as unclaimed)
      setTimeout(async () => {
        await invalidateCacheAfterClaim(wallet.address);
        await fetchTransfers();
        onTransactionSuccess();
      }, 8000);
    }
    if (errors.length > 0 && successCount === 0) {
      toast({ title: 'Claim All Failed', description: errors[0], variant: 'destructive' });
    }
  };

  // ── Core claim logic ────────────────────────────────────────────────────────
  const claimOne = async (transfer: ClaimableTransfer, overrideNonce?: number): Promise<string> => {
    if (!wallet) throw new Error('No wallet');

    // Use provided nonce (claim-all path) or fetch fresh (single claim path)
    let nonce: number;
    if (overrideNonce !== undefined) {
      nonce = overrideNonce;
    } else {
      const freshBalance = await fetchBalance(wallet.address, true);
      nonce = freshBalance.nonce + 1;
    }

    if (usePvacServer && isPvacAvailable) {
      // PVAC path — server builds the signed tx
      const result = await pvacServerService.claimStealth({
        stealth_output: transfer.rawOutput,
        address: wallet.address,
        nonce,
        private_key: wallet.privateKey,
        public_key: wallet.publicKey || '',
        ou: String(recommendedClaimFee),
      });
      if (!result.success) throw new Error(result.error || 'PVAC claim failed');

      const submitResult = await sendTransaction(result.tx);
      if (!submitResult.success) throw new Error(submitResult.error || 'Submit failed');
      return submitResult.hash || 'pending';
    } else {
      // Claim requires PVAC server for ZK proof generation
      throw new Error('Claim requires PVAC server. Please configure PVAC in settings.');
    }
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
    <Card className={`${hideBorder || isPopupMode ? 'border-0 shadow-none' : 'border-[#3A4DFF]/20'}`}>
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

        {/* PVAC toggle */}
        {isPvacAvailable && transfers.length > 0 && (
          <div className={`flex items-center justify-between p-${isPopupMode ? '2' : '3'} bg-muted/50 rounded-lg ${isPopupMode ? 'mb-2' : 'mb-4'}`}>
            <div className="flex items-center gap-2">
              <Server className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} text-primary`} />
              <div>
                <Label className={`${isPopupMode ? 'text-[10px]' : 'text-sm'} font-medium cursor-pointer`}>
                  Use PVAC Server
                </Label>
                <p className={`${isPopupMode ? 'text-[9px]' : 'text-xs'} text-muted-foreground`}>
                  {usePvacServer ? '~700ms' : '~10s'} per claim
                </p>
              </div>
            </div>
            <Switch checked={usePvacServer} onCheckedChange={setUsePvacServer}
              disabled={claimingAll || claimingId !== null}
              className={isPopupMode ? 'scale-75' : ''} />
          </div>
        )}

        {/* PVAC required warning */}
        {!isPvacAvailable && transfers.length > 0 && (
          <Alert variant="destructive" className={`${isPopupMode ? 'py-1.5 mb-2' : 'mb-4'}`}>
            <AlertTriangle className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
            <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
              PVAC server required for claim. Configure it in settings.
            </AlertDescription>
          </Alert>
        )}

        {/* PVAC speed info */}
        {usePvacServer && isPvacAvailable && transfers.length > 0 && (
          <Alert className={`${isPopupMode ? 'py-1.5 mb-2' : 'mb-4'}`}>
            <Zap className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
            <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
              PVAC server: ~14x faster claim operations
            </AlertDescription>
          </Alert>
        )}

        {/* Claim All */}
        {transfers.length > 1 && (
          <div className={isPopupMode ? 'mb-2' : 'mb-4'}>
            <Button onClick={handleClaimAll}
              disabled={claimingAll || claimingId !== null || !isPvacAvailable}
              className={`w-full bg-[#00E5C0] hover:bg-[#00E5C0]/80 ${isPopupMode ? 'h-8 text-xs' : ''}`}>
              {claimingAll ? (
                <div className="flex items-center gap-1.5">
                  <div className="relative w-3 h-3">
                    <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
                  </div>
                  <span>Claiming...</span>
                </div>
              ) : (
                <><Package className={isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />Claim All {transfers.length}</>
              )}
            </Button>
          </div>
        )}

        {/* List */}
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
                      disabled={claimingId === transfer.id || claimingAll || !isPvacAvailable}
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
  );
}
