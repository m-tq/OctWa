import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Wallet as WalletIcon, 
  Send, 
  History, 
  Lock,
  Copy,
  PieChart,
  Shield,
  Gift,
  Globe,
  ChevronDown,
  Plus,
  Trash2,
  Check,
  Wifi,
  Download,
  Menu
} from 'lucide-react';
import { Balance } from './Balance';
import { MultiSend } from './MultiSend';
import { SendTransaction } from './SendTransaction';
import { PrivateTransfer } from './PrivateTransfer';
import { ClaimTransfers } from './ClaimTransfers';
import { FileMultiSend } from './FileMultiSend';
import { TxHistory } from './TxHistory';
import { ThemeToggle } from './ThemeToggle';
import { ImportWallet } from './ImportWallet';
import { GenerateWallet } from './GenerateWallet';
import { RPCProviderManager } from './RPCProviderManager';
import { ConnectedDAppsManager } from './ConnectedDAppsManager';
import { Wallet } from '../types/wallet';
import { WalletManager } from '../utils/walletManager';
import { fetchBalance, getTransactionHistory, fetchEncryptedBalance } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
}

interface WalletDashboardProps {
  wallet: Wallet;
  wallets: Wallet[];
  onDisconnect: () => void;
  onSwitchWallet: (wallet: Wallet) => void;
  onAddWallet: (wallet: Wallet) => void;
  onRemoveWallet: (wallet: Wallet) => void;
  onExpandedView?: () => void;
  isPopupMode?: boolean;
}

