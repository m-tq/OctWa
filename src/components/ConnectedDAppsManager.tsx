/**
 * ConnectedDAppsManager — list and revoke RFC-O-1 dApp sessions.
 *
 * Reads `connectedDApps` from `chrome.storage.local` (or the `localStorage`
 * mirror in non-extension contexts). Each entry is a connection that
 * background.js created during `octra_requestAccounts`. Disconnecting
 * removes the entry — the dApp must call `connect()` again to regain access.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import {
  Globe,
  ExternalLink,
  MoreVertical,
  Unplug,
  RefreshCw,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { startMinDuration } from '@/utils/minLoading';

/**
 * Shape written by `background.js → saveConnection`.
 * `connectedDApps` is stored as a map keyed by canonical origin.
 */
interface StoredConnection {
  appOrigin: string;
  walletAddress: string;
  permissions: string[];
  network: 'mainnet' | 'devnet';
  connectedAt: number;
}

type ConnectionMap = Record<string, StoredConnection>;

interface ConnectedDAppsManagerProps {
  wallets: Wallet[];
  onClose?: () => void;
  isPopupMode?: boolean;
}

const STORAGE_KEY = 'connectedDApps';
const isExtension =
  typeof chrome !== 'undefined' && !!chrome.storage?.local;

/**
 * Canonicalize an origin so cosmetic differences ("https://x.com" vs
 * "https://x.com/") collapse to a single key.
 */
