import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Gift, RefreshCw, Wallet as WalletIcon, CheckCircle, AlertTriangle, Loader2, Package } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { getPendingPrivateTransfers, claimPrivateTransfer, fetchEncryptedBalance } from '../utils/api';
import { deriveSharedSecretForClaim, decryptPrivateAmount } from '../utils/crypto';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';

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
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const { toast } = useToast();

  const fetchTransfers = async () => {
    if (!wallet) return;
    
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
              console.error('Failed to decrypt amount for transfer:', transfer.id, error);
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
      console.error('Error fetching transfers:', error);
      toast({
        title: "Error",
        description: "Failed to fetch pending transfers",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
      const result = await claimPrivateTransfer(wallet.address, wallet.privateKey, transferId);
      
      if (result.success) {
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ amount: result.amount });
        
        // Refresh transfers list
        await fetchTransfers();
        
        // Notify parent component
        onTransactionSuccess();
      } else {
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
      
      // Process transfers sequentially to avoid overwhelming the server
      for (const transfer of transfers) {
        try {
          const result = await claimPrivateTransfer(wallet.address, wallet.privateKey, transfer.id);
          
          if (result.success) {
            successCount++;
            if (result.amount) {
              totalAmount += parseFloat(result.amount);
            }
          } else {
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
        
        // Refresh transfers list
        await fetchTransfers();
        
        // Notify parent component
        onTransactionSuccess();
      }
      
      if (errors.length > 0) {
        console.error('Claim errors:', errors);
        if (successCount === 0) {
          toast({
            title: "Claim All Failed",
            description: `Failed to claim any transfers. First error: ${errors[0]}`,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error('Claim all error:', error);
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
    <Card className={`${hideBorder ? 'border-0 shadow-none' : 'border-[#0000db]/20'}`}>
      <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${isPopupMode ? 'pb-2 px-3 pt-3' : 'pb-4'}`}>
        <CardTitle className={`flex items-center gap-2 text-[#0000db] ${isPopupMode ? 'text-sm' : ''}`}>
          <Gift className={isPopupMode ? 'h-4 w-4' : 'h-5 w-5'} />
          {isPopupMode ? 'Claim Transfers' : 'Claim Private Transfers'}
          {transfers.length > 0 && (
            <Badge variant="secondary" className={isPopupMode ? 'ml-1 text-[10px]' : 'ml-2'}>
              {transfers.length}
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTransfers}
          disabled={isLoading}
          className={isPopupMode ? 'h-7 px-2' : ''}
        >
          <RefreshCw className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} ${isPopupMode ? '' : 'mr-2'} ${isLoading ? 'animate-spin' : ''}`} />
          {!isPopupMode && 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent className={isPopupMode ? 'px-3 pb-3 pt-0' : ''}>
        {/* Claim All Button - Show only when there are multiple transfers */}
        {transfers.length > 1 && (
          <div className={isPopupMode ? 'mb-2' : 'mb-4'}>
            <Button
              onClick={handleClaimAll}
              disabled={claimingAll || claimingId !== null}
              className={`w-full bg-[#0000db] hover:bg-[#0000db]/90 ${isPopupMode ? 'h-8 text-xs' : ''}`}
            >
              {claimingAll ? (
                <>
                  <Loader2 className={`${isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} animate-spin`} />
                  {isPopupMode ? 'Claiming...' : 'Claiming All Transfers...'}
                </>
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
              <div key={i} className={`space-y-2 border rounded-lg ${isPopupMode ? 'p-2' : 'p-4'}`}>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : transfers.length === 0 ? (
          <Alert className={isPopupMode ? 'py-2' : ''}>
            <div className={`flex items-start ${isPopupMode ? 'space-x-2' : 'space-x-3'}`}>
              <Gift className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mt-0.5 flex-shrink-0`} />
              <AlertDescription className={isPopupMode ? 'text-[11px] leading-tight' : ''}>
                {isPopupMode 
                  ? 'No pending transfers. Private transfers will appear here.'
                  : 'No pending private transfers found. When someone sends you a private transfer, it will appear here for claiming.'
                }
              </AlertDescription>
            </div>
          </Alert>
        ) : (
          <div className={isPopupMode ? 'space-y-2' : 'space-y-4'}>
            {!isPopupMode && (
              <div className="text-sm text-muted-foreground">
                Found {transfers.length} claimable transfer{transfers.length !== 1 ? 's' : ''}
              </div>
            )}
            
            {transfers.map((transfer, index) => (
              <div key={transfer.id} className={`border rounded-lg ${isPopupMode ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}>
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
                    <div className={`font-mono font-bold text-green-600 ${isPopupMode ? 'text-xs' : ''}`}>
                      {transfer.decryptedAmount !== null 
                        ? `${transfer.decryptedAmount.toFixed(isPopupMode ? 4 : 8)} OCT`
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
                    className={`flex items-center gap-1.5 bg-[#0000db] hover:bg-[#0000db]/90 ${isPopupMode ? 'h-7 text-xs px-2' : ''}`}
                  >
                    {claimingId === transfer.id || claimingAll ? (
                      <>
                        <Loader2 className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} animate-spin`} />
                        {isPopupMode ? '...' : (claimingAll ? 'Processing...' : 'Claiming...')}
                      </>
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
        )}

        {/* Transaction Modal */}
        <TransactionModal
          open={showTxModal}
          onOpenChange={setShowTxModal}
          status={txModalStatus}
          result={txModalResult}
          type="claim"
        />
      </CardContent>
    </Card>
  );
}