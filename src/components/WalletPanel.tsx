/**
 * WalletPanel - Wallet-specific functionality panel
 * Includes keys, accounts, and permissions management
 * 
 * Requirements: 6.1
 */

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Wallet as WalletIcon,
  Key,
  Shield,
  Copy,
  Eye,
  EyeOff,
  Globe,
  ChevronRight,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { getPermissionManager } from '../permissions/permissionManager';
import { GrantedCapabilities } from '../permissions/types';

const CLIPBOARD_CLEAR_DELAY = 30000;

interface WalletPanelProps {
  /** Current active wallet */
  wallet: Wallet;
  /** All available wallets */
  wallets: Wallet[];
  /** Callback when wallet is switched */
  onSwitchWallet?: (wallet: Wallet) => void;
  /** Callback to open connected dApps manager */
  onOpenDAppsManager?: () => void;
  /** Custom class name */
  className?: string;
}

export function WalletPanel({
  wallet,
  wallets,
  onSwitchWallet,
  onOpenDAppsManager,
  className = '',
}: WalletPanelProps) {
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [connectedDApps, setConnectedDApps] = useState<GrantedCapabilities[]>([]);
  const { toast } = useToast();
  const clipboardTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load connected dApps on mount
  useEffect(() => {
    const pm = getPermissionManager();
    setConnectedDApps(pm.getAllGrantedCapabilities());
  }, []);

  // Cleanup clipboard timeout on unmount
  useEffect(() => {
    return () => {
      if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
    };
  }, []);

  const copyToClipboard = async (text: string, label: string, isSensitive = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isSensitive) {
        if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
        clipboardTimeoutRef.current = setTimeout(async () => {
          try {
            await navigator.clipboard.writeText('');
            toast({ title: "Security", description: "Clipboard cleared" });
          } catch { /* ignore */ }
        }, CLIPBOARD_CLEAR_DELAY);
        toast({ title: 'Copied!', description: `${label} copied (auto-clears in 30s)` });
      } else {
        toast({ title: 'Copied!', description: `${label} copied to clipboard` });
      }
    } catch {
      toast({ title: 'Error', description: 'Copy failed', variant: 'destructive' });
    }
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const walletIndex = wallets.findIndex((w) => w.address === wallet.address);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Active Wallet Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletIcon className="h-4 w-4" />
            Active Wallet
            <Badge variant="secondary" className="ml-auto">
              #{walletIndex + 1}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Address */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Address</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-muted px-2 py-1 truncate">
                {wallet.address}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(wallet.address, 'Address')}
                className="h-8 w-8 p-0"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Public Key */}
          {wallet.publicKey && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Public Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-muted px-2 py-1 truncate">
                  {truncateAddress(wallet.publicKey)}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(wallet.publicKey!, 'Public Key')}
                  className="h-8 w-8 p-0"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {/* Private Key (hidden by default) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Key className="h-3 w-3" />
              Private Key
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-muted px-2 py-1 truncate">
                {showPrivateKey ? wallet.privateKey : '••••••••••••••••'}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
                className="h-8 w-8 p-0"
              >
                {showPrivateKey ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
              {showPrivateKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(wallet.privateKey, 'Private Key', true)}
                  className="h-8 w-8 p-0"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Other Wallets */}
      {wallets.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <WalletIcon className="h-4 w-4" />
              Other Accounts
              <Badge variant="outline" className="ml-auto">
                {wallets.length - 1}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[150px]">
              <div className="space-y-2">
                {wallets
                  .filter((w) => w.address !== wallet.address)
                  .map((w, i) => (
                    <div
                      key={w.address}
                      className="flex items-center justify-between p-2 hover:bg-muted/50 cursor-pointer"
                      onClick={() => onSwitchWallet?.(w)}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          #{wallets.indexOf(w) + 1}
                        </Badge>
                        <span className="text-sm font-mono">
                          {truncateAddress(w.address)}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Connected dApps Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Connected dApps
            <Badge variant="outline" className="ml-auto">
              {connectedDApps.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {connectedDApps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No dApps connected yet
            </p>
          ) : (
            <div className="space-y-2">
              {connectedDApps.slice(0, 3).map((dapp) => (
                <div
                  key={dapp.origin}
                  className="flex items-center justify-between p-2 bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm truncate max-w-[150px]">
                      {dapp.appName}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {dapp.capabilities.length} permissions
                  </Badge>
                </div>
              ))}
              {connectedDApps.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenDAppsManager}
                  className="w-full text-xs"
                >
                  View all {connectedDApps.length} connections
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
