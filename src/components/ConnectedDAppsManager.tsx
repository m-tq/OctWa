import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { 
  Globe, 
  MoreVertical, 
  Trash2, 
  ExternalLink, 
  Shield, 
  Eye, 
  Send, 
  RefreshCw,
  Settings,
  Unplug,
  Users
} from 'lucide-react';
import { Wallet, ConnectedDApp } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

interface ConnectedDAppsManagerProps {
  wallets: Wallet[];
  onClose?: () => void;
}

export function ConnectedDAppsManager({ wallets, onClose }: ConnectedDAppsManagerProps) {
  const [connectedDApps, setConnectedDApps] = useState<ConnectedDApp[]>([]);
  const [showChangeWalletDialog, setShowChangeWalletDialog] = useState(false);
  const [selectedDApp, setSelectedDApp] = useState<ConnectedDApp | null>(null);
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    loadConnectedDApps();
  }, []);

  const loadConnectedDApps = () => {
    const connections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
    
    // Remove duplicates based on origin
    const uniqueConnections = connections.reduce((acc: ConnectedDApp[], current: ConnectedDApp) => {
      const existingIndex = acc.findIndex(item => item.origin === current.origin);
      if (existingIndex >= 0) {
        // Keep the most recent connection (higher connectedAt timestamp)
        if (current.connectedAt > acc[existingIndex].connectedAt) {
          acc[existingIndex] = current;
        }
      } else {
        acc.push(current);
      }
      return acc;
    }, []);
    
    // Save cleaned connections back to localStorage
    if (uniqueConnections.length !== connections.length) {
      localStorage.setItem('connectedDApps', JSON.stringify(uniqueConnections));
    }
    
    setConnectedDApps(uniqueConnections);
  };

  const saveConnectedDApps = (updatedDApps: ConnectedDApp[]) => {
    localStorage.setItem('connectedDApps', JSON.stringify(updatedDApps));
    setConnectedDApps(updatedDApps);
  };

  const handleDisconnect = (dapp: ConnectedDApp) => {
    const updatedDApps = connectedDApps.filter(d => d.origin !== dapp.origin);
    saveConnectedDApps(updatedDApps);
    
    toast({
      title: "dApp Disconnected",
      description: `${dapp.appName} has been disconnected from your wallet`,
    });
  };

  const handleChangeWallet = () => {
    if (!selectedDApp || !selectedWalletAddress) return;
    
    const selectedWallet = wallets.find(w => w.address === selectedWalletAddress);
    if (!selectedWallet) return;
    
    // Update the connection for this specific origin
    const updatedDApps = connectedDApps.map(dapp => 
      dapp.origin === selectedDApp.origin 
        ? { ...dapp, selectedAddress: selectedWallet.address }
        : dapp
    );
    
    saveConnectedDApps(updatedDApps);
    setShowChangeWalletDialog(false);
    setSelectedDApp(null);
    setSelectedWalletAddress('');
    
    toast({
      title: "Wallet Changed",
      description: `${selectedDApp.appName} is now connected to ${truncateAddress(selectedWallet.address)}`,
    });
  };

  const handleDisconnectAll = () => {
    saveConnectedDApps([]);
    toast({
      title: "All dApps Disconnected",
      description: "All connected dApps have been disconnected",
    });
  };

  const openChangeWalletDialog = (dapp: ConnectedDApp) => {
    setSelectedDApp(dapp);
    setSelectedWalletAddress(dapp.selectedAddress);
    setShowChangeWalletDialog(true);
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPermissionIcon = (permission: string) => {
    switch (permission) {
      case 'view_address':
        return <Eye className="h-3 w-3" />;
      case 'view_balance':
        return <Eye className="h-3 w-3" />;
      case 'call_methods':
        return <Send className="h-3 w-3" />;
      default:
        return <Shield className="h-3 w-3" />;
    }
  };

  const getWalletDisplayName = (address: string) => {
    const walletIndex = wallets.findIndex(w => w.address === address);
    return walletIndex >= 0 ? `Account ${walletIndex + 1}` : 'Unknown Wallet';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Connected dApps
            {connectedDApps.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {connectedDApps.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadConnectedDApps}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {connectedDApps.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <Unplug className="h-4 w-4 mr-2" />
                    Disconnect All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect All dApps</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to disconnect all connected dApps? This action cannot be undone and you'll need to reconnect each dApp manually.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnectAll} className="bg-red-600 hover:bg-red-700">
                      Disconnect All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {connectedDApps.length === 0 ? (
            <Alert>
              <div className="flex items-start space-x-3">
                <Globe className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <AlertDescription>
                  No connected dApps found. When you connect to a dApp, it will appear here for management.
                </AlertDescription>
              </div>
            </Alert>
          ) : (
            <div className="space-y-4">
              {connectedDApps.map((dapp) => {
                const connectedWallet = wallets.find(w => w.address === dapp.selectedAddress);
                
                return (
                  <div
                    key={dapp.origin}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {dapp.appName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate text-sm sm:text-base">{dapp.appName}</h3>
                          <Badge variant="outline" className="text-xs">
                            Connected
                          </Badge>
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground truncate mb-2">
                          {dapp.origin}
                        </p>
                        
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span>{getWalletDisplayName(dapp.selectedAddress)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span>Connected: {formatDate(dapp.connectedAt)}</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-1 sm:mt-2">
                          <span className="text-xs text-muted-foreground">Permissions:</span>
                          <div className="flex items-center gap-1">
                            {dapp.permissions.map((permission, index) => (
                              <div key={index} className="flex items-center gap-1">
                                {getPermissionIcon(permission)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm" 
                        onClick={() => window.open(dapp.origin, '_blank')}
                        title="Visit dApp"
                        className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 sm:h-9 sm:w-9">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openChangeWalletDialog(dapp)}>
                            <Settings className="h-4 w-4 mr-2" />
                            Change Wallet
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDisconnect(dapp)}
                            className="text-red-600"
                          >
                            <Unplug className="h-4 w-4 mr-2" />
                            Disconnect
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Wallet Dialog */}
      <Dialog open={showChangeWalletDialog} onOpenChange={setShowChangeWalletDialog}>
        <DialogContent className="sm:max-w-md mx-4 max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>Change Connected Wallet</DialogTitle>
          </DialogHeader>
          
          {selectedDApp && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {selectedDApp.appName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{selectedDApp.appName}</div>
                  <div className="text-sm text-muted-foreground truncate">{selectedDApp.origin}</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Select Wallet</label>
                <Select value={selectedWalletAddress} onValueChange={setSelectedWalletAddress}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((wallet, index) => (
                      <SelectItem key={wallet.address} value={wallet.address}>
                        <div className="flex items-center gap-2 w-full">
                          <span>Account {index + 1}</span>
                          <span className="text-muted-foreground font-mono text-xs truncate">
                            {truncateAddress(wallet.address)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Changing the connected wallet will update which account this dApp can access. The dApp will use the new wallet for all future interactions.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowChangeWalletDialog(false)}
                  className="flex-1 order-2 sm:order-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChangeWallet}
                  disabled={!selectedWalletAddress || selectedWalletAddress === selectedDApp.selectedAddress}
                  className="flex-1 order-1 sm:order-2"
                >
                  Change Wallet
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}