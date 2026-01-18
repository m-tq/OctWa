/**
 * ConnectedDAppsManager - Manage connected dApps and their capabilities
 * 
 * Syncs with both localStorage (web) and chrome.storage.local (extension)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  MoreVertical,
  ExternalLink,
  Shield,
  RefreshCw,
  Unplug,
  Eye,
  Edit,
  Cpu,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

// Connection stored in localStorage/chrome.storage
interface StoredConnection {
  circle: string;
  appOrigin: string;
  appName: string;
  walletPubKey: string;
  evmAddress?: string;
  network: 'testnet' | 'mainnet';
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

interface ConnectedDAppsManagerProps {
  wallets: Wallet[];
  onClose?: () => void;
  isPopupMode?: boolean;
}

// Check if running in extension context
const isExtension = typeof chrome !== 'undefined' && chrome.storage?.local;

export function ConnectedDAppsManager({
  wallets,
  onClose,
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
        
        // Also sync to localStorage for consistency
        localStorage.setItem('connectedDApps', JSON.stringify(storedConnections));
        localStorage.setItem('capabilities', JSON.stringify(storedCapabilities));
      } else {
        // Load from localStorage (web)
        storedConnections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
        storedCapabilities = JSON.parse(localStorage.getItem('capabilities') || '{}');
      }

      setConnections(storedConnections);
      setCapabilities(storedCapabilities);
    } catch (error) {
      console.error('[ConnectedDAppsManager] Failed to load data:', error);
      // Fallback to localStorage
      const storedConnections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
      const storedCapabilities = JSON.parse(localStorage.getItem('capabilities') || '{}');
      setConnections(storedConnections);
      setCapabilities(storedCapabilities);
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
            setConnections(changes.connectedDApps.newValue || []);
            localStorage.setItem('connectedDApps', JSON.stringify(changes.connectedDApps.newValue || []));
          }
          if (changes.capabilities) {
            setCapabilities(changes.capabilities.newValue || {});
            localStorage.setItem('capabilities', JSON.stringify(changes.capabilities.newValue || {}));
          }
        }
      };
      
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }

    // Listen for localStorage changes (web - cross-tab sync)
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'connectedDApps' && e.newValue) {
        setConnections(JSON.parse(e.newValue));
      }
      if (e.key === 'capabilities' && e.newValue) {
        setCapabilities(JSON.parse(e.newValue));
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
    await loadData();
    toast({
      title: 'Refreshed',
      description: 'dApp connections list updated',
    });
  };

  const truncateAddress = (address: string) =>
    `${address.slice(0, 8)}...${address.slice(-6)}`;

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

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
          className={`flex flex-row items-center justify-between space-y-0 ${
            isPopupMode ? 'p-0 pb-3' : 'pb-4'
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
                <AlertDialogContent className={isPopupMode ? 'w-[320px] p-4' : ''}>
                  <AlertDialogHeader>
                    <AlertDialogTitle className={isPopupMode ? 'text-sm' : ''}>
                      Disconnect All dApps
                    </AlertDialogTitle>
                    <AlertDialogDescription className={isPopupMode ? 'text-xs' : ''}>
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

                    {/* Active Capabilities */}
                    {activeCapabilities.length > 0 && (
                      <div className={`mt-2 pt-2 border-t ${isPopupMode ? 'space-y-1' : 'space-y-2'}`}>
                        <p className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                          Active Capabilities:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {activeCapabilities.map((cap) => (
                            <Badge
                              key={cap.id}
                              variant="secondary"
                              className={`${getScopeColor(cap.scope)} ${
                                isPopupMode ? 'text-[8px] px-1' : 'text-xs'
                              }`}
                            >
                              {getScopeIcon(cap.scope)}
                              <span className="ml-1">{cap.scope}</span>
                              <span className="ml-1 opacity-70">
                                ({cap.methods.length} methods)
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
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
