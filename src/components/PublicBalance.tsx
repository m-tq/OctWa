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
import { ExportPrivateKeys } from './ExportPrivateKeys';

interface PublicBalanceProps {
  wallet: WalletType | null;
  balance: number | null;
  encryptedBalance?: any;
  onEncryptedBalanceUpdate?: (encryptedBalance: any) => void;
  onBalanceUpdate: (balance: number) => void;
  isLoading?: boolean;
}

export function PublicBalance({ 
  wallet, 
  balance, 
  encryptedBalance: propEncryptedBalance, 
  onEncryptedBalanceUpdate, 
  onBalanceUpdate, 
  isLoading = false 
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
      
      toast({
        title: "Balance Updated",
        description: "Balance has been refreshed successfully",
      });
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
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Public Balance
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchWalletBalance} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Public Balance Display */}
          <div className="text-center py-4">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Wallet className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Available Balance</span>
            </div>
            {isLoading ? (
              <Skeleton className="h-12 w-48 mx-auto" />
            ) : (
              <div className="flex items-center justify-center gap-2">
                <div className="text-4xl font-bold">
                  {balance !== null ? balance.toFixed(8) : '0.00000000'}
                </div>
                <Badge variant="secondary" className="text-sm font-bold">OCT</Badge>
              </div>
            )}
          </div>

          {/* Total Balance Info */}
          {encryptedBalance && encryptedBalance.encrypted > 0 && (
            <div className="pt-4 border-t text-center">
              <span className="text-sm text-muted-foreground">
                Total (incl. private): {encryptedBalance.total.toFixed(8)} OCT
              </span>
            </div>
          )}

          {/* Encrypt Action */}
          <div className="flex justify-center pt-4 border-t">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => setShowEncryptDialog(true)}
                      disabled={!balance || balance <= 0.005}
                      className="flex items-center gap-2"
                    >
                      <Lock className="h-4 w-4" />
                      Encrypt OCT
                    </Button>
                  </div>
                </TooltipTrigger>
                {(!balance || balance <= 0.005) && (
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p className="text-xs">
                      Insufficient balance. Need more than 0.005 OCT to encrypt.
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      <ExportPrivateKeys wallet={wallet} />

      <EncryptBalanceDialog
        open={showEncryptDialog}
        onOpenChange={setShowEncryptDialog}
        wallet={wallet}
        publicBalance={balance || 0}
        onSuccess={handleEncryptSuccess}
      />
    </div>
  );
}
