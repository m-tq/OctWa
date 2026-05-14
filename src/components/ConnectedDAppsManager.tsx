/**
 * ConnectedDAppsManager - Manage connected dApps and their capabilities
 * 
 * Syncs with both localStorage (web) and chrome.storage.local (extension)
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

import { 
  Globe, 
  Shield, 
  ExternalLink,
  MoreVertical,
  Unplug,
  Eye,
  Edit,
  Cpu,
  RefreshCw,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { startMinDuration } from '@/utils/minLoading';

// Connection stored in localStorage/chrome.storage
interface StoredConnection {
  circle: string;
  appOrigin: string;
  appName: string;
  walletPubKey: string;
  evmAddress?: string;
  network: 'devnet' | 'mainnet';
  connectedAt: number;
}

// Capability stored in localStorage (matches SDK Capability type)
interface StoredCapability {
  id: string;
  version: 1;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  issuerPubKey: string;
  signature: string;
}

/**
 * Canonicalize an `appOrigin` so that two stored entries that came in
 * with cosmetic differences ("https://ons.octra.org" vs
 * "https://ons.octra.org/", or differing host casing) collapse to the
 * same key.
 *
 * Falls back to the raw value if the input cannot be parsed as a URL.
 */
function canonicalizeOrigin(origin: string | undefined | null): string {
  if (!origin) return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    // URL.origin already lowercases the hostname and strips path/query.
    return url.origin;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Defensive dedup of stored connections.
 *
 * background.js' `saveConnection` already filters by `appOrigin` before
 * persisting, but earlier extension builds did not — and a few existing
 * installs still carry duplicate rows from that period. Older code paths
 * that wrote directly to chrome.storage.local (capability flows, manual
 * imports) can also leave stragglers, sometimes with cosmetically
 * different origins (trailing slash, casing) that bypass the existing
 * exact-match filter.
 *
 * Rule: keep the most recent entry per canonicalized `appOrigin`. The
 * surviving row's stored `appOrigin` is rewritten to the canonical form
 * so subsequent writes from background.js continue to match it. If a
 * user has the same dApp connected from two different origins (e.g.
 * localhost dev vs production), both rows survive — that's intentional,
 * those are separate authorizations.
 */
function dedupeConnections(list: StoredConnection[]): StoredConnection[] {
  const byOrigin = new Map<string, StoredConnection>();
  for (const conn of list) {
    if (!conn?.appOrigin) continue;
    const key = canonicalizeOrigin(conn.appOrigin);
    if (!key) continue;
    const existing = byOrigin.get(key);
    if (!existing || (conn.connectedAt ?? 0) > (existing.connectedAt ?? 0)) {
      byOrigin.set(key, { ...conn, appOrigin: key });
    }
  }
  return [...byOrigin.values()].sort(
    (a, b) => (b.connectedAt ?? 0) - (a.connectedAt ?? 0),
  );
}

/**
 * Defensive dedup of capabilities per origin.
 * Same idea — older builds could record duplicate capability records
 * for the same (origin, scope) pair. Keep the freshest by `issuedAt`.
 * Capability map keys are also canonicalized so they line up with the
 * deduped connections list.
 */
function dedupeCapabilityMap(
  raw: Record<string, StoredCapability[]>,
): Record<string, StoredCapability[]> {
  const cleaned: Record<string, StoredCapability[]> = {};
  for (const [origin, caps] of Object.entries(raw)) {
    if (!Array.isArray(caps)) continue;
    const key = canonicalizeOrigin(origin);
    if (!key) continue;
    const byScope = new Map<string, StoredCapability>();
    // Seed with anything we already collected under the canonical key,
    // so two raw keys that canonicalize to the same value merge.
    for (const cap of cleaned[key] ?? []) {
      byScope.set(cap.scope, cap);
    }
    for (const cap of caps) {
      if (!cap?.scope) continue;
      const existing = byScope.get(cap.scope);
      if (!existing || (cap.issuedAt ?? 0) > (existing.issuedAt ?? 0)) {
        byScope.set(cap.scope, { ...cap, appOrigin: key });
      }
    }
    if (byScope.size) cleaned[key] = [...byScope.values()];
  }
  return cleaned;
}

interface ConnectedDAppsManagerProps {
  wallets: Wallet[];
  onClose?: () => void;
  isPopupMode?: boolean;
}

// Check if running in extension context
const isExtension = typeof chrome !== 'undefined' && chrome.storage?.local;

export function ConnectedDAppsManager({
  wallets,
  isPopupMode = false,
}: ConnectedDAppsManagerProps) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, StoredCapability[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  // Load data from both localStorage and chrome.storage
  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let storedConnections: StoredConnection[] = [];
      let storedCapabilities: Record<string, StoredCapability[]> = {};

      if (isExtension) {
        // Load from chrome.storage.local (extension)
        const result = await chrome.storage.local.get(['connectedDApps', 'capabilities']);
        storedConnections = result.connectedDApps || [];
        storedCapabilities = result.capabilities || {};
      } else {
        // Load from localStorage (web)
        storedConnections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
        storedCapabilities = JSON.parse(localStorage.getItem('capabilities') || '{}');
      }

      // Defensive dedup. If anything was duplicated, write the cleaned
      // list back so the duplicates stop coming back on next refresh.
      const dedupedConnections = dedupeConnections(storedConnections);
      const dedupedCapabilities = dedupeCapabilityMap(storedCapabilities);

      const connectionsChanged = dedupedConnections.length !== storedConnections.length;
      const capabilitiesChanged =
        Object.keys(dedupedCapabilities).length !== Object.keys(storedCapabilities).length ||
        Object.entries(dedupedCapabilities).some(
          ([origin, caps]) => (storedCapabilities[origin]?.length ?? 0) !== caps.length,
        );

      if (connectionsChanged || capabilitiesChanged) {
        localStorage.setItem('connectedDApps', JSON.stringify(dedupedConnections));
        localStorage.setItem('capabilities', JSON.stringify(dedupedCapabilities));
        if (isExtension) {
          await chrome.storage.local.set({
            connectedDApps: dedupedConnections,
            capabilities: dedupedCapabilities,
          });
        }
      } else if (isExtension) {
        // Mirror chrome.storage to localStorage for cross-context consistency
        localStorage.setItem('connectedDApps', JSON.stringify(dedupedConnections));
        localStorage.setItem('capabilities', JSON.stringify(dedupedCapabilities));
      }

      setConnections(dedupedConnections);
      setCapabilities(dedupedCapabilities);
    } catch (error) {
      console.error('[ConnectedDAppsManager] Failed to load data:', error);
      // Fallback to localStorage
      const storedConnections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
      const storedCapabilities = JSON.parse(localStorage.getItem('capabilities') || '{}');
      setConnections(dedupeConnections(storedConnections));
      setCapabilities(dedupeCapabilityMap(storedCapabilities));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Listen for storage changes (extension)
    if (isExtension) {
      const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, namespace: string) => {
        if (namespace === 'local') {
          if (changes.connectedDApps) {
            const fresh = dedupeConnections(changes.connectedDApps.newValue || []);
            setConnections(fresh);
            localStorage.setItem('connectedDApps', JSON.stringify(fresh));
          }
          if (changes.capabilities) {
            const fresh = dedupeCapabilityMap(changes.capabilities.newValue || {});
            setCapabilities(fresh);
            localStorage.setItem('capabilities', JSON.stringify(fresh));
          }
        }
      };
      
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }

    // Listen for localStorage changes (web - cross-tab sync)
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'connectedDApps' && e.newValue) {
        setConnections(dedupeConnections(JSON.parse(e.newValue)));
      }
      if (e.key === 'capabilities' && e.newValue) {
        setCapabilities(dedupeCapabilityMap(JSON.parse(e.newValue)));
      }
    };
    
    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, [loadData]);

  const handleDisconnect = async (connection: StoredConnection) => {
    try {
      // Remove connection
      const updatedConnections = connections.filter(
        (c) => c.appOrigin !== connection.appOrigin
      );

      // Remove capabilities for this origin
      const updatedCapabilities = { ...capabilities };
      delete updatedCapabilities[connection.appOrigin];

      // Save to both storages
      localStorage.setItem('connectedDApps', JSON.stringify(updatedConnections));
      localStorage.setItem('capabilities', JSON.stringify(updatedCapabilities));

      if (isExtension) {
        await chrome.storage.local.set({
          connectedDApps: updatedConnections,
          capabilities: updatedCapabilities,
        });
      }

      setConnections(updatedConnections);
      setCapabilities(updatedCapabilities);

      toast({
        title: 'Disconnected',
        description: `${connection.appName} has been disconnected. The dApp will need to request connection again.`,
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
      // Clear all connections and capabilities
      localStorage.setItem('connectedDApps', '[]');
      localStorage.setItem('capabilities', '{}');

      if (isExtension) {
        await chrome.storage.local.set({
          connectedDApps: [],
          capabilities: {},
        });
      }

      setConnections([]);
      setCapabilities({});

      toast({
        title: 'All Disconnected',
        description: 'All dApps have been disconnected. They will need to request connection again.',
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

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const shortenAddress = (addr: string) =>
    addr ? `${addr.slice(0, 8)}...${addr.slice(-4)}` : '';

  const getWalletLabel = (pubKey: string) => {
    const idx = wallets.findIndex(w => w.address === pubKey);
    return {
      index: idx >= 0 ? idx + 1 : null,
      address: shortenAddress(pubKey),
    };
  };

  const getScopeIcon = (scope: string) => {
    switch (scope) {
      case 'read':
        return <Eye className="h-3 w-3" />;
      case 'write':
        return <Edit className="h-3 w-3" />;
      case 'compute':
        return <Cpu className="h-3 w-3" />;
      default:
        return <Shield className="h-3 w-3" />;
    }
  };

  const getScopeColor = (scope: string) => {
    switch (scope) {
      case 'read':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'write':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
      case 'compute':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
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
              <RefreshCw className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} ${isRefreshing ? 'animate-spin' : ''}`} />
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
                    <Unplug className={isPopupMode ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />
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
                      This will disconnect all dApps and revoke all capabilities. 
                      Each dApp will need to request a new connection to interact with your wallet.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className={isPopupMode ? 'h-8 text-xs' : ''}>
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
            <div className={`flex items-center gap-2 text-muted-foreground ${isPopupMode ? 'py-2 text-xs' : 'py-4'}`}>
              <Globe className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} shrink-0`} />
              <span>No connected dApps. Connect to a dApp to see it here.</span>
            </div>
          ) : (
            <div className={isPopupMode ? 'space-y-2' : 'space-y-4'}>
              {connections.map((connection) => {
                const originCapabilities = capabilities[connection.appOrigin] || [];
                const activeCapabilities = originCapabilities.filter(
                  (c) => !c.expiresAt || c.expiresAt > Date.now()
                );

                return (
                  <div
                    key={connection.appOrigin}
                    className={`border rounded-lg hover:bg-muted/50 transition-colors ${
                      isPopupMode ? 'p-2' : 'p-4'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Avatar className={isPopupMode ? 'h-8 w-8' : 'h-10 w-10'}>
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                            {connection.appName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3
                              className={`font-medium truncate ${
                                isPopupMode ? 'text-xs' : 'text-sm'
                              }`}
                            >
                              {connection.appName}
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
                            Circle: {connection.circle}
                          </p>
                          <p
                            className={`text-muted-foreground truncate ${
                              isPopupMode ? 'text-[10px]' : 'text-xs'
                            }`}
                          >
                            Connected: {formatDate(connection.connectedAt)}
                          </p>
                          {/* Wallet info */}
                          {(() => {
                            const { index, address } = getWalletLabel(connection.walletPubKey);
                            return (
                              <div className={`flex items-center gap-1 mt-0.5 ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                                <WalletIcon className={`shrink-0 text-[#3B567F] ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
                                <span className="text-[#3B567F] font-medium font-mono truncate">
                                  {index ? `Wallet ${index} · ` : ''}{address}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 w-8 p-0'}
                          >
                            <MoreVertical className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="z-[9999]">
                          <DropdownMenuItem
                            onClick={() => window.open(connection.appOrigin, '_blank')}
                            className={isPopupMode ? 'text-xs' : ''}
                          >
                            <ExternalLink className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mr-2`} />
                            Visit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDisconnect(connection)}
                            className={`text-red-600 ${isPopupMode ? 'text-xs' : ''}`}
                          >
                            <Unplug className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} mr-2`} />
                            Disconnect
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Active Capabilities - deduplicated by scope */}
                    {activeCapabilities.length > 0 && (() => {
                      // Deduplicate by scope, keep the latest one
                      const deduped = activeCapabilities.reduce((acc, cap) => {
                        const existing = acc.find(c => c.scope === cap.scope);
                        if (!existing || cap.issuedAt > existing.issuedAt) {
                          return [...acc.filter(c => c.scope !== cap.scope), cap];
                        }
                        return acc;
                      }, [] as StoredCapability[]);
                      
                      return (
                        <div className={`mt-2 pt-2 ${isPopupMode ? 'space-y-1' : 'space-y-2'}`}>
                          <p className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                            Active Capabilities:
                          </p>
                          <div className="flex flex-col gap-1">
                            {deduped.map((cap) => (
                              <div key={cap.id} className="flex flex-col">
                                <Badge
                                  variant="secondary"
                                  className={`${getScopeColor(cap.scope)} w-fit ${
                                    isPopupMode ? 'text-[8px] px-1' : 'text-xs'
                                  }`}
                                >
                                  {getScopeIcon(cap.scope)}
                                  <span className="ml-1">{cap.scope}</span>
                                  <span className="ml-1 opacity-70">
                                    ({cap.methods.length} methods)
                                  </span>
                                </Badge>
                                <p className={`text-muted-foreground ml-1 ${isPopupMode ? 'text-[8px]' : 'text-[10px]'}`}>
                                  {cap.methods.join(', ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