export function WalletDashboard({ 
  wallet, 
  wallets, 
  onDisconnect, 
  onSwitchWallet, 
  onAddWallet, 
  onRemoveWallet,
  isPopupMode = false
}: WalletDashboardProps) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showAddWalletDialog, setShowAddWalletDialog] = useState(false);
  const [showRPCManager, setShowRPCManager] = useState(false);
  const [showDAppsManager, setShowDAppsManager] = useState(false);
  const [addWalletTab, setAddWalletTab] = useState('import');
  const [walletToDelete, setWalletToDelete] = useState<Wallet | null>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [encryptedBalance, setEncryptedBalance] = useState<any>(null);
  const { toast } = useToast();

  // Initial data fetch when wallet is connected
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!wallet) return;

      try {
        // Fetch balance and nonce
        setIsLoadingBalance(true);
        const balanceData = await fetchBalance(wallet.address);
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);
      } catch (error) {
        console.error('Failed to fetch balance:', error);
        // Don't show error for new addresses, just set balance to 0
        setBalance(0);
        setNonce(0);
      } finally {
        setIsLoadingBalance(false);
      }

      try {
        // Fetch transaction history
        setIsLoadingTransactions(true);
        const historyData = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(historyData)) {
          const transformedTxs = historyData.map((tx) => ({
            ...tx,
            type: tx.from?.toLowerCase() === wallet.address.toLowerCase() ? 'sent' : 'received'
          } as Transaction));
          setTransactions(transformedTxs);
        }
      } catch (error) {
        console.error('Failed to fetch transaction history:', error);
        // Don't show error for new addresses, just set empty transactions
        setTransactions([]);
      } finally {
        setIsLoadingTransactions(false);
      }
    };

    fetchInitialData();
  }, [wallet, toast]);

  // Function to refresh all wallet data
  const refreshWalletData = async () => {
    if (!wallet) return;
    
    setIsRefreshingData(true);
    
    try {
      // Fetch balance and nonce
      const balanceData = await fetchBalance(wallet.address);
      
      setBalance(balanceData.balance);
      setNonce(balanceData.nonce);
      
      // Fetch encrypted balance when RPC provider changes
      try {
        const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
        if (encData) {
          setEncryptedBalance(encData);
        } else {
          // Reset encrypted balance to default values when fetch fails
          setEncryptedBalance({
            public: balanceData.balance,
            public_raw: Math.floor(balanceData.balance * 1_000_000),
            encrypted: 0,
            encrypted_raw: 0,
            total: balanceData.balance
          });
        }
      } catch (encError) {
        console.error('Failed to fetch encrypted balance during refresh:', encError);
        setEncryptedBalance({
          public: balanceData.balance,
          public_raw: Math.floor(balanceData.balance * 1_000_000),
          encrypted: 0,
          encrypted_raw: 0,
          total: balanceData.balance
        });
      }
      
      // Fetch transaction history
      try {
        const historyData = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(historyData)) {
          const transformedTxs = historyData.map((tx) => ({
            ...tx,
            type: tx.from?.toLowerCase() === wallet.address.toLowerCase() ? 'sent' : 'received'
          } as Transaction));
          setTransactions(transformedTxs);
        } else {
          setTransactions([]);
        }
      } catch (historyError) {
        console.error('Failed to fetch transaction history:', historyError);
        setTransactions([]);
      }
      
      toast({
        title: "Data Refreshed",
        description: "Wallet data has been updated with new RPC provider",
      });
    } catch (error) {
      console.error('Failed to refresh wallet data:', error);
      
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh data with new RPC provider",
        variant: "destructive",
      });
    } finally {
      setIsRefreshingData(false);
    }
  };

  const handleRPCChange = () => {
    // Close the RPC manager dialog
    setShowRPCManager(false);
    
    // Refresh wallet data with new RPC
    refreshWalletData();
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Copy failed",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      // CRITICAL FIX: Properly lock wallets using WalletManager
      console.log('🔒 WalletDashboard: Locking wallets properly...');
      
      // Use WalletManager to properly lock wallets (this will handle encryption)
      await WalletManager.lockWallets();
      
      // Trigger storage events for cross-tab synchronization
      setTimeout(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'isWalletLocked',
          oldValue: 'false',
          newValue: 'true',
          storageArea: localStorage
        }));
      }, 50);
      
      // Call the parent's disconnect handler to update UI state
      onDisconnect();
      setShowLockConfirm(false);
      
      console.log('✅ WalletDashboard: Wallets locked successfully');
    } catch (error) {
      console.error('❌ WalletDashboard: Failed to lock wallets:', error);
      toast({
        title: "Lock Failed",
        description: "Failed to lock wallets properly",
        variant: "destructive",
      });
    }
  };

  const handleRemoveWallet = () => {
    if (!walletToDelete) return;
    
    if (wallets.length === 1) {
      toast({
        title: "Cannot Remove",
        description: "You cannot remove the last wallet. Use disconnect instead.",
        variant: "destructive",
      });
      setWalletToDelete(null);
      return;
    }
    
    // Calculate remaining wallets after removal
    const remainingWallets = wallets.filter(w => w.address !== walletToDelete.address);
    
    // If we're removing the active wallet, we need to switch to another wallet first
    if (walletToDelete.address === wallet.address && remainingWallets.length > 0) {
      // Find the best replacement wallet (first in the list)
      const newActiveWallet = remainingWallets[0];
      
      // Update localStorage immediately with new active wallet
      localStorage.setItem('activeWalletId', newActiveWallet.address);
      localStorage.setItem('wallets', JSON.stringify(remainingWallets));
      
      // Switch to the new wallet first
      onSwitchWallet(newActiveWallet);
      
      // Small delay to ensure state is updated before removing
      setTimeout(() => {
        onRemoveWallet(walletToDelete);
      }, 100);
    } else {
      // If we're not removing the active wallet, just remove it normally
      onRemoveWallet(walletToDelete);
    }
    
    // Also remove from encrypted wallets storage
    const encryptedWallets = JSON.parse(localStorage.getItem('encryptedWallets') || '[]');
    const updatedEncryptedWallets = encryptedWallets.filter(
      (w: any) => w.address !== walletToDelete.address
    );
    localStorage.setItem('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
    
    // Show success message and clear the deletion state
    setTimeout(() => {
      toast({
        title: "Wallet Removed",
        description: "Wallet has been removed successfully",
      });
      setWalletToDelete(null);
    }, 150);
  };

  const handleImportSuccess = (newWallet: Wallet) => {
    // Ensure the wallet is properly saved before adding
    onAddWallet(newWallet);
    setShowAddWalletDialog(false);
    
    // Force save to localStorage immediately
    const currentWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
    const walletExists = currentWallets.some((w: Wallet) => w.address === newWallet.address);
    if (!walletExists) {
      const updatedWallets = [...currentWallets, newWallet];
      localStorage.setItem('wallets', JSON.stringify(updatedWallets));
      localStorage.setItem('activeWalletId', newWallet.address);
    }
    
    toast({
      title: "Wallet Added",
      description: "New wallet has been added successfully",
    });
  };

  const handleGenerateSuccess = (newWallet: Wallet) => {
    // Ensure the wallet is properly saved before adding
    onAddWallet(newWallet);
    setShowAddWalletDialog(false);
    
    // Force save to localStorage immediately
    const currentWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
    const walletExists = currentWallets.some((w: Wallet) => w.address === newWallet.address);
    if (!walletExists) {
      const updatedWallets = [...currentWallets, newWallet];
      localStorage.setItem('wallets', JSON.stringify(updatedWallets));
      localStorage.setItem('activeWalletId', newWallet.address);
    }
    
    toast({
      title: "Wallet Generated",
      description: "New wallet has been generated and added successfully",
    });
  };

  const handleBalanceUpdate = async (newBalance: number) => {
    setBalance(newBalance);
    // Also refresh nonce when balance is updated
    try {
      const balanceData = await fetchBalance(wallet.address);
      setNonce(balanceData.nonce);
    } catch (error) {
      console.error('Failed to refresh nonce:', error);
    }
  };

  const handleNonceUpdate = (newNonce: number) => {
    setNonce(newNonce);
  };

  const handleTransactionsUpdate = (newTransactions: Transaction[]) => {
    setTransactions(newTransactions);
  };

  const handleTransactionSuccess = async () => {
    // Refresh transaction history and balance after successful transaction
    const refreshData = async () => {
      try {
        // Refresh balance and nonce
        const balanceData = await fetchBalance(wallet.address);
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);

        // Refresh transaction history
        const historyData = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(historyData)) {
          const transformedTxs = historyData.map((tx) => ({
            ...tx,
            type: tx.from?.toLowerCase() === wallet.address.toLowerCase() ? 'sent' : 'received'
          } as Transaction));
          setTransactions(transformedTxs);
        }
      } catch (error) {
        console.error('Failed to refresh data after transaction:', error);
      }
    };

    // Small delay to allow transaction to propagate
    setTimeout(refreshData, 2000);
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="octra-header sticky top-0 z-50">
        <div className="octra-container">
          <div className="flex items-center justify-between py-2 sm:py-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <Avatar className={`${isPopupMode ? 'h-8 w-8' : 'h-10 w-10'}`}>
                  <AvatarFallback className="bg-primary/10 text-primary border border-primary/20">
                    <WalletIcon className={`${isPopupMode ? 'h-4 w-4' : 'h-5 w-5'}`} />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className={`${isPopupMode ? 'text-lg' : 'text-xl'} font-semibold text-foreground`}>
                    Octra Wallet
                  </h1>
                  <div className="flex items-center space-x-2">
                    {/* Wallet Selector */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm text-muted-foreground">
                              {truncateAddress(wallet.address)}
                            </p>
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-80 max-h-[70vh] p-0">
                        <div className="px-2 pt-1.5 pb-1 text-sm font-medium text-center w-full">
                          Select Wallet ( {wallets.length} )
                        </div>
                        <DropdownMenuSeparator />
                        <ScrollArea className="pr-2 mr-2">
                        <div
                          style={{
                            minHeight: '8vh',  // Minimum height for the content area
                            maxHeight: '40vh',  // Maximum height for the content area before scrolling
                          }}
                          className="p-2" // Add your padding here
                        >
                          {wallets.map((w, i) => (
                            <div
                              key={w.address}
                              className="flex items-center justify-between p-3 rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer group"
                              onClick={() => onSwitchWallet(w)}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-sm truncate">
                                  #{i + 1} {truncateAddress(w.address)}
                                  </span>
                                  {w.address === wallet.address && (
                                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                                  )}
                                </div>
                                {w.type && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {w.type === 'generated' && 'Generated wallet'}
                                    {w.type === 'imported-mnemonic' && 'Imported wallet (mnemonic)'}
                                    {w.type === 'imported-private-key' && 'Imported wallet (private key)'}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(w.address, 'Address');
                                  }}
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                  title="Copy address"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                {wallets.length > 1 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setWalletToDelete(w);
                                    }}
                                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                    title="Remove wallet"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                          </div>
                        </ScrollArea>
                        <DropdownMenuSeparator />
                        <div
                          onClick={() => setShowAddWalletDialog(true)}
                          className="flex items-center justify-center space-x-2 p-3 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm mx-1 mb-1"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Add Wallet</span>
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(wallet.address, 'Address')}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
              {/* Hide badges in popup mode to save space */}
              {!isPopupMode && (
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary" className="hidden sm:inline-flex relative pl-4">
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-green-500 rounded-full"></span>
                    Connected
                  </Badge>
                  <Badge variant="outline" className="hidden sm:inline-flex text-xs">
                    Nonce: {nonce}
                  </Badge>
                  <Badge variant="outline" className="hidden sm:inline-flex text-xs">
                    {wallets.length} Wallet{wallets.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              )}
            </div>

            <div className={`flex items-center ${isPopupMode ? 'space-x-1' : 'space-x-2'}`}>
              {isPopupMode ? (
                // Popup mode - Compact layout
                <>
                  <ThemeToggle />
                  {/* Mobile Hamburger Menu with expanded functionality */}
                  <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-80">
                      <SheetHeader>
                        <SheetTitle>Wallet Menu</SheetTitle>
                      </SheetHeader>
                      <div className="mt-6 space-y-4">
                        {/* Wallet Info */}
                        <div className="p-3 bg-muted rounded-lg">
                          <div className="flex items-center space-x-2 mb-2">
                            <Badge variant="secondary" className="relative pl-4">
                              <span className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-green-500 rounded-full"></span>
                              Connected
                            </Badge>
                          </div>
                          <div className="text-sm space-y-1">
                            <span>Nonce : {nonce}</span>
                          </div>
                        </div>

                        {/* Expand View Button */}
                        {typeof chrome !== 'undefined' && chrome.tabs && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              chrome.tabs.create({
                                url: chrome.runtime.getURL('index.html')
                              });
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                            Expand View
                          </Button>
                        )}

                        {/* RPC Provider */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowRPCManager(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2"
                        >
                          <Wifi className="h-4 w-4" />
                          RPC Provider
                        </Button>

                        {/* Connected dApps */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowDAppsManager(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2"
                        >
                          <Globe className="h-4 w-4" />
                          Connected dApps
                        </Button>

                        {/* Add Wallet */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowAddWalletDialog(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          Add Wallet
                        </Button>

                        {/* Lock Wallet */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowLockConfirm(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2 text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                        >
                          <Lock className="h-4 w-4" />
                          Lock Wallet
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                </>
              ) : (
                // Expanded mode - Full layout
                <>
                  <ThemeToggle />
                  {/* Desktop Menu Items */}
                  <div className="hidden md:flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRPCManager(true)}
                      className="flex items-center gap-2 desktop-only"
                    >
                      <Wifi className="h-4 w-4" />
                      RPC
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDAppsManager(true)}
                      className="flex items-center gap-2 desktop-only"
                    >
                      <Globe className="h-4 w-4" />
                      dApps
                    </Button>
                    <Dialog open={showAddWalletDialog} onOpenChange={setShowAddWalletDialog}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex items-center gap-2 desktop-only">
                          <Plus className="h-4 w-4" />
                          Add Wallet
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden">
                        <DialogHeader>
                          <DialogTitle>Add New Wallet</DialogTitle>
                          <DialogDescription>
                            Import an existing wallet using private key or mnemonic phrase, or generate a new wallet.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col max-h-[calc(90vh-120px)]">
                          <Tabs value={addWalletTab} onValueChange={setAddWalletTab} className="w-full flex flex-col">
                            <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
                              <TabsTrigger value="import" className="flex items-center gap-2">
                                <Download className="h-4 w-4" />
                                Import
                              </TabsTrigger>
                              <TabsTrigger value="generate" className="flex items-center gap-2">
                                <Plus className="h-4 w-4" />
                                Generate
                              </TabsTrigger>
                            </TabsList>
                            
                            <div className="flex-1 overflow-hidden">
                              <ScrollArea className="h-full max-h-[calc(90vh-180px)]">
                                <div className="pr-4">
                                  <TabsContent value="import" className="mt-4 data-[state=inactive]:hidden">
                                    <ImportWallet onWalletImported={handleImportSuccess} />
                                  </TabsContent>
                                  
                                  <TabsContent value="generate" className="mt-4 data-[state=inactive]:hidden">
                                    <GenerateWallet onWalletGenerated={handleGenerateSuccess} />
                                  </TabsContent>
                                </div>
                              </ScrollArea>
                            </div>
                          </Tabs>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 flex items-center gap-2 desktop-only"
                        >
                          <Lock className="h-4 w-4" />
                          Lock Wallet
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Lock Wallet</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to lock your wallet? You will need to enter your password to unlock it again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDisconnect} className="bg-orange-600 hover:bg-orange-700">
                            Lock Wallet
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Mobile Hamburger Menu */}
                  <div className="md:hidden">
                    <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                      <SheetTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Menu className="h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="right" className="w-80">
                        <SheetHeader>
                          <SheetTitle>Additional Menu</SheetTitle>
                        </SheetHeader>
                        <div className="mt-6 space-y-4">
                          {/* RPC Provider */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowRPCManager(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <Wifi className="h-4 w-4" />
                            RPC Provider
                          </Button>

                          {/* Connected dApps */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowDAppsManager(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <Globe className="h-4 w-4" />
                            Connected dApps
                          </Button>

                          {/* Add Wallet */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowAddWalletDialog(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <Plus className="h-4 w-4" />
                            Add Wallet
                          </Button>

                          {/* Lock Wallet */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowLockConfirm(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2 text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                          >
                            <Lock className="h-4 w-4" />
                            Lock Wallet
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </>
              )}

              {/* Dialogs - Keep outside of mobile menu for proper functionality */}
              {/* Wallet Removal Confirmation Dialog */}
              <AlertDialog open={!!walletToDelete} onOpenChange={(open) => !open && setWalletToDelete(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Wallet</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to remove wallet{' '}
                      <span className="font-mono">
                        {walletToDelete ? truncateAddress(walletToDelete.address) : ''}
                      </span>
                      ? This action cannot be undone.
                      {walletToDelete?.address === wallet.address && (
                        <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/50 rounded text-sm">
                          <strong>Note:</strong> This is your currently active wallet. 
                          The first remaining wallet will become active.
                        </div>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setWalletToDelete(null)}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleRemoveWallet} 
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Remove Wallet
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              
              <Dialog open={showAddWalletDialog} onOpenChange={setShowAddWalletDialog}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>Add New Wallet</DialogTitle>
                    <DialogDescription>
                      Import an existing wallet using private key or mnemonic phrase, or generate a new wallet.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col max-h-[calc(90vh-120px)]">
                    <Tabs value={addWalletTab} onValueChange={setAddWalletTab} className="w-full flex flex-col">
                      <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
                        <TabsTrigger value="import" className="flex items-center gap-2">
                          <Download className="h-4 w-4" />
                          Import
                        </TabsTrigger>
                        <TabsTrigger value="generate" className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Generate
                        </TabsTrigger>
                      </TabsList>
                      
                      <div className="flex-1 overflow-hidden">
                        <ScrollArea className="h-full max-h-[calc(90vh-180px)]">
                          <div className="pr-4">
                            <TabsContent value="import" className="mt-4 data-[state=inactive]:hidden">
                              <ImportWallet onWalletImported={handleImportSuccess} />
                            </TabsContent>
                            
                            <TabsContent value="generate" className="mt-4 data-[state=inactive]:hidden">
                              <GenerateWallet onWalletGenerated={handleGenerateSuccess} />
                            </TabsContent>
                          </div>
                        </ScrollArea>
                      </div>
                    </Tabs>
                  </div>
                </DialogContent>
              </Dialog>
              
              <Dialog open={showRPCManager} onOpenChange={setShowRPCManager}>
                <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>RPC Provider Management</DialogTitle>
                    <DialogDescription>
                      Manage your RPC providers to connect to different blockchain networks.
                    </DialogDescription>
                  </DialogHeader>
                  <RPCProviderManager 
                    onClose={() => setShowRPCManager(false)} 
                    onRPCChange={handleRPCChange}
                  />
                </DialogContent>
              </Dialog>
              
              <Dialog open={showDAppsManager} onOpenChange={setShowDAppsManager}>
                <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Connected dApps Management</DialogTitle>
                    <DialogDescription>
                      View and manage applications that have been granted access to your wallet.
                    </DialogDescription>
                  </DialogHeader>
                  <ConnectedDAppsManager 
                    wallets={wallets} 
                    onClose={() => setShowDAppsManager(false)} 
                  />
                </DialogContent>
              </Dialog>
              
              <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Lock Wallet</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to lock your wallet? You will need to enter your password to unlock it again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect} className="bg-orange-600 hover:bg-orange-700">
                      Lock Wallet
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`octra-container ${isPopupMode ? 'py-2 px-2 pb-4 mt-2' : 'py-2 px-2 sm:py-8 sm:px-4'}`}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-4">
          {isPopupMode ? (
            // Popup mode - 3 tabs only
            <TabsList className="grid w-full grid-cols-3 tabs-list h-auto p-1 mt-2">
              <TabsTrigger value="overview" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger text-xs sm:text-sm">
                <PieChart className="h-3 w-3 flex-shrink-0" />
                <span className="text-[10px]">Overview</span>
                {isRefreshingData && (
                  <div className="animate-spin h-2 w-2 border border-primary border-t-transparent rounded-full" />
                )}
              </TabsTrigger>
              <TabsTrigger value="send" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger text-xs sm:text-sm">
                <Send className="h-3 w-3 flex-shrink-0" />
                <span className="text-[10px]">Send</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger text-xs sm:text-sm">
                <History className="h-3 w-3 flex-shrink-0" />
                <span className="text-[10px]">History</span>
              </TabsTrigger>
            </TabsList>
          ) : (
            // Expanded mode - 5 tabs
            <TabsList className="grid w-full grid-cols-5 tabs-list h-auto p-0.5 sm:p-1">
              <TabsTrigger value="overview" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger md:px-2 py-2 text-xs sm:text-sm">
                <PieChart className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="hidden min-[480px]:inline">Overview</span>
                <span className="min-[480px]:hidden text-[10px] leading-none mt-0.5">Over</span>
                {isRefreshingData && (
                  <div className="animate-spin h-2 w-2 sm:h-3 sm:w-3 border border-primary border-t-transparent rounded-full" />
                )}
              </TabsTrigger>
              <TabsTrigger value="send" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger md:px-2 py-2 text-xs sm:text-sm">
                <Send className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="hidden min-[480px]:inline">Send</span>
                <span className="min-[480px]:hidden text-[10px] leading-none mt-0.5">Send</span>
              </TabsTrigger>
              <TabsTrigger value="private" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger md:px-2 py-2 text-xs sm:text-sm">
                <Shield className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="hidden min-[480px]:inline">Private</span>
                <span className="min-[480px]:hidden text-[10px] leading-none mt-0.5">Priv</span>
              </TabsTrigger>
              <TabsTrigger value="claim" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger md:px-2 py-2 text-xs sm:text-sm">
                <Gift className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="hidden min-[480px]:inline">Claim</span>
                <span className="min-[480px]:hidden text-[10px] leading-none mt-0.5">Claim</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="flex flex-col sm:flex-row items-center gap-1 tabs-trigger md:px-2 py-2 text-xs sm:text-sm">
                <History className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="hidden min-[480px]:inline">History</span>
                <span className="min-[480px]:hidden text-[10px] leading-none mt-0.5">Hist</span>
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="overview" className="space-y-4 sm:space-y-6 mt-4">
            <Balance 
              wallet={wallet} 
              balance={balance}
              encryptedBalance={encryptedBalance}
              onEncryptedBalanceUpdate={setEncryptedBalance}
              onBalanceUpdate={handleBalanceUpdate}
              isLoading={isLoadingBalance || isRefreshingData}
            />
          </TabsContent>

          <TabsContent value="send" className="mt-4">
            {isPopupMode ? (
              // Popup mode - Include Private and Claim in Send tabs
              <Tabs defaultValue="single" className="w-full">
                <TabsList className="grid w-full grid-cols-4 h-auto p-1">
                  <TabsTrigger value="single" className="text-xs sm:text-sm px-1 py-2">Single</TabsTrigger>
                  <TabsTrigger value="multi" className="text-xs sm:text-sm px-1 py-2">Multi</TabsTrigger>
                  <TabsTrigger value="private" className="text-xs sm:text-sm px-1 py-2">Private</TabsTrigger>
                  <TabsTrigger value="claim" className="text-xs sm:text-sm px-1 py-2">Claim</TabsTrigger>
                </TabsList>
                
                <TabsContent value="single" className="mt-4 sm:mt-6">
                  <SendTransaction
                    wallet={wallet} 
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
                
                <TabsContent value="multi" className="mt-4 sm:mt-6">
                  <MultiSend 
                    wallet={wallet} 
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
                
                <TabsContent value="private" className="mt-4 sm:mt-6">
                  <PrivateTransfer
                    wallet={wallet}
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>

                <TabsContent value="claim" className="mt-4 sm:mt-6">
                  <ClaimTransfers
                    wallet={wallet}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              // Expanded mode - Original Send tabs
              <Tabs defaultValue="single" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                  <TabsTrigger value="single" className="text-xs sm:text-sm px-2 py-2">Single Send</TabsTrigger>
                  <TabsTrigger value="multi" className="text-xs sm:text-sm px-2 py-2">Multi Send</TabsTrigger>
                  <TabsTrigger value="file" className="text-xs sm:text-sm px-2 py-2">File Multi</TabsTrigger>
                </TabsList>
                
                <TabsContent value="single" className="mt-4 sm:mt-6">
                  <SendTransaction
                    wallet={wallet} 
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
                
                <TabsContent value="multi" className="mt-4 sm:mt-6">
                  <MultiSend 
                    wallet={wallet} 
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
                
                <TabsContent value="file" className="mt-4 sm:mt-6">
                  <FileMultiSend 
                    wallet={wallet} 
                    balance={balance}
                    nonce={nonce}
                    onBalanceUpdate={handleBalanceUpdate}
                    onNonceUpdate={handleNonceUpdate}
                    onTransactionSuccess={handleTransactionSuccess}
                  />
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>

          {/* Only show these tabs in expanded mode */}
          {!isPopupMode && (
            <>
              <TabsContent value="private" className="mt-4">
                <PrivateTransfer
                  wallet={wallet}
                  balance={balance}
                  nonce={nonce}
                  onBalanceUpdate={handleBalanceUpdate}
                  onNonceUpdate={handleNonceUpdate}
                  onTransactionSuccess={handleTransactionSuccess}
                />
              </TabsContent>

              <TabsContent value="claim" className="mt-4">
                <ClaimTransfers
                  wallet={wallet}
                  onTransactionSuccess={handleTransactionSuccess}
                />
              </TabsContent>
            </>
          )}

          <TabsContent value="history" className="mt-4">
            <TxHistory 
              wallet={wallet} 
              transactions={transactions}
              onTransactionsUpdate={handleTransactionsUpdate}
              isLoading={isLoadingTransactions}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}