function canonicalizeOrigin(origin: string | undefined | null): string {
  if (!origin) return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Normalise the stored value to a canonical-key map. Older builds may have
 * persisted an array — accept both shapes and emit the map shape consistently.
 */
function normalizeConnections(raw: unknown): ConnectionMap {
  if (!raw) return {};
  const out: ConnectionMap = {};

  const insert = (entry: Partial<StoredConnection> | null | undefined) => {
    if (!entry?.appOrigin) return;
    const key = canonicalizeOrigin(entry.appOrigin);
    if (!key) return;
    const existing = out[key];
    if (!existing || (entry.connectedAt ?? 0) > (existing.connectedAt ?? 0)) {
      out[key] = {
        appOrigin: key,
        walletAddress: entry.walletAddress ?? '',
        permissions: Array.isArray(entry.permissions) ? entry.permissions : [],
        network: entry.network === 'devnet' ? 'devnet' : 'mainnet',
        connectedAt: entry.connectedAt ?? 0,
      };
    }
  };

  if (Array.isArray(raw)) {
    for (const conn of raw) insert(conn as Partial<StoredConnection>);
  } else if (typeof raw === 'object') {
    for (const conn of Object.values(raw as Record<string, unknown>)) {
      insert(conn as Partial<StoredConnection>);
    }
  }
  return out;
}

export function ConnectedDAppsManager({
  wallets,
  isPopupMode = false,
}: ConnectedDAppsManagerProps) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let raw: unknown;
      if (isExtension) {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        raw = result[STORAGE_KEY];
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        raw = stored ? JSON.parse(stored) : {};
      }

      const map = normalizeConnections(raw);
      const entries = Object.values(map).sort(
        (a, b) => (b.connectedAt ?? 0) - (a.connectedAt ?? 0),
      );

      // Mirror canonical map back to storage so the next read is clean.
      if (isExtension) {
        await chrome.storage.local.set({ [STORAGE_KEY]: map });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));

      setConnections(entries);
    } catch (error) {
      console.error('[ConnectedDAppsManager] Failed to load:', error);
      setConnections([]);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    if (isExtension) {
      const onChanged = (
        changes: { [key: string]: chrome.storage.StorageChange },
        namespace: string,
      ) => {
        if (namespace !== 'local' || !changes[STORAGE_KEY]) return;
        const map = normalizeConnections(changes[STORAGE_KEY].newValue);
        setConnections(
          Object.values(map).sort(
            (a, b) => (b.connectedAt ?? 0) - (a.connectedAt ?? 0),
          ),
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const map = normalizeConnections(JSON.parse(event.newValue));
        setConnections(
          Object.values(map).sort(
            (a, b) => (b.connectedAt ?? 0) - (a.connectedAt ?? 0),
          ),
        );
      } catch {
        /* ignore malformed payloads */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadData]);

  const persistMap = async (map: ConnectionMap) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    if (isExtension) {
      await chrome.storage.local.set({ [STORAGE_KEY]: map });
    }
  };

  const handleDisconnect = async (connection: StoredConnection) => {
    try {
      const next: ConnectionMap = {};
      for (const c of connections) {
        if (c.appOrigin !== connection.appOrigin) next[c.appOrigin] = c;
      }
      await persistMap(next);
      setConnections(Object.values(next));
      toast({
        title: 'Disconnected',
        description: `${formatHostname(connection.appOrigin)} can no longer access this wallet until it requests connection again.`,
      });
    } catch (error) {
      console.error('[ConnectedDAppsManager] Disconnect error:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect dApp',
        variant: 'destructive',
      });
    }
  };

  const handleDisconnectAll = async () => {
    try {
      await persistMap({});
      setConnections([]);
      toast({
        title: 'All Disconnected',
        description: 'All dApps have been disconnected.',
      });
    } catch (error) {
      console.error('[ConnectedDAppsManager] Disconnect all error:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect all dApps',
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = async () => {
    const done = startMinDuration();
    await loadData();
    await done();
    toast({
      title: 'Refreshed',
      description: 'dApp connections list updated',
    });
  };

  return (
    <div className={isPopupMode ? 'space-y-3' : 'space-y-6'}>
      <Card className={isPopupMode ? 'border-0 shadow-none' : ''}>
        <CardHeader
          className={`flex flex-row items-center justify-between space-y-0 mb-2 ${
            isPopupMode ? 'p-0 pb-1' : 'pb-2'
          }`}
        >
          <CardTitle
            className={`flex items-center gap-2 ${isPopupMode ? 'text-sm' : ''}`}
          >
            <Globe className={isPopupMode ? 'h-4 w-4' : 'h-5 w-5'} />
            Connected dApps
            {connections.length > 0 && (
              <Badge
                variant="secondary"
                className={isPopupMode ? 'text-[10px] px-1 py-0' : 'ml-2'}
              >
                {connections.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={isPopupMode ? 'h-7 w-7 p-0' : ''}
              title="Refresh connections"
            >
              <RefreshCw
                className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            {connections.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`text-red-600 hover:text-red-700 ${
                      isPopupMode ? 'h-7 text-[10px] px-2' : ''
                    }`}
                  >
                    <Unplug
                      className={isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'}
                    />
                    {isPopupMode ? 'All' : 'Disconnect All'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  className={isPopupMode ? 'w-[320px] p-4' : ''}
                  aria-describedby="disconnect-all-description"
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle className={isPopupMode ? 'text-sm' : ''}>
                      Disconnect All dApps
                    </AlertDialogTitle>
                    <AlertDialogDescription
                      id="disconnect-all-description"
                      className={isPopupMode ? 'text-xs' : ''}
                    >
                      This will remove every dApp's session. Each dApp must
                      call <code>connect()</code> again before it can interact
                      with your wallet.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      className={isPopupMode ? 'h-8 text-xs' : ''}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDisconnectAll}
                      className={`bg-red-600 hover:bg-red-700 ${
                        isPopupMode ? 'h-8 text-xs' : ''
                      }`}
                    >
                      Disconnect All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>

        <CardContent className={isPopupMode ? 'p-0' : ''}>
          {connections.length === 0 ? (
            <div
              className={`flex items-center gap-2 text-muted-foreground ${
                isPopupMode ? 'py-2 text-xs' : 'py-4'
              }`}
            >
              <Globe
                className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} shrink-0`}
              />
              <span>
                No connected dApps. Connect to a dApp to see it here.
              </span>
            </div>
          ) : (
            <div className={isPopupMode ? 'space-y-2' : 'space-y-4'}>
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.appOrigin}
                  connection={connection}
                  wallets={wallets}
                  isPopupMode={isPopupMode}
                  onDisconnect={() => handleDisconnect(connection)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Sub-components & helpers
// =============================================================================

function ConnectionRow({
  connection,
  wallets,
  isPopupMode,
  onDisconnect,
}: {
  connection: StoredConnection;
  wallets: Wallet[];
  isPopupMode: boolean;
  onDisconnect: () => void;
}) {
  const hostname = formatHostname(connection.appOrigin);
  const walletInfo = describeWallet(connection.walletAddress, wallets);

  return (
    <div
      className={`border rounded-lg hover:bg-muted/50 transition-colors ${
        isPopupMode ? 'p-2' : 'p-4'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Avatar className={isPopupMode ? 'h-8 w-8' : 'h-10 w-10'}>
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {hostname.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className={`font-medium truncate ${
                  isPopupMode ? 'text-xs' : 'text-sm'
                }`}
              >
                {hostname}
              </h3>
              <Badge
                variant="outline"
                className={isPopupMode ? 'text-[8px] px-1' : 'text-xs'}
              >
                {connection.network}
              </Badge>
            </div>
            <p
              className={`text-muted-foreground truncate ${
                isPopupMode ? 'text-[10px]' : 'text-xs'
              }`}
            >
              {connection.appOrigin}
            </p>
            <p
              className={`text-muted-foreground truncate ${
                isPopupMode ? 'text-[10px]' : 'text-xs'
              }`}
            >
              Connected {formatDate(connection.connectedAt)}
            </p>
            <div
              className={`flex items-center gap-1 mt-0.5 ${
                isPopupMode ? 'text-[10px]' : 'text-xs'
              }`}
            >
              <WalletIcon
                className={`shrink-0 text-[#3B567F] ${
                  isPopupMode ? 'h-2.5 w-2.5' : 'h-3 w-3'
                }`}
              />
              <span className="text-[#3B567F] font-medium font-mono truncate">
                {walletInfo.label}
              </span>
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 w-8 p-0'}
            >
              <MoreVertical
                className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[9999]">
            <DropdownMenuItem
              onClick={() => window.open(connection.appOrigin, '_blank')}
              className={isPopupMode ? 'text-xs' : ''}
            >
              <ExternalLink
                className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mr-2`}
              />
              Visit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDisconnect}
              className={`text-red-600 ${isPopupMode ? 'text-xs' : ''}`}
            >
              <Unplug
                className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mr-2`}
              />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {connection.permissions.length > 0 && (
        <div className={`mt-2 pt-2 ${isPopupMode ? 'space-y-1' : 'space-y-2'}`}>
          <p
            className={`text-muted-foreground ${
              isPopupMode ? 'text-[10px]' : 'text-xs'
            }`}
          >
            Granted Permissions ({connection.permissions.length}):
          </p>
          <div className="flex flex-wrap gap-1">
            {connection.permissions.map((perm) => (
              <Badge
                key={perm}
                variant="secondary"
                className={`font-mono ${
                  isPopupMode ? 'text-[8px] px-1' : 'text-[10px]'
                }`}
              >
                {perm}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function describeWallet(
  address: string,
  wallets: Wallet[],
): { label: string } {
  if (!address) return { label: '—' };
  const idx = wallets.findIndex((w) => w.address === address);
  const short = `${address.slice(0, 8)}…${address.slice(-4)}`;
  return {
    label: idx >= 0 ? `Wallet ${idx + 1} · ${short}` : short,
  };
}

function formatHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
