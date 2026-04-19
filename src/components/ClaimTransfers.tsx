import { useState, useEffect } from 'react';
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
import { getPendingPrivateTransfers, claimPrivateTransfer, invalidateCacheAfterClaim, fetchEncryptedBalance } from '../utils/api';
import { deriveSharedSecretForClaim, decryptPrivateAmount } from '../utils/crypto';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { pvacServerService } from '@/services/pvacServerService';
import { optimisticUpdateService } from '@/services/optimisticUpdateService';
import { logger } from '@/utils/logger';

function julianToDate(jd: number): Date {
  const JD_UNIX_EPOCH = 2440587.5; // Julian Date of Unix epoch 1970-01-01
  const msSinceEpoch = (jd - JD_UNIX_EPOCH) * 86400000;
  return new Date(msSinceEpoch);
}

interface ClaimTransfersProps {
  wallet: Wallet | null;
  onTransactionSuccess: () => void;
  isPopupMode?: boolean;
  hideBorder?: boolean;
}

export function ClaimTransfers({ wallet, onTransactionSuccess, isPopupMode = false, hideBorder = false }: ClaimTransfersProps) {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [usePvacServer, setUsePvacServer] = useState(false);
  const [isPvacAvailable, setIsPvacAvailable] = useState(false);
  const { toast } = useToast();

  // Check PVAC availability on mount
  useEffect(() => {
    const available = pvacServerService.isEnabled();
    setIsPvacAvailable(available);
    setUsePvacServer(available); // Auto-enable if available
  }, []);

  const fetchTransfers = async (showRefreshAnimation = false) => {
    if (!wallet) return;
    
    if (showRefreshAnimation) {
      setIsRefreshing(true);
    }
    setIsLoading(true);
    try {
      const pendingTransfers = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
      
      // Decrypt amounts for display
      const transfersWithAmounts = await Promise.all(
        pendingTransfers.map(async (transfer) => {
          let decryptedAmount = null;
          
          if (transfer.encrypted_data && transfer.ephemeral_key) {
            try {
              const sharedSecret = await deriveSharedSecretForClaim(wallet.privateKey, transfer.ephemeral_key);
              const amount = await decryptPrivateAmount(transfer.encrypted_data, sharedSecret);
              if (amount !== null) {
                decryptedAmount = amount / 1_000_000; // Convert from micro units
              }
            } catch (error) {
              logger.warn('Failed to decrypt amount for transfer', { id: transfer.id, error });
            }
          }
          
          return {
            ...transfer,
            decryptedAmount
          };
        })
      );
      
      setTransfers(transfersWithAmounts);
    } catch (error) {
      logger.error('Error fetching transfers', error);
      toast({
        title: "Error",
        description: "Failed to fetch pending transfers",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      if (showRefreshAnimation) {
        // Keep spinning for at least 500ms for visual feedback
        setTimeout(() => setIsRefreshing(false), 500);
      }
    }
  };

  useEffect(() => {
    if (wallet) {
      fetchTransfers();
    }
  }, [wallet]);

  const handleClaim = async (transferId: string) => {
    if (!wallet) return;
    
    setClaimingId(transferId);
    
    // Show modal with claiming state
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);
    
    try {
      // Find transfer to get amount for optimistic update
      const transfer = transfers.find(t => t.id === transferId);
      const claimAmount = transfer?.decryptedAmount || 0;
      
      // Get current encrypted balance
      const currentEncrypted = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
      
      // Apply optimistic update for claim
      const update = optimisticUpdateService.applyUpdate(
        wallet.address,
        'claim',
        claimAmount,
        { public: 0, encrypted: currentEncrypted?.encrypted || 0 },
        0 // No fee for claim
      );
      
      logger.debug('Claim: Optimistic update applied:', update.id);
      
      const result = await claimPrivateTransfer(wallet.address, wallet.privateKey, transferId);
      
      if (result.success) {
        // Update transaction hash (use transfer ID as identifier for claim)
        optimisticUpdateService.updateTransactionHash(update.id, `claim_${transferId}`);
        
        // Invalidate cache after claim
        await invalidateCacheAfterClaim(wallet.address);
        
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ amount: result.amount });
        
        // Refresh transfers list
        await fetchTransfers();
        
        // Verify optimistic update in background
        setTimeout(async () => {
          logger.debug('Claim: Verifying optimistic update...');
          try {
            const freshEncrypted = await fetchEncryptedBalance(wallet.address, wallet.privateKey, true);
            
            await optimisticUpdateService.verifyUpdate(update.id, {
              public: 0,
              encrypted: freshEncrypted?.encrypted || 0,
            });
            
            logger.debug('Claim: Optimistic update verified');
            onTransactionSuccess();
          } catch (error) {
            logger.error('Claim: Failed to verify:', error);
            onTransactionSuccess(); // Refresh anyway
          }
        }, 3000); // Wait 3 seconds
      } else {
        // Fail optimistic update
        await optimisticUpdateService.failUpdate(update.id, result.error);
        
        // Update modal to error state
        setTxModalStatus('error');
        setTxModalResult({ error: result.error || "Unknown error occurred" });
      }
    } catch (error) {
      console.error('Claim error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      // Update modal to error state
      setTxModalStatus('error');
      setTxModalResult({ error: errorMsg });
    } finally {
      setClaimingId(null);
    }
  };

  const handleClaimAll = async () => {
    if (!wallet || transfers.length === 0) return;
    
    setClaimingAll(true);
    
    try {
      let successCount = 0;
      let totalAmount = 0;
      const errors: string[] = [];
      
      // Get current encrypted balance once
      const currentEncrypted = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
      
      // Process transfers sequentially to avoid overwhelming the server
      for (const transfer of transfers) {
        try {
          const claimAmount = transfer.decryptedAmount || 0;
          
          // Apply optimistic update for each claim
          const update = optimisticUpdateService.applyUpdate(
            wallet.address,
            'claim',
            claimAmount,
            { public: 0, encrypted: currentEncrypted?.encrypted || 0 },
            0
          );
          
          const result = await claimPrivateTransfer(wallet.address, wallet.privateKey, transfer.id);
          
          if (result.success) {
            // Update transaction hash (use transfer ID as identifier for claim)
            optimisticUpdateService.updateTransactionHash(update.id, `claim_${transfer.id}`);
            
            successCount++;
            if (result.amount) {
              totalAmount += parseFloat(result.amount);
            }
          } else {
            // Fail optimistic update
            await optimisticUpdateService.failUpdate(update.id, result.error);
            errors.push(`Transfer ${transfer.id}: ${result.error || 'Unknown error'}`);
          }
          
          // Small delay between claims to be respectful to the server
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          errors.push(`Transfer ${transfer.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      // Show results
      if (successCount > 0) {
        toast({
          title: "Claim All Completed!",
          description: `Successfully claimed ${successCount} out of ${transfers.length} transfers${totalAmount > 0 ? ` (Total: ${totalAmount.toFixed(8)} OCT)` : ''}`,
        });
        
        // Invalidate cache after all claims
        await invalidateCacheAfterClaim(wallet.address);
        
        // Refresh transfers list
        await fetchTransfers();
        
        // Verify optimistic updates in background
        setTimeout(async () => {
          logger.debug('ClaimAll: Verifying optimistic updates...');
          try {
            const freshEncrypted = await fetchEncryptedBalance(wallet.address, wallet.privateKey, true);
            
            // Verify all pending updates for this address
            const pendingUpdates = optimisticUpdateService.getPendingUpdates(wallet.address);
            for (const update of pendingUpdates) {
              if (update.type === 'claim') {
                await optimisticUpdateService.verifyUpdate(update.id, {
                  public: 0,
                  encrypted: freshEncrypted?.encrypted || 0,
                });
              }
            }
            
            logger.debug('ClaimAll: Optimistic updates verified');
            onTransactionSuccess();
          } catch (error) {
            logger.error('ClaimAll: Failed to verify:', error);
            onTransactionSuccess(); // Refresh anyway
          }
        }, 3000);
      }
      
      if (errors.length > 0) {
        logger.error('Claim errors', errors);
        if (successCount === 0) {
          toast({
            title: "Claim All Failed",
            description: `Failed to claim any transfers. First error: ${errors[0]}`,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      logger.error('Claim all error', error);
      toast({
        title: "Error",
        description: "Failed to claim transfers",
        variant: "destructive",
      });
    } finally {
      setClaimingAll(false);
    }
  };

  if (!wallet) {
    return (
      <Alert>
        <WalletIcon className="h-4 w-4" />
        <AlertDescription>
          No wallet available. Please generate or import a wallet first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className={`${hideBorder || isPopupMode ? 'border-0 shadow-none' : 'border-[#3A4DFF]/20'}`}>
      <CardContent className={isPopupMode ? 'px-0 pb-0 pt-0' : 'pt-0'}>
        {/* Refresh button for popup mode */}
        {isPopupMode && (
          <div className="flex justify-end mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchTransfers(true)}
              disabled={isLoading || isRefreshing}
              className="h-7 px-2"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        )}
        
        {/* PVAC Server Option */}
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
            <Switch
              checked={usePvacServer}
              onCheckedChange={setUsePvacServer}
              disabled={claimingAll || claimingId !== null}
              className={isPopupMode ? 'scale-75' : ''}
            />
          </div>
        )}

        {/* Performance Info */}
        {usePvacServer && isPvacAvailable && transfers.length > 0 && (
          <Alert className={`${isPopupMode ? 'py-1.5 mb-2' : 'mb-4'}`}>
            <Zap className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
            <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
              PVAC server: ~14x faster claim operations
            </AlertDescription>
          </Alert>
        )}

        {/* PVAC Not Available Warning */}
        {!isPvacAvailable && transfers.length > 0 && (
          <Alert variant="destructive" className={`${isPopupMode ? 'py-1.5 mb-2' : 'mb-4'}`}>
            <AlertTriangle className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`} />
            <AlertDescription className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
              PVAC server not configured. Using slower method.
            </AlertDescription>
          </Alert>
        )}
        
        {/* Claim All Button - Show only when there are multiple transfers */}
        {transfers.length > 1 && (
          <div className={isPopupMode ? 'mb-2' : 'mb-4'}>
            <Button
              onClick={handleClaimAll}
              disabled={claimingAll || claimingId !== null}
              className={`w-full bg-[#00E5C0] hover:bg-[#00E5C0]/80 ${isPopupMode ? 'h-8 text-xs' : ''}`}
            >
              {claimingAll ? (
                <div className="flex items-center gap-1.5">
                  <div className="relative w-3 h-3">
                    <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
                  </div>
                  <span>{isPopupMode ? 'Claiming...' : 'Claiming All Transfers...'}</span>
                </div>
              ) : (
                <>
                  <Package className={isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />
                  Claim All {transfers.length}
                </>
              )}
            </Button>
          </div>
        )}
        
        {isLoading ? (
          <div className={isPopupMode ? 'space-y-2' : 'space-y-4'}>
            <div className={`text-muted-foreground ${isPopupMode ? 'text-xs' : 'text-sm'}`}>Loading...</div>
            {[...Array(isPopupMode ? 1 : 2)].map((_, i) => (
              <div key={i} className={`space-y-2 border  ${isPopupMode ? 'p-2' : 'p-4'}`}>
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
                ? 'No pending transfers. Private transfers will appear here.'
                : 'No pending private transfers found. When someone sends you a private transfer, it will appear here for claiming.'
              }
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
                <div key={transfer.id} className={`border  ${isPopupMode ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}>
                  <div className="flex items-center justify-between">
                    <div className={isPopupMode ? 'space-y-0.5' : 'space-y-1'}>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${isPopupMode ? 'text-xs' : 'text-sm'}`}>#{transfer.id}</span>
                        <Badge variant="outline" className={isPopupMode ? 'text-[9px] px-1 py-0' : 'text-xs'}>
                          E.{transfer.epoch_id}
                        </Badge>
                      </div>
                      <div className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                        {isPopupMode 
                          ? `${transfer.sender.slice(0, 6)}...${transfer.sender.slice(-4)}`
                          : `From: ${transfer.sender.slice(0, 12)}...${transfer.sender.slice(-8)}`
                        }
                      </div>
                    </div>
                    
                    <div className={`text-right ${isPopupMode ? 'space-y-0' : 'space-y-1'}`}>
                      <div className={`font-mono font-bold text-[#3A4DFF] ${isPopupMode ? 'text-xs' : ''}`}>
                        {transfer.decryptedAmount !== null 
                          ? `+ ${transfer.decryptedAmount.toFixed(isPopupMode ? 4 : 8)} OCT`
                          : '[Encrypted]'
                        }
                      </div>
                      {!isPopupMode && (
                        <div className="text-xs text-muted-foreground">
                          {julianToDate(transfer.created_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex justify-end">
                    <Button
                      onClick={() => handleClaim(transfer.id)}
                      disabled={claimingId === transfer.id || claimingAll}
                      size="sm"
                      className={`flex items-center gap-1.5 bg-[#00E5C0] hover:bg-[#00E5C0]/80 ${isPopupMode ? 'h-7 text-xs px-2' : ''}`}
                    >
                      {claimingId === transfer.id || claimingAll ? (
                        <div className="flex items-center gap-1">
                          <div className="relative w-3 h-3">
                            <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
                          </div>
                          <span>{isPopupMode ? '...' : (claimingAll ? 'Processing...' : 'Claiming...')}</span>
                        </div>
                      ) : (
                        <>
                          <Gift className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
                          Claim
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Transaction Modal */}
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
