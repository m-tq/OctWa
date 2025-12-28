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
  isPopupMode?: boolean;
}

export function ConnectedDAppsManager({ wallets, onClose, isPopupMode = false }: ConnectedDAppsManagerProps) {
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
    <div className={isPopupMode ? "space-y-3" : "space-y-6"}>
      <Card className={isPopupMode ? "border-0 shadow-none" : ""}>
        <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${isPopupMode ? "p-0 pb-3" : "pb-4"}`}>
          <CardTitle className={`flex items-center gap-2 ${isPopupMode ? "text-sm" : ""}`}>
            <Globe className={isPopupMode ? "h-4 w-4" : "h-5 w-5"} />
            Connected dApps
            {connectedDApps.length > 0 && (
              <Badge variant="secondary" className={isPopupMode ? "text-[10px] px-1 py-0" : "ml-2"}>
                {connectedDApps.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={loadConnectedDApps}
              className={isPopupMode ? "h-7 w-7 p-0" : ""}
            >
              <RefreshCw className={isPopupMode ? "h-3 w-3" : "h-4 w-4 mr-2"} />
              {!isPopupMode && "Refresh"}
            </Button>
            {connectedDApps.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className={`text-red-600 hover:text-red-700 ${isPopupMode ? "h-7 text-[10px] px-2" : ""}`}>
                    <Unplug className={isPopupMode ? "h-3 w-3 mr-1" : "h-4 w-4 mr-2"} />
                    {isPopupMode ? "All" : "Disconnect All"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className={isPopupMode ? "w-[320px] p-4" : ""}>
                  <AlertDialogHeader>
                    <AlertDialogTitle className={isPopupMode ? "text-sm" : ""}>Disconnect All dApps</AlertDialogTitle>
                    <AlertDialogDescription className={isPopupMode ? "text-xs" : ""}>
                      {isPopupMode 
                        ? "Disconnect all dApps? You'll need to reconnect each one manually."
                        : "Are you sure you want to disconnect all connected dApps? This action cannot be undone and you'll need to reconnect each dApp manually."
                      }
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className={isPopupMode ? "h-8 text-xs" : ""}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnectAll} className={`bg-red-600 hover:bg-red-700 ${isPopupMode ? "h-8 text-xs" : ""}`}>
                      Disconnect All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent className={isPopupMode ? "p-0" : ""}>
          {connectedDApps.length === 0 ? (
            <Alert className={isPopupMode ? "py-2" : ""}>
              <div className="flex items-start space-x-3">
                <Globe className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mt-0.5 flex-shrink-0`} />
                <AlertDescription className={isPopupMode ? "text-xs" : ""}>
                  {isPopupMode ? "No connected dApps." : "No connected dApps found. When you connect to a dApp, it will appear here for management."}
                </AlertDescription>
              </div>
            </Alert>
          ) : (
            <div className={isPopupMode ? "space-y-2" : "space-y-4"}>
              {connectedDApps.map((dapp) => {
                const connectedWallet = wallets.find(w => w.address === dapp.selectedAddress);
                
                return (
                  <div
                    key={dapp.origin}
                    className={`flex items-center justify-between border rounded-lg hover:bg-muted/50 transition-colors ${isPopupMode ? "p-2" : "p-4"}`}
                  >
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <Avatar className={isPopupMode ? "h-8 w-8" : "h-12 w-12"}>
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {dapp.appName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-0.5">
                          <h3 className={`font-medium truncate ${isPopupMode ? "text-xs" : "text-sm sm:text-base"}`}>{dapp.appName}</h3>
                        </div>
                        <p className={`text-muted-foreground truncate ${isPopupMode ? "text-[10px]" : "text-xs sm:text-sm"}`}>
                          {dapp.origin}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : "h-8 w-8 p-0 sm:h-9 sm:w-9"}>
                            <MoreVertical className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openChangeWalletDialog(dapp)} className={isPopupMode ? "text-xs" : ""}>
                            <Settings className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mr-2`} />
                            Change Wallet
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.open(dapp.origin, '_blank')} className={isPopupMode ? "text-xs" : ""}>
                            <ExternalLink className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mr-2`} />
                            Visit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDisconnect(dapp)}
                            className={`text-red-600 ${isPopupMode ? "text-xs" : ""}`}
                          >
                            <Unplug className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mr-2`} />
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
        <DialogContent className={isPopupMode ? "w-[320px] p-3" : "sm:max-w-md mx-4 max-w-[calc(100vw-2rem)]"}>
          <DialogHeader className={isPopupMode ? "pb-2" : ""}>
            <DialogTitle className={isPopupMode ? "text-sm" : ""}>Change Connected Wallet</DialogTitle>
          </DialogHeader>
          
          {selectedDApp && (
            <div className={isPopupMode ? "space-y-3" : "space-y-4"}>
              <div className={`flex items-center gap-2 bg-muted rounded-lg ${isPopupMode ? "p-2" : "p-3"}`}>
                <Avatar className={isPopupMode ? "h-8 w-8" : "h-10 w-10"}>
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {selectedDApp.appName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isPopupMode ? "text-xs" : ""}`}>{selectedDApp.appName}</div>
                  <div className={`text-muted-foreground truncate ${isPopupMode ? "text-[10px]" : "text-sm"}`}>{selectedDApp.origin}</div>
                </div>
              </div>

              <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
                <label className={`font-medium ${isPopupMode ? "text-xs" : "text-sm"}`}>Select Wallet</label>
                <Select value={selectedWalletAddress} onValueChange={setSelectedWalletAddress}>
                  <SelectTrigger className={isPopupMode ? "h-8 text-xs" : ""}>
                    <SelectValue placeholder="Choose a wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((wallet, index) => (
                      <SelectItem key={wallet.address} value={wallet.address} className={isPopupMode ? "text-xs" : ""}>
                        <div className="flex items-center gap-2 w-full">
                          <span>Account {index + 1}</span>
                          <span className={`text-muted-foreground font-mono truncate ${isPopupMode ? "text-[10px]" : "text-xs"}`}>
                            {truncateAddress(wallet.address)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowChangeWalletDialog(false)}
                  className={`flex-1 ${isPopupMode ? "h-8 text-xs" : ""}`}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChangeWallet}
                  disabled={!selectedWalletAddress || selectedWalletAddress === selectedDApp.selectedAddress}
                  className={`flex-1 ${isPopupMode ? "h-8 text-xs" : ""}`}
                >
                  Change
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}