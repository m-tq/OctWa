import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Wallet, Lock, Unlock, PieChart } from 'lucide-react';
import { Wallet as WalletType, EncryptedBalanceResponse } from '../types/wallet';
import { fetchBalance, fetchEncryptedBalance, getPendingPrivateTransfers } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { EncryptBalanceDialog } from './EncryptBalanceDialog';
import { DecryptBalanceDialog } from './DecryptBalanceDialog';
import { ExportPrivateKeys } from './ExportPrivateKeys';
import { InfoTooltip } from './InfoTooltip';
import { SensitiveActionButton } from './SensitiveActionButton';
import { logger } from '@/utils/logger';
import { startMinDuration, useMinDurationFlag } from '@/utils/minLoading';

interface BalanceProps {
  wallet: WalletType | null;
  balance: number | null;
  encryptedBalance?: EncryptedBalanceResponse | null;
  onEncryptedBalanceUpdate?: (encryptedBalance: EncryptedBalanceResponse | null) => void;
  onBalanceUpdate: (balance: number) => void;
  isLoading?: boolean;
  isLoadingEncrypted?: boolean;
}

export function Balance({
  wallet,
  balance,
  encryptedBalance: propEncryptedBalance,
  onEncryptedBalanceUpdate,
  onBalanceUpdate,
  isLoading = false,
  isLoadingEncrypted = false,
}: BalanceProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [localEncryptedBalance, setLocalEncryptedBalance] = useState<EncryptedBalanceResponse | null>(null);
  const [pendingTransfers, setPendingTransfers] = useState<{ id: string }[]>([]);
  const [showEncryptDialog, setShowEncryptDialog] = useState(false);
  const [showDecryptDialog, setShowDecryptDialog] = useState(false);
  const { toast } = useToast();

  const encryptedBalance = propEncryptedBalance || localEncryptedBalance;
  const setEncryptedBalance = onEncryptedBalanceUpdate || setLocalEncryptedBalance;

  // Keep skeletons visible for a short floor so they don't flash on warm caches.
  const showPublicSkeleton = useMinDurationFlag(isLoading, 250);
  const showEncryptedSkeleton = useMinDurationFlag(isLoadingEncrypted, 250);

  const fetchWalletBalance = async () => {
    if (!wallet) return;
    setRefreshing(true);
    const done = startMinDuration();
    try {
      const balanceData = await fetchBalance(wallet.address);
      onBalanceUpdate(balanceData.balance);
      try {
        const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
        setEncryptedBalance(encData ?? {
          public: balanceData.balance,
          public_raw: Math.floor(balanceData.balance * 1_000_000),
          encrypted: 0,
          encrypted_raw: 0,
          total: balanceData.balance,
        });
      } catch (encError) {
        logger.error('Failed to fetch encrypted balance', encError);
        setEncryptedBalance({
          public: balanceData.balance,
          public_raw: Math.floor(balanceData.balance * 1_000_000),
          encrypted: 0,
          encrypted_raw: 0,
          total: balanceData.balance,
        });
      }
      try {
        const pending = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
        setPendingTransfers(pending);
      } catch (error) {
        logger.warn('Failed to fetch pending transfers', error);
      }
      toast({ title: 'balance updated', description: 'balance has been refreshed' });
    } catch (error) {
      toast({
        title: 'error',
        description: 'failed to refresh balance. check rpc connection.',
        variant: 'destructive',
      });
      logger.error('Balance fetch error', error);
    } finally {
      await done();
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!wallet) return;
    fetchBalance(wallet.address)
      .then(balanceData =>
        fetchEncryptedBalance(wallet.address, wallet.privateKey)
          .then(encData => {
            setEncryptedBalance(encData ?? {
              public: balanceData.balance,
              public_raw: Math.floor(balanceData.balance * 1_000_000),
              encrypted: 0,
              encrypted_raw: 0,
              total: balanceData.balance,
            });
          })
          .then(() =>
            getPendingPrivateTransfers(wallet.address, wallet.privateKey)
              .then(setPendingTransfers)
              .catch(err => {
                logger.warn('Failed to fetch pending transfers on mount', err);
                setPendingTransfers([]);
              })
          )
      )
      .catch(err => {
        logger.error('Failed to fetch balance on mount', err);
        setEncryptedBalance({ public: 0, public_raw: 0, encrypted: 0, encrypted_raw: 0, total: 0 });
        setPendingTransfers([]);
      });
  }, [wallet]);

  if (!wallet) {
    return (
      <Alert>
        <div className="flex items-start gap-2">
          <Wallet className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <AlertDescription>
            no wallet available. please generate or import a wallet first.
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Balance overview card ── */}
      <Card>
        {/* Card header — section title style */}
        <CardHeader className="flex flex-row items-center justify-between py-1.5">
          <CardTitle className="flex items-center gap-1.5">
            <PieChart className="h-3.5 w-3.5" />
            wallet overview
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchWalletBalance}
            disabled={refreshing}
            aria-label="Refresh balance"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            refresh
          </Button>
        </CardHeader>

        <CardContent className="space-y-0 p-0">

          {/* ── Metrics row — public + private balance ── */}
          <div className="flex border-b border-oc-border balance-overview">

            {/* Public balance */}
            <div className="flex-1 px-3 py-2 border-r border-oc-border balance-item">
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet className="h-3 w-3 text-oc-primary" />
                <span className="text-muted-foreground lowercase" style={{ fontSize: 'var(--oct-type-size-02)' }}>
                  public balance
                </span>
              </div>
              {showPublicSkeleton ? (
                <Skeleton className="h-5 w-28" />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-bold text-primary font-mono"
                    style={{ fontSize: 'var(--oct-type-size-03)' }}
                  >
                    {balance !== null ? balance.toFixed(8) : '0.00000000'}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">OCT</Badge>
                </div>
              )}
            </div>

            {/* Private balance */}
            <div className="flex-1 px-3 py-2 balance-item">
              <div className="flex items-center gap-1.5 mb-1">
                <Lock className="h-3 w-3 text-oc-warning" />
                <span className="text-muted-foreground lowercase" style={{ fontSize: 'var(--oct-type-size-02)' }}>
                  private balance
                </span>
                <InfoTooltip
                  content="Funds processed using fully homomorphic encryption. Visible only to you."
                  side="top"
                />
              </div>
              {showEncryptedSkeleton ? (
                <Skeleton className="h-5 w-28" />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-bold font-mono"
                    style={{ fontSize: 'var(--oct-type-size-03)', color: 'hsl(var(--oc-warning))' }}
                  >
                    {encryptedBalance ? encryptedBalance.encrypted.toFixed(8) : '0.00000000'}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">OCT</Badge>
                </div>
              )}
            </div>
          </div>

          {/* ── Total balance row ── */}
          {encryptedBalance && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-oc-border bg-oc-surface-muted">
              <span className="text-muted-foreground lowercase" style={{ fontSize: 'var(--oct-type-size-02)' }}>
                total balance
              </span>
              <span
                className="font-bold font-mono text-oc-success"
                style={{ fontSize: 'var(--oct-type-size-02)' }}
              >
                {encryptedBalance.total.toFixed(8)} OCT
              </span>
            </div>
          )}

          {/* ── Pending transfers row ── */}
          {pendingTransfers.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-oc-border">
              <span className="text-muted-foreground lowercase" style={{ fontSize: 'var(--oct-type-size-02)' }}>
                claimable transfers
              </span>
              <Badge variant="warning">{pendingTransfers.length} pending</Badge>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="px-3 py-2 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEncryptDialog(true)}
                disabled={!balance || balance <= 1}
              >
                <Lock className="h-3.5 w-3.5 mr-1.5" />
                encrypt balance
              </Button>
            </div>

            {/* Sensitive actions — clearly separated */}
            <div
              className="flex flex-wrap gap-2 pt-2 border-t border-dashed"
              style={{ borderColor: 'hsl(var(--oc-warning) / 0.3)' }}
            >
              <p
                className="w-full"
                style={{ fontSize: 'var(--oct-type-size-01)', color: 'hsl(var(--oc-warning) / 0.7)' }}
              >
                sensitive actions
              </p>
              <SensitiveActionButton
                size="sm"
                onClick={() => setShowDecryptDialog(true)}
                disabled={!encryptedBalance || encryptedBalance.encrypted <= 0}
                tooltipText="Converts private OCT back to public OCT. Your balance will become visible."
              >
                <Unlock className="h-3.5 w-3.5 mr-1.5" />
                decrypt
              </SensitiveActionButton>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export private keys */}
      <ExportPrivateKeys wallet={wallet} />

      {/* Dialogs */}
      <EncryptBalanceDialog
        open={showEncryptDialog}
        onOpenChange={setShowEncryptDialog}
        wallet={wallet}
        publicBalance={balance || 0}
        onSuccess={() => fetchWalletBalance()}
      />
      <DecryptBalanceDialog
        open={showDecryptDialog}
        onOpenChange={setShowDecryptDialog}
        wallet={wallet}
        encryptedBalance={encryptedBalance?.encrypted || 0}
        currentCipher={encryptedBalance?.cipher}
        onSuccess={() => fetchWalletBalance()}
      />
    </div>
  );
}
