/**
 * ConnectedDAppsManager - Manage connected dApps and their capabilities
 */

import React, { useState, useEffect } from 'react';
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

// Connection stored in localStorage
interface StoredConnection {
  circle: string;
  appOrigin: string;
  appName: string;
  walletPubKey: string;
  network: 'testnet' | 'mainnet';
  connectedAt: number;
}

// Capability stored in localStorage
interface StoredCapability {
  id: string;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  issuedAt: number;
  expiresAt?: number;
}

interface ConnectedDAppsManagerProps {
  wallets: Wallet[];
  onClose?: () => void;
  isPopupMode?: boolean;
}

export function ConnectedDAppsManager({
  wallets,
  onClose,
  isPopupMode = false,
}: ConnectedDAppsManagerProps) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, StoredCapability[]>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    // Load connections
    const storedConnections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
    setConnections(storedConnections);

    // Load capabilities
    const storedCapabilities = JSON.parse(localStorage.getItem('capabilities') || '{}');
    setCapabilities(storedCapabilities);
  };

  const handleDisconnect = (connection: StoredConnection) => {
    // Remove connection
    const updatedConnections = connections.filter(
      (c) => c.appOrigin !== connection.appOrigin
    );
    localStorage.setItem('connectedDApps', JSON.stringify(updatedConnections));

    // Remove capabilities for this origin
    const updatedCapabilities = { ...capabilities };
    delete updatedCapabilities[connection.appOrigin];
    localStorage.setItem('capabilities', JSON.stringify(updatedCapabilities));

    setConnections(updatedConnections);
    setCapabilities(updatedCapabilities);

    toast({
      title: 'Disconnected',
      description: `${connection.appName} has been disconnected`,
    });
  };

  const handleDisconnectAll = () => {
    localStorage.setItem('connectedDApps', '[]');
    localStorage.setItem('capabilities', '{}');
    setConnections([]);
    setCapabilities({});

    toast({
      title: 'All Disconnected',
      description: 'All dApps have been disconnected',
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
        return 'bg-green-100 text-green-800';
      case 'write':
        return 'bg-amber-100 text-amber-800';
      case 'compute':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
              variant="outline"
              size="sm"
              onClick={loadData}
              className={isPopupMode ? 'h-7 w-7 p-0' : ''}
            >
              <RefreshCw className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
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
            <Alert className={`${isPopupMode ? 'py-2' : ''}`}>
              <div className="flex items-center gap-2">
                <Globe className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} shrink-0`} />
                <AlertDescription className={`${isPopupMode ? 'text-xs' : ''}`}>
                  No connected dApps. Connect to a dApp to see it here.
                </AlertDescription>
              </div>
            </Alert>
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
