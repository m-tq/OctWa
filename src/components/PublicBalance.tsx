import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Wallet, Lock, Globe } from 'lucide-react';
import { Wallet as WalletType } from '../types/wallet';
import { fetchBalance, fetchEncryptedBalance } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { EncryptBalanceDialog } from './EncryptBalanceDialog';

interface PublicBalanceProps {
  wallet: WalletType | null;
  balance: number | null;
  encryptedBalance?: any;
  onEncryptedBalanceUpdate?: (encryptedBalance: any) => void;
  onBalanceUpdate: (balance: number) => void;
  isLoading?: boolean;
  hideBorder?: boolean;
  isPopupMode?: boolean;
}

export function PublicBalance({ 
  wallet, 
  balance, 
  encryptedBalance: propEncryptedBalance, 
  onEncryptedBalanceUpdate, 
  onBalanceUpdate, 
  isLoading = false,
  hideBorder = false,
  isPopupMode = false
}: PublicBalanceProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [localEncryptedBalance, setLocalEncryptedBalance] = useState<any>(null);
  const [showEncryptDialog, setShowEncryptDialog] = useState(false);
  const { toast } = useToast();

  const encryptedBalance = propEncryptedBalance || localEncryptedBalance;
  const setEncryptedBalance = onEncryptedBalanceUpdate || setLocalEncryptedBalance;

  const fetchWalletBalance = async () => {
    if (!wallet) return;
    
    setRefreshing(true);
    try {
      const balanceData = await fetchBalance(wallet.address);
      onBalanceUpdate(balanceData.balance);
      
      try {
        const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
        if (encData) {
          setEncryptedBalance(encData);
        } else {
          setEncryptedBalance({
            public: balanceData.balance,
            public_raw: Math.floor(balanceData.balance * 1_000_000),
            encrypted: 0,
            encrypted_raw: 0,
            total: balanceData.balance
          });
        }
      } catch (encError) {
        console.error('Failed to fetch encrypted balance:', encError);
      }
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to refresh balance.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (wallet) {
      fetchBalance(wallet.address)
        .then(async (balanceData) => {
          try {
            const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
            if (encData) {
              setEncryptedBalance(encData);
            } else {
              setEncryptedBalance({
                public: balanceData.balance,
                public_raw: Math.floor(balanceData.balance * 1_000_000),
                encrypted: 0,
                encrypted_raw: 0,
                total: balanceData.balance
              });
            }
          } catch (error) {
            console.error('Failed to fetch encrypted balance on mount:', error);
          }
        })
        .catch(error => {
          console.error('Failed to fetch balance on mount:', error);
        });
    }
  }, [wallet]);

  const handleEncryptSuccess = () => {
    setShowEncryptDialog(false);
    fetchWalletBalance();
  };

  if (!wallet) {
    return (
      <Alert>
        <Wallet className="h-4 w-4" />
        <AlertDescription>No wallet available.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card className={hideBorder ? 'border-0 shadow-none' : ''}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Overview
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchWalletBalance} disabled={refreshing} className={isPopupMode ? 'h-7 px-2' : ''}>
            <RefreshCw className={`h-4 w-4 ${isPopupMode ? '' : 'mr-1.5'} ${refreshing ? 'animate-spin' : ''}`} />
            {!isPopupMode && 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent className="pt-2 pb-4">
          {/* Public Balance Display */}
          <div className="text-center py-3">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Available</span>
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-40 mx-auto" />
            ) : (
              <div className="flex items-center justify-center gap-2">
                <div className="text-3xl font-bold">
                  {balance !== null ? balance.toFixed(8) : '0.00000000'}
                </div>
                <Badge variant="secondary" className="text-xs font-bold">OCT</Badge>
              </div>
            )}
          </div>

          {/* Total Balance Info */}
          {encryptedBalance && encryptedBalance.encrypted > 0 && (
            <div className="pt-3 mt-3 border-t text-center">
              <span className="text-xs text-muted-foreground">
                Total (incl. private): {encryptedBalance.total.toFixed(8)} OCT
              </span>
            </div>
          )}

          {/* Encrypt Action */}
          <div className="flex justify-center pt-3 mt-3 border-t">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowEncryptDialog(true)}
                      disabled={!balance || balance <= 0.001}
                      className="flex items-center gap-1.5"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Encrypt OCT
                    </Button>
                  </span>
                </TooltipTrigger>
                {(!balance || balance <= 0.001) && (
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p className="text-xs">
                      Insufficient balance. Need more than 0.001 OCT to encrypt.
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      <EncryptBalanceDialog
        open={showEncryptDialog}
        onOpenChange={setShowEncryptDialog}
        wallet={wallet}
        publicBalance={balance || 0}
        onSuccess={handleEncryptSuccess}
        isPopupMode={isPopupMode}
      />
    </div>
  );
}
