import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Wallet, Shield, Unlock, Gift } from 'lucide-react';
import { Wallet as WalletType } from '../types/wallet';
import { fetchBalance, fetchEncryptedBalance, getPendingPrivateTransfers } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { DecryptBalanceDialog } from './DecryptBalanceDialog';

interface PrivateBalanceProps {
  wallet: WalletType | null;
  balance: number | null;
  encryptedBalance?: any;
  onEncryptedBalanceUpdate?: (encryptedBalance: any) => void;
  onBalanceUpdate: (balance: number) => void;
  isLoading?: boolean;
  hideBorder?: boolean;
  isPopupMode?: boolean;
}

export function PrivateBalance({ 
  wallet, 
  balance, 
  encryptedBalance: propEncryptedBalance, 
  onEncryptedBalanceUpdate, 
  onBalanceUpdate, 
  isLoading = false,
  hideBorder = false,
  isPopupMode = false
}: PrivateBalanceProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [localEncryptedBalance, setLocalEncryptedBalance] = useState<any>(null);
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);
  const [showDecryptDialog, setShowDecryptDialog] = useState(false);
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
        }
      } catch (encError) {
        console.error('Failed to fetch encrypted balance:', encError);
      }
      
      try {
        const pending = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
        setPendingTransfers(pending);
      } catch (error) {
        console.error('Failed to fetch pending transfers:', error);
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
    // Only fetch if encryptedBalance is not provided via props
    if (wallet && !propEncryptedBalance) {
      fetchBalance(wallet.address)
        .then(async (balanceData) => {
          try {
            const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
            if (encData) {
              setEncryptedBalance(encData);
            }
          } catch (error) {
            console.error('Failed to fetch encrypted balance on mount:', error);
          }

          try {
            const pending = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
            setPendingTransfers(pending);
          } catch (error) {
            console.error('Failed to fetch pending transfers on mount:', error);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch balance on mount:', error);
        });
    } else if (wallet && propEncryptedBalance) {
      // Only fetch pending transfers if encryptedBalance is provided
      getPendingPrivateTransfers(wallet.address, wallet.privateKey)
        .then(setPendingTransfers)
        .catch((error) => {
          console.error('Failed to fetch pending transfers on mount:', error);
        });
    }
  }, [wallet, propEncryptedBalance]);

  const handleDecryptSuccess = () => {
    setShowDecryptDialog(false);
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
      <Card className={hideBorder ? 'border-0 shadow-none' : 'border-[#0000db]/20'}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-[#0000db] text-base">
            <Shield className="h-4 w-4" />
            Overview
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchWalletBalance}
            disabled={refreshing}
            className={`border-[#0000db]/30 hover:bg-[#0000db]/5 ${isPopupMode ? 'h-7 px-2' : ''}`}
          >
            <RefreshCw className={`h-4 w-4 ${isPopupMode ? '' : 'mr-1.5'} ${refreshing ? 'animate-spin' : ''}`} />
            {!isPopupMode && 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent className="pt-2 pb-4">
          {/* Private Balance Display */}
          <div className="text-center py-3 bg-[#0000db]/5 rounded-lg">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Shield className="h-4 w-4 text-[#0000db]" />
              <span className="text-xs font-medium text-[#0000db]">Available</span>
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-40 mx-auto" />
            ) : (
              <div className="flex items-center justify-center gap-2">
                <div className="text-3xl font-bold text-[#0000db]">
                  {encryptedBalance ? encryptedBalance.encrypted.toFixed(8) : '0.00000000'}
                </div>
                <Badge className="bg-[#0000db] text-white text-xs font-bold">OCT</Badge>
              </div>
            )}
          </div>

          {/* Pending Transfers */}
          {pendingTransfers.length > 0 && (
            <div className="flex items-center justify-between p-2.5 mt-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">
                  Claimable Transfers
                </span>
              </div>
              <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                {pendingTransfers.length} pending
              </Badge>
            </div>
          )}

          {/* Decrypt Action */}
          <div className="flex justify-center pt-3 mt-3 border-t">
            <Button
              size="sm"
              onClick={() => setShowDecryptDialog(true)}
              disabled={!encryptedBalance || encryptedBalance.encrypted <= 0}
              className="flex items-center gap-1.5 bg-[#0000db] hover:bg-[#0000db]/90"
            >
              <Unlock className="h-3.5 w-3.5" />
              Decrypt OCT
            </Button>
          </div>
        </CardContent>
      </Card>

      <DecryptBalanceDialog
        open={showDecryptDialog}
        onOpenChange={setShowDecryptDialog}
        wallet={wallet}
        encryptedBalance={encryptedBalance?.encrypted || 0}
        onSuccess={handleDecryptSuccess}
        isPopupMode={isPopupMode}
      />
    </div>
  );
}
