import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Send, 
  History, 
  Lock,
  Copy,
  PieChart,
  Shield,
  Gift,
  Globe,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Wifi,
  Download,
  Menu,
  RotateCcw,
  Eye,
  EyeOff,
  Key,
  Unlock,
  QrCode,
  ExternalLink
} from 'lucide-react';
import { ExtensionStorageManager } from '../utils/extensionStorage';
import { PublicBalance } from './PublicBalance';
import { PrivateBalance } from './PrivateBalance';
import { MultiSend } from './MultiSend';
import { SendTransaction } from './SendTransaction';
import { PrivateTransfer } from './PrivateTransfer';
import { ClaimTransfers } from './ClaimTransfers';
import { FileMultiSend } from './FileMultiSend';
import { UnifiedHistory } from './UnifiedHistory';
import { ModeToggle } from './ModeToggle';
import { ModeIndicator } from './ModeIndicator';
import { ThemeToggle } from './ThemeToggle';
import { AddWalletPopup } from './AddWalletPopup';
import { RPCProviderManager } from './RPCProviderManager';
import { ConnectedDAppsManager } from './ConnectedDAppsManager';
import { ExportPrivateKeys } from './ExportPrivateKeys';
import { ReceiveDialog } from './ReceiveDialog';
import { EncryptBalanceDialog } from './EncryptBalanceDialog';
import { DecryptBalanceDialog } from './DecryptBalanceDialog';
import { Wallet } from '../types/wallet';
import { WalletManager } from '../utils/walletManager';
import { fetchBalance, getTransactionHistory, fetchEncryptedBalance, fetchTransactionDetails, fetchPendingTransactionByHash } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { OperationMode, saveOperationMode, loadOperationMode, isPrivateModeAvailable } from '../utils/modeStorage';
import { verifyPassword } from '../utils/password';
import { isPrivateTransfer } from '../utils/historyMerge';

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
  const [activeTab, setActiveTab] = useState<string>('balance');
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [showAddWalletDialog, setShowAddWalletDialog] = useState(false);
  const [showRPCManager, setShowRPCManager] = useState(false);
  const [showDAppsManager, setShowDAppsManager] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<Wallet | null>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  // Popup mode fullscreen states
  const [popupScreen, setPopupScreen] = useState<'main' | 'encrypt' | 'decrypt' | 'send' | 'receive' | 'claim' | 'txDetail'>('main');
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showEncryptDialog, setShowEncryptDialog] = useState(false);
  const [showDecryptDialog, setShowDecryptDialog] = useState(false);
  const [selectedTxHash, setSelectedTxHash] = useState<string | null>(null);
  const [selectedTxDetails, setSelectedTxDetails] = useState<any>(null);
  const [loadingTxDetails, setLoadingTxDetails] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [encryptedBalance, setEncryptedBalance] = useState<any>(null);
  const [rpcStatus, setRpcStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [operationMode, setOperationMode] = useState<OperationMode>('public');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isVerifyingReset, setIsVerifyingReset] = useState(false);
  const [showExportKeys, setShowExportKeys] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [showScrollUpIndicator, setShowScrollUpIndicator] = useState(false);
  const { toast } = useToast();

  // Determine if private mode is available
  const privateEnabled = isPrivateModeAvailable(encryptedBalance?.encrypted || 0);

  // Handle mode change
  const handleModeChange = (mode: OperationMode) => {
    setOperationMode(mode);
    saveOperationMode(mode);
    setActiveTab('balance'); // Reset to balance tab when switching modes
    // Refresh session timeout on user activity
    WalletManager.refreshSessionTimeout();
  };

  // Load operation mode on mount and when encrypted balance changes
  useEffect(() => {
    const encBalance = encryptedBalance?.encrypted || 0;
    const savedMode = loadOperationMode(encBalance);
    setOperationMode(savedMode);
  }, [encryptedBalance]);

  // Check if content is scrollable (for popup mode scroll indicator in history tab)
  useEffect(() => {
    if (!isPopupMode || activeTab !== 'history') {
      setShowScrollIndicator(false);
      setShowScrollUpIndicator(false);
      return;
    }

    const scrollContainer = document.querySelector('.popup-container');
    if (!scrollContainer) return;

    const checkScrollPosition = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const isAtTop = scrollTop < 50;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 20;
      const hasScrollableContent = scrollHeight > clientHeight;

      setShowScrollIndicator(hasScrollableContent && !isAtBottom);
      setShowScrollUpIndicator(hasScrollableContent && !isAtTop);
    };

    const timer = setTimeout(checkScrollPosition, 100);
    scrollContainer.addEventListener('scroll', checkScrollPosition);
    window.addEventListener('resize', checkScrollPosition);

    return () => {
      clearTimeout(timer);
      scrollContainer.removeEventListener('scroll', checkScrollPosition);
      window.removeEventListener('resize', checkScrollPosition);
    };
  }, [isPopupMode, activeTab, transactions.length]);

  // Check RPC status every 1 minute using active RPC provider
  useEffect(() => {
    const checkRpcStatus = async () => {
      try {
        // Get active RPC provider from localStorage
        let rpcUrl = 'https://octra.network';
        try {
          const providers = JSON.parse(localStorage.getItem('rpcProviders') || '[]');
          const activeProvider = providers.find((p: any) => p.isActive);
          if (activeProvider?.url) {
            rpcUrl = activeProvider.url;
          }
        } catch (e) {
          console.warn('Failed to get RPC provider:', e);
        }

        // Use the proxy in development mode
        const isDevelopment = import.meta.env.DEV;
        const isExtension = typeof chrome !== 'undefined' && 
                            chrome.runtime && 
                            typeof chrome.runtime.id === 'string' &&
                            chrome.runtime.id.length > 0;
        
        let url: string;
        const headers: Record<string, string> = {};
        
        if (isExtension) {
          url = `${rpcUrl}/status`;
        } else if (isDevelopment) {
          url = '/api/status';
          headers['X-RPC-URL'] = rpcUrl;
        } else {
          url = '/rpc-proxy/status';
          headers['X-RPC-Target'] = rpcUrl;
        }
        
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        setRpcStatus(response.status === 200 ? 'connected' : 'disconnected');
      } catch (error) {
        console.error('RPC status check failed:', error);
        setRpcStatus('disconnected');
      }
    };

    // Check immediately on mount
    checkRpcStatus();

    // Check every 1 minute
    const interval = setInterval(checkRpcStatus, 60000);

    return () => clearInterval(interval);
  }, []);

  // Initial data fetch when wallet is connected
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!wallet) return;

      // Reset encrypted balance and mode to public when wallet changes
      // This ensures new/switched wallets start in public mode
      setEncryptedBalance(null);
      setOperationMode('public');

      try {
        // Fetch balance and nonce
        setIsLoadingBalance(true);
        const balanceData = await fetchBalance(wallet.address);
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);
        
        // Fetch encrypted balance for the new wallet
        try {
          const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
          if (encData) {
            setEncryptedBalance(encData);
          } else {
            // Set default encrypted balance for new wallet
            setEncryptedBalance({
              public: balanceData.balance,
              public_raw: Math.floor(balanceData.balance * 1_000_000),
              encrypted: 0,
              encrypted_raw: 0,
              total: balanceData.balance
            });
          }
        } catch (encError) {
          console.error('Failed to fetch encrypted balance:', encError);
          setEncryptedBalance({
            public: balanceData.balance,
            public_raw: Math.floor(balanceData.balance * 1_000_000),
            encrypted: 0,
            encrypted_raw: 0,
            total: balanceData.balance
          });
        }
      } catch (error) {
        console.error('Failed to fetch balance:', error);
        // Don't show error for new addresses, just set balance to 0
        setBalance(0);
        setNonce(0);
        setEncryptedBalance({
          public: 0,
          public_raw: 0,
          encrypted: 0,
          encrypted_raw: 0,
          total: 0
        });
      } finally {
        setIsLoadingBalance(false);
      }

      try {
        // Fetch transaction history
        setIsLoadingTransactions(true);
        const result = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(result.transactions)) {
          const transformedTxs = result.transactions.map((tx) => ({
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
        const result = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(result.transactions)) {
          const transformedTxs = result.transactions.map((tx) => ({
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
      
    } catch (error) {
      console.error('Failed to refresh wallet data:', error);
      
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh data.",
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
      // Only show toast in expanded mode
      if (!isPopupMode) {
        toast({
          title: "Copied!",
          description: `${label} copied to clipboard`,
        });
      }
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
    } catch (error) {
      console.error('Failed to lock wallets:', error);
      toast({
        title: "Lock Failed",
        description: "Failed to lock wallets properly",
        variant: "destructive",
      });
    }
  };

  const handleResetAll = async () => {
    if (!resetPassword) {
      toast({
        title: "Password Required",
        description: "Please enter your wallet password to confirm reset",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingReset(true);

    try {
      // Verify password first
      const hashedPassword = localStorage.getItem('walletPasswordHash');
      const salt = localStorage.getItem('walletPasswordSalt');

      if (!hashedPassword || !salt) {
        toast({
          title: "No Password Set",
          description: "No wallet password found",
          variant: "destructive",
        });
        setIsVerifyingReset(false);
        return;
      }

      const isValid = await verifyPassword(resetPassword, hashedPassword, salt);

      if (!isValid) {
        toast({
          title: "Invalid Password",
          description: "The password you entered is incorrect",
          variant: "destructive",
        });
        setIsVerifyingReset(false);
        return;
      }

      // Password verified, proceed with reset
      // Clear all wallet-related data from ExtensionStorageManager
      await Promise.all([
        ExtensionStorageManager.remove('wallets'),
        ExtensionStorageManager.remove('encryptedWallets'),
        ExtensionStorageManager.remove('activeWalletId'),
        ExtensionStorageManager.remove('walletPasswordHash'),
        ExtensionStorageManager.remove('walletPasswordSalt'),
        ExtensionStorageManager.remove('isWalletLocked'),
        ExtensionStorageManager.remove('connectedDApps'),
      ]);

      // Clear localStorage
      localStorage.removeItem('wallets');
      localStorage.removeItem('encryptedWallets');
      localStorage.removeItem('activeWalletId');
      localStorage.removeItem('walletPasswordHash');
      localStorage.removeItem('walletPasswordSalt');
      localStorage.removeItem('isWalletLocked');
      localStorage.removeItem('connectedDApps');

      // Clear session password
      WalletManager.clearSessionPassword();

      // Reset state
      setShowResetConfirm(false);
      setResetPassword('');
      setShowResetPassword(false);

      toast({
        title: "Reset Complete",
        description: "All wallet data has been cleared. Reloading...",
      });

      // If in popup mode, open expanded view for welcome screen
      if (isPopupMode) {
        setTimeout(() => {
          // Open expanded view
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            chrome.tabs.create({
              url: chrome.runtime.getURL('index.html')
            });
            // Close popup
            window.close();
          } else {
            window.location.reload();
          }
        }, 1000);
      } else {
        // Reload the page to reset state
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to reset wallet:', error);
      toast({
        title: "Reset Failed",
        description: "Failed to reset wallet data",
        variant: "destructive",
      });
    } finally {
      setIsVerifyingReset(false);
    }
  };

  const handleRemoveWallet = async () => {
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
    
    const addressToDelete = walletToDelete.address;
    
    // Remove from encrypted wallets FIRST before calling onRemoveWallet
    // This ensures the wallet is removed from all storage locations
    try {
      // Remove from localStorage
      const localEncryptedWallets = JSON.parse(localStorage.getItem('encryptedWallets') || '[]');
      const updatedLocalEncrypted = localEncryptedWallets.filter(
        (w: any) => w.address !== addressToDelete
      );
      localStorage.setItem('encryptedWallets', JSON.stringify(updatedLocalEncrypted));
      
      // Remove from chrome.storage using Promise
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await new Promise<void>((resolve) => {
          chrome.storage.local.get(['encryptedWallets'], (result) => {
            if (result.encryptedWallets) {
              try {
                const chromeEncryptedWallets = typeof result.encryptedWallets === 'string' 
                  ? JSON.parse(result.encryptedWallets) 
                  : result.encryptedWallets;
                const updatedChromeEncrypted = chromeEncryptedWallets.filter(
                  (w: any) => w.address !== addressToDelete
                );
                chrome.storage.local.set({ 
                  encryptedWallets: JSON.stringify(updatedChromeEncrypted) 
                }, () => {
                  resolve();
                });
              } catch (e) {
                console.error('Failed to parse chrome encryptedWallets:', e);
                resolve();
              }
            } else {
              resolve();
            }
          });
        });
      }
    } catch (error) {
      console.error('Failed to remove from encryptedWallets:', error);
    }
    
    // Calculate remaining wallets after removal
    const remainingWallets = wallets.filter(w => w.address !== addressToDelete);
    
    // If we're removing the active wallet, we need to switch to another wallet first
    if (addressToDelete === wallet.address && remainingWallets.length > 0) {
      // Find the best replacement wallet (first in the list)
      const newActiveWallet = remainingWallets[0];
      
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
    // Check if wallet already exists in current wallets state (source of truth)
    const walletExists = wallets.some((w: Wallet) => w.address === newWallet.address);
    if (walletExists) {
      toast({
        title: "Wallet Exists",
        description: "This wallet is already in your wallet list",
        variant: "destructive",
      });
      return;
    }
    
    // Add wallet through parent handler (which handles storage properly)
    onAddWallet(newWallet);
    setShowAddWalletDialog(false);
    
    toast({
      title: "Wallet Added",
      description: "New wallet has been added successfully",
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
    // Refresh session timeout on transaction activity
    WalletManager.refreshSessionTimeout();
    
    // Refresh transaction history and balance after successful transaction
    const refreshData = async () => {
      try {
        // Refresh balance and nonce
        const balanceData = await fetchBalance(wallet.address);
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);

        // Refresh transaction history
        const result = await getTransactionHistory(wallet.address);
        
        if (Array.isArray(result.transactions)) {
          const transformedTxs = result.transactions.map((tx) => ({
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

  // Handler for viewing transaction details in popup mode
  const handleViewTxDetails = async (txHash: string, isPending: boolean = false) => {
    setSelectedTxHash(txHash);
    setLoadingTxDetails(true);
    setPopupScreen('txDetail');
    
    try {
      if (isPending) {
        // Try to fetch from pending transactions first with retry
        const pendingTx = await fetchPendingTransactionByHash(txHash);
        if (pendingTx) {
          setSelectedTxDetails(pendingTx);
        } else {
          // If not found in pending, try confirmed transactions
          // (transaction might have been confirmed already)
          try {
            const details = await fetchTransactionDetails(txHash);
            setSelectedTxDetails(details);
          } catch {
            // Still not found, set null
            setSelectedTxDetails(null);
            toast({
              title: "Not Found",
              description: "Transaction not found. It may still be processing.",
              variant: "destructive",
            });
          }
        }
      } else {
        const details = await fetchTransactionDetails(txHash);
        setSelectedTxDetails(details);
      }
    } catch (error) {
      console.error('Failed to fetch transaction details:', error);
      toast({
        title: "Error",
        description: "Failed to fetch transaction details",
        variant: "destructive",
      });
      setSelectedTxDetails(null);
    } finally {
      setLoadingTxDetails(false);
    }
  };

  return (
    <div className={`min-h-screen transition-all duration-300 ${
      operationMode === 'private' 
        ? 'ring-1 ring-[#0000db] ring-inset' 
        : ''
    }`}>
      {/* ============================================ */}
      {/* POPUP MODE - NEW FULLSCREEN UI */}
      {/* ============================================ */}
      {isPopupMode && popupScreen !== 'main' && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col">
          {/* Fullscreen Encrypt */}
          {popupScreen === 'encrypt' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  <h2 className="font-semibold">Encrypt OCT</h2>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center overflow-y-auto p-4">
                <div className="w-full max-w-sm">
                  <EncryptBalanceDialog
                    open={true}
                    onOpenChange={(open) => {
                      if (!open) setPopupScreen('main');
                    }}
                    wallet={wallet}
                    publicBalance={balance || 0}
                    onSuccess={() => {
                      refreshWalletData();
                      setPopupScreen('main');
                    }}
                    isPopupMode={true}
                    isInline={true}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Decrypt */}
          {popupScreen === 'decrypt' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Unlock className="h-5 w-5 text-[#0000db]" />
                  <h2 className="font-semibold text-[#0000db]">Decrypt OCT</h2>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center overflow-y-auto p-4">
                <div className="w-full max-w-sm">
                  <DecryptBalanceDialog
                    open={true}
                    onOpenChange={(open) => {
                      if (!open) setPopupScreen('main');
                    }}
                    wallet={wallet}
                    encryptedBalance={encryptedBalance?.encrypted || 0}
                    onSuccess={() => {
                      refreshWalletData();
                      setPopupScreen('main');
                    }}
                    isPopupMode={true}
                    isInline={true}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Send */}
          {popupScreen === 'send' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Send className={`h-5 w-5 ${operationMode === 'private' ? 'text-[#0000db]' : ''}`} />
                  <h2 className={`font-semibold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                    {operationMode === 'private' ? 'Private Transfer' : 'Send OCT'}
                  </h2>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center overflow-y-auto p-4">
                <div className="w-full max-w-sm">
                  {operationMode === 'public' ? (
                    <SendTransaction
                      wallet={wallet}
                      balance={balance}
                      nonce={nonce}
                      onBalanceUpdate={handleBalanceUpdate}
                      onNonceUpdate={handleNonceUpdate}
                      onTransactionSuccess={handleTransactionSuccess}
                      isCompact={true}
                    />
                  ) : (
                    <PrivateTransfer
                      wallet={wallet}
                      balance={balance}
                      nonce={nonce}
                      encryptedBalance={encryptedBalance}
                      onBalanceUpdate={handleBalanceUpdate}
                      onNonceUpdate={handleNonceUpdate}
                      onTransactionSuccess={handleTransactionSuccess}
                      isCompact={true}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Receive */}
          {popupScreen === 'receive' && (
            <ReceiveDialog
              wallet={wallet}
              open={true}
              onOpenChange={() => setPopupScreen('main')}
              isPopupMode={true}
              isFullscreen={true}
              onBack={() => setPopupScreen('main')}
            />
          )}

          {/* Fullscreen Claim */}
          {popupScreen === 'claim' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 p-4 border-b">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-[#0000db]" />
                  <h2 className="font-semibold text-[#0000db]">Claim Transfers</h2>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <ClaimTransfers
                  wallet={wallet}
                  onTransactionSuccess={handleTransactionSuccess}
                  isPopupMode={true}
                  hideBorder={true}
                />
              </div>
            </div>
          )}

          {/* Fullscreen Transaction Detail */}
          {popupScreen === 'txDetail' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 p-4 border-b">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  <h2 className="font-semibold">Transaction Details</h2>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {loadingTxDetails ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                  </div>
                ) : selectedTxDetails ? (
                  <div className="space-y-2">
                    {/* Status */}
                    <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Status</span>
                      {'stage_status' in selectedTxDetails ? (
                        <Badge variant="secondary" className="text-[10px] bg-yellow-500/20 text-yellow-600 h-5">
                          {selectedTxDetails.stage_status || 'pending'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-600 h-5">
                          confirmed
                        </Badge>
                      )}
                    </div>

                    {/* Epoch - only for confirmed */}
                    {'epoch' in selectedTxDetails && (
                      <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Epoch</span>
                        <span className="font-mono text-xs">{selectedTxDetails.epoch}</span>
                      </div>
                    )}

                    {/* Time */}
                    {('timestamp' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Time (UTC)</span>
                        <span className="text-xs">
                          {'timestamp' in selectedTxDetails 
                            ? new Date(selectedTxDetails.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                            : new Date(selectedTxDetails.parsed_tx.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                          }
                        </span>
                      </div>
                    )}

                    {/* Hash */}
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Hash</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-5 w-5 p-0" 
                          onClick={() => copyToClipboard('hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash, 'Hash')}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="font-mono text-[10px] break-all">
                        {'hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash}
                      </p>
                    </div>

                    {/* From - full address */}
                    {('from' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="bg-muted/50 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">From</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-5 w-5 p-0" 
                            onClick={() => copyToClipboard('from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from, 'Address')}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="font-mono text-xs break-all">
                          {'from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from}
                        </p>
                      </div>
                    )}

                    {/* To - full address */}
                    {('to' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="bg-muted/50 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">To</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-5 w-5 p-0" 
                            onClick={() => copyToClipboard('to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to, 'Address')}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="font-mono text-xs break-all">
                          {'to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to}
                        </p>
                      </div>
                    )}

                    {/* Amount, OU (Gas), Nonce */}
                    <div className="grid grid-cols-3 gap-2">
                      {('amount' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                        <div className="bg-muted/50 rounded-lg p-2">
                          <span className="text-[10px] text-muted-foreground">Amount</span>
                          <p className="font-mono text-xs font-semibold mt-0.5">
                            {'amount' in selectedTxDetails ? selectedTxDetails.amount : selectedTxDetails.parsed_tx.amount} OCT
                          </p>
                        </div>
                      )}
                      {('ou' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                        <div className="bg-muted/50 rounded-lg p-2">
                          <span className="text-[10px] text-muted-foreground">OU (Gas)</span>
                          <p className="font-mono text-[10px] mt-0.5">
                            {'ou' in selectedTxDetails ? selectedTxDetails.ou : selectedTxDetails.parsed_tx.ou}
                          </p>
                        </div>
                      )}
                      {('nonce' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                        <div className="bg-muted/50 rounded-lg p-2">
                          <span className="text-[10px] text-muted-foreground">Nonce</span>
                          <p className="font-mono text-xs mt-0.5">
                            {'nonce' in selectedTxDetails ? selectedTxDetails.nonce : selectedTxDetails.parsed_tx.nonce}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* View on Explorer */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      asChild
                    >
                      <a 
                        href={`https://octrascan.io/transactions/${selectedTxHash}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on Explorer
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No transaction data available</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Header - Fixed position for expanded mode */}
      <header className={`octra-header w-full ${isPopupMode ? 'sticky top-0' : 'fixed top-0 left-0 right-0'} z-50`}>
        <div className={`w-full ${isPopupMode ? 'px-3' : 'px-6 sm:px-8 lg:px-12'}`}>
          <div className={`flex items-center justify-between ${isPopupMode ? 'py-1' : 'py-2 sm:py-4'}`}>
            <div className="flex items-center space-x-4">
              <div className={`flex items-center ${isPopupMode ? 'space-x-2' : 'space-x-3'}`}>
                <Avatar className={`${isPopupMode ? 'h-6 w-6' : 'h-10 w-10'}`}>
                  <img 
                    src={isPopupMode ? "/icons/octwa32x32.png" : "/icons/octwa48x48.png"}
                    alt="OctWa Logo" 
                    className="h-full w-full object-contain"
                  />
                </Avatar>
                <div>
                  <h1 className={`${isPopupMode ? 'text-sm' : 'text-xl'} font-semibold text-foreground`}>
                    OctWa - Octra Wallet
                  </h1>
                  <div className="flex items-center space-x-2">
                    {/* Wallet Selector - Sheet for popup mode, Dropdown for expanded */}
                    {isPopupMode ? (
                      <Sheet open={showWalletSelector} onOpenChange={setShowWalletSelector}>
                        <SheetTrigger asChild>
                          <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-muted-foreground">
                                {truncateAddress(wallet.address)}
                              </p>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </div>
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-80 flex flex-col pb-14">
                          <SheetHeader>
                            <SheetTitle>Select Wallet ({wallets.length})</SheetTitle>
                            <SheetDescription className="sr-only">Choose a wallet from your list</SheetDescription>
                          </SheetHeader>
                          <div className="flex-1 mt-4 overflow-hidden">
                            <ScrollArea className="h-full max-h-[calc(100vh-220px)]">
                              <div className="space-y-1 pr-2">
                                {wallets.map((w, i) => {
                                  const isActive = w.address === wallet.address;
                                  return (
                                    <div key={w.address}>
                                      {i > 0 && <div className="h-px bg-border my-1" />}
                                      <div
                                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer group gap-2 ${
                                          isActive 
                                            ? 'bg-[#0000db]/10 border border-[#0000db]/30 text-[#0000db]' 
                                            : 'hover:bg-accent hover:text-accent-foreground border border-transparent'
                                        }`}
                                        onClick={() => {
                                          onSwitchWallet(w);
                                          setShowWalletSelector(false);
                                        }}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center space-x-2">
                                            <span className={`font-mono text-sm truncate ${isActive ? 'font-semibold' : ''}`}>
                                              #{i + 1} {truncateAddress(w.address)}
                                            </span>
                                          </div>
                                          {w.type && (
                                            <div className={`text-xs mt-1 ${isActive ? 'text-[#0000db]/70' : 'text-muted-foreground'}`}>
                                              {w.type === 'generated' && 'Generated'}
                                              {w.type === 'imported-mnemonic' && 'Imported (mnemonic)'}
                                              {w.type === 'imported-private-key' && 'Imported (key)'}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center space-x-1 flex-shrink-0">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              copyToClipboard(w.address, 'Address');
                                            }}
                                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                            title="Copy address"
                                          >
                                            <Copy className="h-3.5 w-3.5" />
                                          </Button>
                                          {wallets.length > 1 && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setWalletToDelete(w);
                                                setShowWalletSelector(false);
                                              }}
                                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                              title="Remove wallet"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </div>
                          <div className="mt-4 pt-4 border-t flex-shrink-0">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowAddWalletDialog(true);
                                setShowWalletSelector(false);
                              }}
                              className="w-full justify-center gap-2"
                            >
                              <Plus className="h-4 w-4" />
                              Add Wallet
                            </Button>
                          </div>
                        </SheetContent>
                      </Sheet>
                    ) : (
                      <Sheet open={showWalletSelector} onOpenChange={setShowWalletSelector}>
                        <SheetTrigger asChild>
                          <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-muted-foreground">
                                {truncateAddress(wallet.address)}
                              </p>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </div>
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[400px] sm:w-[480px] flex flex-col">
                          <SheetHeader>
                            <SheetTitle>Select Wallet ({wallets.length})</SheetTitle>
                            <SheetDescription className="sr-only">Choose a wallet from your list</SheetDescription>
                          </SheetHeader>
                          <div className="flex-1 mt-4 overflow-hidden">
                            <ScrollArea className="h-full max-h-[calc(100vh-200px)]">
                              <div className="space-y-1 pr-4">
                                {wallets.map((w, i) => {
                                  const isActive = w.address === wallet.address;
                                  return (
                                    <div key={w.address}>
                                      {i > 0 && <div className="h-px bg-border my-1" />}
                                      <div
                                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer group gap-2 ${
                                          isActive 
                                            ? 'bg-[#0000db]/10 border border-[#0000db]/30 text-[#0000db]' 
                                            : 'hover:bg-accent hover:text-accent-foreground border border-transparent'
                                        }`}
                                        onClick={() => {
                                          onSwitchWallet(w);
                                          setShowWalletSelector(false);
                                        }}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center space-x-2">
                                            <span className={`font-mono text-sm truncate ${isActive ? 'font-semibold' : ''}`}>
                                              #{i + 1} {truncateAddress(w.address)}
                                            </span>
                                          </div>
                                          {w.type && (
                                            <div className={`text-xs mt-1 ${isActive ? 'text-[#0000db]/70' : 'text-muted-foreground'}`}>
                                              {w.type === 'generated' && 'Generated wallet'}
                                              {w.type === 'imported-mnemonic' && 'Imported wallet (mnemonic)'}
                                              {w.type === 'imported-private-key' && 'Imported wallet (private key)'}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center space-x-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              copyToClipboard(w.address, 'Address');
                                            }}
                                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                            title="Copy address"
                                          >
                                            <Copy className="h-3.5 w-3.5" />
                                          </Button>
                                          {wallets.length > 1 && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setWalletToDelete(w);
                                                setShowWalletSelector(false);
                                              }}
                                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                              title="Remove wallet"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </div>
                          <div className="mt-4 pt-4 border-t flex-shrink-0">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowAddWalletDialog(true);
                                setShowWalletSelector(false);
                              }}
                              className="w-full justify-center gap-2"
                            >
                              <Plus className="h-4 w-4" />
                              Add Wallet
                            </Button>
                          </div>
                        </SheetContent>
                      </Sheet>
                    )}
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
                    <span className={`absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
                      rpcStatus === 'connected' ? 'bg-[#0000db]' : 
                      rpcStatus === 'disconnected' ? 'bg-red-500' : 
                      'bg-yellow-500 animate-pulse'
                    }`}></span>
                    {rpcStatus === 'connected' ? 'Connected' : 
                     rpcStatus === 'disconnected' ? 'Disconnected' : 
                     'Checking...'}
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
                  <ThemeToggle isPopupMode={true} />
                  {/* Mobile Hamburger Menu with expanded functionality */}
                  <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-80 pb-14">
                      <SheetHeader>
                        <SheetTitle>Wallet Menu</SheetTitle>
                        <SheetDescription className="sr-only">Wallet settings and actions</SheetDescription>
                      </SheetHeader>
                      <div className="mt-6 space-y-4">
                        {/* Wallet Info Card */}
                        <div className="p-4 bg-gradient-to-br from-[#0000db]/5 to-[#0000db]/10 border border-[#0000db]/20 rounded-xl">
                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-transparent border border-muted rounded-lg p-2.5 text-center">
                              <div className="text-xs text-muted-foreground mb-0.5">Nonce</div>
                              <div className="text-lg font-semibold text-[#0000db]">{nonce}</div>
                            </div>
                            <div className="bg-transparent border border-muted rounded-lg p-2.5 text-center">
                              <div className="text-xs text-muted-foreground mb-0.5">Wallets</div>
                              <div className="text-lg font-semibold text-[#0000db]">{wallets.length}</div>
                            </div>
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

                        {/* Export Private Keys */}
                        <Button
                          variant="destructive"
                          onClick={() => {
                            setShowExportKeys(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2"
                        >
                          <Key className="h-4 w-4" />
                          Export Private Keys
                        </Button>

                        {/* Lock Wallet */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowLockConfirm(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2 text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 border-orange-600 hover:border-orange-700 dark:border-orange-400 dark:hover:border-orange-300"
                        >
                          <Lock className="h-4 w-4" />
                          Lock Wallet
                        </Button>

                        {/* Reset All */}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowResetConfirm(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-500 hover:border-red-700 dark:border-red-400 dark:hover:border-red-300"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reset All
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                </>
              ) : (
                // Expanded mode - Full layout
                <>
                  <ThemeToggle isPopupMode={false} />
                  {/* Desktop Menu Items */}
                  <div className="hidden md:flex items-center space-x-2">
                    {/* Buttons with caption: RPC, dApps, Add Wallet */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRPCManager(true)}
                      className="flex items-center gap-2"
                    >
                      <Wifi className="h-4 w-4" />
                      RPC
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDAppsManager(true)}
                      className="flex items-center gap-2"
                    >
                      <Globe className="h-4 w-4" />
                      dApps
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => setShowAddWalletDialog(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Add Wallet
                    </Button>
                    
                    {/* Text buttons: Export Private Keys, Lock Wallet, Reset All */}
                    <Button 
                      variant="destructive" 
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => setShowExportKeys(true)}
                    >
                      <Key className="h-4 w-4" />
                      Export Keys
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 border-orange-600 hover:border-orange-700 dark:border-orange-400 dark:hover:border-orange-300 flex items-center gap-2"
                      onClick={() => setShowLockConfirm(true)}
                    >
                      <Lock className="h-4 w-4" />
                      Lock
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowResetConfirm(true)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-500 hover:border-red-700 dark:border-red-400 dark:hover:border-red-300 flex items-center gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </Button>
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
                          <SheetDescription className="sr-only">Additional wallet settings and actions</SheetDescription>
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

                          {/* Export Private Keys */}
                          <Button
                            variant="destructive"
                            onClick={() => {
                              setShowExportKeys(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <Key className="h-4 w-4" />
                            Export Private Keys
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

                          {/* Reset All */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowResetConfirm(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Reset All
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
              
              {/* Add Wallet - Use screen-based navigation for both modes */}
              <AddWalletPopup
                open={showAddWalletDialog}
                onOpenChange={setShowAddWalletDialog}
                onWalletCreated={handleImportSuccess}
                isPopupMode={isPopupMode}
              />
              
              <Dialog open={showRPCManager} onOpenChange={setShowRPCManager}>
                <DialogContent className={isPopupMode ? "w-[360px] max-h-[500px] overflow-y-auto p-4" : "sm:max-w-2xl max-h-[80vh] overflow-y-auto"}>
                  <DialogHeader className={isPopupMode ? "pb-2" : ""}>
                    <DialogTitle className={isPopupMode ? "text-sm" : ""}>RPC Provider</DialogTitle>
                    {!isPopupMode && (
                      <DialogDescription>
                        Manage your RPC providers to connect to different blockchain networks.
                      </DialogDescription>
                    )}
                  </DialogHeader>
                  <RPCProviderManager 
                    onClose={() => setShowRPCManager(false)} 
                    onRPCChange={handleRPCChange}
                    isPopupMode={isPopupMode}
                  />
                </DialogContent>
              </Dialog>
              
              <Dialog open={showDAppsManager} onOpenChange={setShowDAppsManager}>
                <DialogContent className={isPopupMode ? "w-[360px] max-h-[500px] overflow-y-auto p-4" : "sm:max-w-2xl max-h-[80vh] overflow-y-auto"}>
                  <DialogHeader className={isPopupMode ? "pb-2" : ""}>
                    <DialogTitle className={isPopupMode ? "text-sm" : ""}>Connected dApps</DialogTitle>
                    {!isPopupMode && (
                      <DialogDescription>
                        View and manage applications that have been granted access to your wallet.
                      </DialogDescription>
                    )}
                  </DialogHeader>
                  <ConnectedDAppsManager 
                    wallets={wallets} 
                    onClose={() => setShowDAppsManager(false)}
                    isPopupMode={isPopupMode}
                  />
                </DialogContent>
              </Dialog>

              {/* Export Private Keys Dialog */}
              <ExportPrivateKeys 
                wallet={wallet} 
                open={showExportKeys} 
                onOpenChange={setShowExportKeys}
                isPopupMode={isPopupMode}
              />
              
              <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
                <AlertDialogContent className={isPopupMode ? "w-[340px] p-4" : ""}>
                  <AlertDialogHeader className={isPopupMode ? "pb-2" : ""}>
                    <AlertDialogTitle className={isPopupMode ? "text-sm" : ""}>Lock Wallet</AlertDialogTitle>
                    <AlertDialogDescription className={isPopupMode ? "text-xs" : ""}>
                      {isPopupMode 
                        ? "Lock your wallet? You'll need your password to unlock."
                        : "Are you sure you want to lock your wallet? You will need to enter your password to unlock it again."
                      }
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className={isPopupMode ? "flex-row gap-2 mt-2" : ""}>
                    <AlertDialogAction onClick={handleDisconnect} className={`bg-orange-600 hover:bg-orange-700 ${isPopupMode ? "h-9 text-xs flex-1" : ""}`}>
                      Lock Wallet
                    </AlertDialogAction>
                    <AlertDialogCancel className={isPopupMode ? "h-9 text-xs flex-1 mt-0" : ""}>Cancel</AlertDialogCancel>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog
                open={showResetConfirm}
                onOpenChange={(open) => {
                  setShowResetConfirm(open);
                  if (!open) {
                    setResetPassword('');
                    setShowResetPassword(false);
                  }
                }}
              >
                <AlertDialogContent className={isPopupMode ? "w-[340px] p-4" : ""}>
                  <AlertDialogHeader className={isPopupMode ? "pb-0" : ""}>
                    <AlertDialogTitle className={`text-red-500 ${isPopupMode ? "text-sm" : ""}`}>Reset All Wallets</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className={isPopupMode ? "text-xs space-y-2" : ""}>
                        <span className="font-semibold text-red-500">Warning:</span> {isPopupMode ? "This will delete ALL wallet data:" : "This will permanently delete ALL wallet data including:"}
                        <ul className={`list-disc list-inside ${isPopupMode ? "mt-1 space-y-0.5 text-[11px]" : "mt-2 space-y-1"}`}>
                          <li>All imported/generated wallets</li>
                          <li>Your password protection</li>
                          <li>Connected dApps</li>
                          <li>All encrypted data</li>
                        </ul>
                        <p className={`font-semibold ${isPopupMode ? "mt-2 text-[11px]" : "mt-3"}`}>
                          {isPopupMode ? "Backup your keys before proceeding!" : "Make sure you have backed up your private keys or seed phrases before proceeding!"}
                        </p>

                        <div className={isPopupMode ? "mt-1 space-y-1" : "mt-4 space-y-2"}>
                          <Label htmlFor="resetPassword" className={`text-foreground ${isPopupMode ? "text-xs" : ""}`}>Enter password to confirm</Label>
                          <div className="relative">
                            <Input
                              id="resetPassword"
                              type={showResetPassword ? 'text' : 'password'}
                              placeholder={isPopupMode ? "Password" : "Enter your wallet password"}
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              onKeyPress={(e) => e.key === 'Enter' && handleResetAll()}
                              className={`pr-10 ${isPopupMode ? "h-9 text-xs" : ""}`}
                              disabled={isVerifyingReset}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowResetPassword(!showResetPassword)}
                              disabled={isVerifyingReset}
                            >
                              {showResetPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Buttons inside description for popup mode to reduce spacing */}
                        {isPopupMode && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              onClick={handleResetAll}
                              disabled={isVerifyingReset || !resetPassword}
                              className="bg-red-600 hover:bg-red-700 h-9 text-xs flex-1"
                            >
                              {isVerifyingReset ? 'Verifying...' : 'Reset All'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setShowResetConfirm(false)}
                              disabled={isVerifyingReset}
                              className="h-9 text-xs flex-1"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {!isPopupMode && (
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isVerifyingReset}>Cancel</AlertDialogCancel>
                      <Button
                        onClick={handleResetAll}
                        disabled={isVerifyingReset || !resetPassword}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {isVerifyingReset ? 'Verifying...' : 'Reset All'}
                      </Button>
                    </AlertDialogFooter>
                  )}
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </header>

      {/* Sticky Mode Toggle - Only for expanded mode */}
      {!isPopupMode && (
        <div className="fixed top-[70px] sm:top-[83px] left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border/50 py-3">
          <div className="octra-container px-6 sm:px-8 lg:px-12">
            <ModeToggle
              currentMode={operationMode}
              onModeChange={handleModeChange}
              privateEnabled={privateEnabled}
              encryptedBalance={encryptedBalance?.encrypted || 0}
              isCompact={false}
            />
          </div>
        </div>
      )}

      {/* Main Content - Add padding-top for fixed header in expanded mode */}
      <main className={`octra-container ${isPopupMode ? 'pt-0 pb-0 px-3 flex flex-col h-[calc(100vh-50px)] overflow-hidden' : 'pt-[149px] sm:pt-[165px] pb-16 px-6 sm:px-8 lg:px-12 sm:pb-20'}`}>
        {/* ============================================ */}
        {/* POPUP MODE - NEW MAIN UI */}
        {/* ============================================ */}
        {isPopupMode ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden pb-10">
            {/* Sticky Header Section - Mode Toggle, Balance, Action Buttons, Recent Activity Title */}
            <div className="flex-shrink-0 space-y-2 bg-background">
              {/* Mode Toggle */}
              <div className="mt-2">
                <ModeToggle
                  currentMode={operationMode}
                  onModeChange={handleModeChange}
                  privateEnabled={privateEnabled}
                  encryptedBalance={encryptedBalance?.encrypted || 0}
                  isCompact={true}
                />
              </div>

              {/* Balance Display - transparent bg */}
              <div className={`rounded-lg p-2 border ${operationMode === 'private' ? 'border-[#0000db]/20' : 'border-border'}`}>
                <div className="text-center">
                  <p className={`text-[10px] font-medium ${operationMode === 'private' ? 'text-[#0000db]' : 'text-muted-foreground'}`}>
                    {operationMode === 'private' ? 'Private Balance' : 'Available Balance'}
                  </p>
                  {isLoadingBalance ? (
                    <div className="h-6 flex items-center justify-center">
                      <div className="w-4 h-4 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                    </div>
                  ) : (
                    <div className={`text-xl font-bold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                      {operationMode === 'private' 
                        ? (encryptedBalance?.encrypted || 0).toFixed(8)
                        : (balance || 0).toFixed(8)
                      }
                      <span className="text-sm ml-1">OCT</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className={`grid gap-1 ${operationMode === 'private' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {operationMode === 'public' ? (
                  <>
                    {/* Encrypt Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border"
                      onClick={() => setPopupScreen('encrypt')}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Encrypt</span>
                    </Button>
                    {/* Send Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border"
                      onClick={() => setPopupScreen('send')}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Send</span>
                    </Button>
                    {/* Receive Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border"
                      onClick={() => setPopupScreen('receive')}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Receive</span>
                    </Button>
                  </>
                ) : (
                  <>
                    {/* Decrypt Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('decrypt')}
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Decrypt</span>
                    </Button>
                    {/* Send Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('send')}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Send</span>
                    </Button>
                    {/* Receive Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('receive')}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Receive</span>
                    </Button>
                    {/* Claim Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0 h-auto py-1.5 rounded-lg border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('claim')}
                    >
                      <Gift className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium">Claim</span>
                    </Button>
                  </>
                )}
              </div>

              {/* Recent Activity Header */}
              <div className="flex items-center justify-between pt-1 pb-2">
                <h3 className={`text-xs font-semibold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                  Recent Activity
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshWalletData}
                    disabled={isRefreshingData}
                    className={`p-1 rounded hover:bg-muted transition-colors ${isRefreshingData ? 'opacity-50' : ''}`}
                  >
                    <RotateCcw className={`h-3 w-3 text-muted-foreground ${isRefreshingData ? 'animate-spin' : ''}`} />
                  </button>
                  <a 
                    href={`https://octrascan.io/addresses/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View All
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Transaction List - Scrollable area */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-1.5 pr-3 pb-4">
                {isLoadingTransactions ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                  </div>
                ) : (() => {
                  // Filter transactions based on operationMode
                  const filteredTxs = transactions.filter(tx => {
                    if (operationMode === 'private') {
                      return isPrivateTransfer(tx);
                    } else {
                      return !isPrivateTransfer(tx);
                    }
                  });
                  
                  if (filteredTxs.length === 0) {
                    return (
                      <div className="text-center py-4 text-muted-foreground">
                        <History className="h-5 w-5 mx-auto mb-1 opacity-50" />
                        <p className="text-[10px]">No {operationMode} transactions yet</p>
                      </div>
                    );
                  }
                  
                  return filteredTxs.slice(0, 20).map((tx) => {
                    const txIsPrivate = isPrivateTransfer(tx);
                    return (
                      <div 
                        key={tx.hash} 
                        className={`border rounded-lg p-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                          operationMode === 'private' ? 'border-[#0000db]/20' : 'border-border'
                        }`}
                        onClick={() => handleViewTxDetails(tx.hash, tx.status === 'pending')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {tx.type === 'sent' ? (
                              <Send className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                            ) : (
                              <Download className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {txIsPrivate ? (
                                  <span className="text-[#0000db] font-medium text-xs">Private</span>
                                ) : (
                                  <span className="font-mono text-xs">{(tx.amount || 0).toFixed(4)} OCT</span>
                                )}
                                {tx.status === 'confirmed' ? (
                                  <div className="h-3 w-3 rounded-full bg-[#0000db]/20 flex items-center justify-center">
                                    <div className="h-1.5 w-1.5 rounded-full bg-[#0000db]" />
                                  </div>
                                ) : tx.status === 'pending' ? (
                                  <div className="h-3 w-3 rounded-full border border-yellow-500 animate-pulse" />
                                ) : (
                                  <div className="h-3 w-3 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {tx.type === 'sent' ? 'To: ' : 'From: '}{truncateAddress(tx.type === 'sent' ? tx.to : tx.from)}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground flex-shrink-0">
                            {new Date(tx.timestamp * 1000).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </ScrollArea>
          </div>
        ) : (
        /* ============================================ */
        /* EXPANDED MODE - ORIGINAL TABS UI */
        /* ============================================ */
        <Tabs value={activeTab} onValueChange={(tab) => {
          setActiveTab(tab);
          // Fetch latest state when switching to balance or history tab
          if (tab === 'balance' || tab === 'history') {
            refreshWalletData();
          }
        }} className="">
          {/* TabsList - Only show inline for expanded mode */}
          {operationMode === 'public' ? (
              // Public Mode Tabs - Classic tab style full width with centered caption
              <div className="relative">
                <TabsList className="relative z-10 grid w-full grid-cols-3 h-auto p-0 bg-transparent gap-0">
                  <TabsTrigger 
                    value="balance" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/50 data-[state=active]:bg-background data-[state=active]:border-foreground/20 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=inactive]:hover:bg-muted transition-all -mr-px"
                  >
                    <PieChart className="h-4 w-4" />
                    <span className="font-medium">Balance</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="send" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/50 data-[state=active]:bg-background data-[state=active]:border-foreground/20 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=inactive]:hover:bg-muted transition-all -mr-px"
                  >
                    <Send className="h-4 w-4" />
                    <span className="font-medium">Send</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="history" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/50 data-[state=active]:bg-background data-[state=active]:border-foreground/20 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=inactive]:hover:bg-muted transition-all"
                  >
                    <History className="h-4 w-4" />
                    <span className="font-medium">History</span>
                  </TabsTrigger>
                </TabsList>
              </div>
            ) : (
              // Private Mode Tabs - Classic tab style full width with centered caption
              <div className="relative">
                <TabsList className="relative z-10 grid w-full grid-cols-4 h-auto p-0 bg-transparent gap-0">
                  <TabsTrigger 
                    value="balance" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-[#0000db]/30 bg-[#0000db]/5 data-[state=active]:bg-background data-[state=active]:border-[#0000db]/40 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=active]:text-[#0000db] data-[state=inactive]:hover:bg-[#0000db]/10 transition-all -mr-px"
                  >
                    <Shield className="h-4 w-4" />
                    <span className="font-medium">Balance</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="transfer" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-[#0000db]/30 bg-[#0000db]/5 data-[state=active]:bg-background data-[state=active]:border-[#0000db]/40 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=active]:text-[#0000db] data-[state=inactive]:hover:bg-[#0000db]/10 transition-all -mr-px"
                  >
                    <Send className="h-4 w-4" />
                    <span className="font-medium">Send</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="claim" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-[#0000db]/30 bg-[#0000db]/5 data-[state=active]:bg-background data-[state=active]:border-[#0000db]/40 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=active]:text-[#0000db] data-[state=inactive]:hover:bg-[#0000db]/10 transition-all -mr-px"
                  >
                    <Gift className="h-4 w-4" />
                    <span className="font-medium">Claim</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="history" 
                    className="flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-t-lg rounded-b-none border border-b-0 border-[#0000db]/30 bg-[#0000db]/5 data-[state=active]:bg-background data-[state=active]:border-[#0000db]/40 data-[state=active]:border-b-background data-[state=active]:-mb-px data-[state=active]:z-10 data-[state=active]:text-[#0000db] data-[state=inactive]:hover:bg-[#0000db]/10 transition-all"
                  >
                    <History className="h-4 w-4" />
                    <span className="font-medium">History</span>
                  </TabsTrigger>
                </TabsList>
              </div>
            )}

          {/* Balance Tab Content - Connected to tabs */}
          <TabsContent value="balance" className={`tab-animated mt-0 border ${operationMode === 'private' ? 'border-[#0000db]/40' : 'border-foreground/20'} rounded-b-lg rounded-t-none bg-background p-4`}>
            {operationMode === 'public' ? (
              <PublicBalance 
                wallet={wallet} 
                balance={balance}
                encryptedBalance={encryptedBalance}
                onEncryptedBalanceUpdate={setEncryptedBalance}
                onBalanceUpdate={handleBalanceUpdate}
                isLoading={isLoadingBalance || isRefreshingData}
                hideBorder={true}
                isPopupMode={false}
              />
            ) : (
              <PrivateBalance 
                wallet={wallet} 
                balance={balance}
                encryptedBalance={encryptedBalance}
                onEncryptedBalanceUpdate={setEncryptedBalance}
                onBalanceUpdate={handleBalanceUpdate}
                isLoading={isLoadingBalance || isRefreshingData}
                hideBorder={true}
                isPopupMode={false}
              />
            )}
          </TabsContent>

          {/* Send Tab (Public Mode) */}
          {operationMode === 'public' && (
            <TabsContent value="send" className="tab-animated mt-0 border border-foreground/20 rounded-b-lg rounded-t-none bg-background px-4 pb-4">
              {/* Expanded mode: Full tabs with Single, Multi, File - Embedded style */}
              <Tabs defaultValue="single" className="w-full pt-3">
                  <TabsList className="grid w-full grid-cols-3 h-9 p-0 rounded-lg bg-muted/60 border border-border/30">
                    <TabsTrigger 
                      value="single" 
                      className="text-sm py-1.5 rounded-l-lg rounded-r-none border-r border-border/30 data-[state=active]:bg-background data-[state=active]:shadow-sm font-medium"
                    >
                      Single
                    </TabsTrigger>
                    <TabsTrigger 
                      value="multi" 
                      className="text-sm py-1.5 rounded-none border-r border-border/30 data-[state=active]:bg-background data-[state=active]:shadow-sm font-medium"
                    >
                      Multi
                    </TabsTrigger>
                    <TabsTrigger 
                      value="file" 
                      className="text-sm py-1.5 rounded-r-lg rounded-l-none data-[state=active]:bg-background data-[state=active]:shadow-sm font-medium"
                    >
                      File
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="single" className="mt-3 subtab-animated">
                    <SendTransaction
                      wallet={wallet}
                      balance={balance}
                      nonce={nonce}
                      onBalanceUpdate={handleBalanceUpdate}
                      onNonceUpdate={handleNonceUpdate}
                      onTransactionSuccess={handleTransactionSuccess}
                    />
                  </TabsContent>

                  <TabsContent value="multi" className="mt-3 subtab-animated">
                    <MultiSend
                      wallet={wallet}
                      balance={balance}
                      nonce={nonce}
                      onBalanceUpdate={handleBalanceUpdate}
                      onNonceUpdate={handleNonceUpdate}
                      onTransactionSuccess={handleTransactionSuccess}
                      hideBorder={true}
                    />
                  </TabsContent>

                  <TabsContent value="file" className="mt-3 subtab-animated">
                    <FileMultiSend
                      wallet={wallet}
                      balance={balance}
                      nonce={nonce}
                      onBalanceUpdate={handleBalanceUpdate}
                      onNonceUpdate={handleNonceUpdate}
                      onTransactionSuccess={handleTransactionSuccess}
                      hideBorder={true}
                    />
                  </TabsContent>
                </Tabs>
            </TabsContent>
          )}

          {/* Transfer Tab (Private Mode) */}
          {operationMode === 'private' && (
            <TabsContent value="transfer" className="tab-animated mt-0 border border-[#0000db]/40 rounded-b-lg rounded-t-none bg-background p-4">
              <PrivateTransfer
                wallet={wallet}
                balance={balance}
                nonce={nonce}
                encryptedBalance={encryptedBalance}
                onBalanceUpdate={handleBalanceUpdate}
                onNonceUpdate={handleNonceUpdate}
                onTransactionSuccess={handleTransactionSuccess}
                isCompact={false}
              />
            </TabsContent>
          )}

          {/* Claim Tab (Private Mode) */}
          {operationMode === 'private' && (
            <TabsContent value="claim" className="tab-animated mt-0 border border-[#0000db]/40 rounded-b-lg rounded-t-none bg-background p-4">
              <ClaimTransfers
                wallet={wallet}
                onTransactionSuccess={handleTransactionSuccess}
                isPopupMode={false}
                hideBorder={true}
              />
            </TabsContent>
          )}

          {/* History Tab (Both Modes) */}
          <TabsContent value="history" className={`tab-animated mt-0 border ${operationMode === 'private' ? 'border-[#0000db]/40' : 'border-foreground/20'} rounded-b-lg rounded-t-none bg-background p-4`}>
            <UnifiedHistory 
              wallet={wallet} 
              transactions={transactions}
              onTransactionsUpdate={handleTransactionsUpdate}
              isLoading={isLoadingTransactions}
              isPopupMode={false}
              hideBorder={true}
              operationMode={operationMode}
            />
          </TabsContent>
        </Tabs>
        )}
      </main>

      {/* Fixed Bottom Footer - Popup Mode Only - visible on all screens */}
      {isPopupMode && (
        <div className="fixed bottom-0 left-0 right-0 z-[200] bg-background border-t border-border">
          {/* Network Status Footer */}
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              Mainnet
            </span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                rpcStatus === 'connected' ? 'bg-[#0000db]' : 
                rpcStatus === 'disconnected' ? 'bg-red-500' : 
                'bg-yellow-500 animate-pulse'
              }`} />
              <span className={`text-[10px] ${
                rpcStatus === 'connected' ? 'text-[#0000db]' : 
                rpcStatus === 'disconnected' ? 'text-red-500' : 
                'text-yellow-500'
              }`}>
                {rpcStatus === 'connected' ? 'Connected' : 
                 rpcStatus === 'disconnected' ? 'Disconnected' : 
                 'Connecting...'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Footer Spacer - Only for expanded mode */}
      {!isPopupMode && <div className="h-10" />}

      {/* Mode Indicator - Corner Badge - Only for expanded mode */}
      {!isPopupMode && <ModeIndicator mode={operationMode} />}

      {/* GitHub Link - Only in expanded mode */}
      {!isPopupMode && (
        <a
          href="https://github.com/m-tq/OctWa"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-10 left-4 p-2 rounded-full bg-background/80 backdrop-blur-sm border border-border/40 hover:bg-accent transition-colors z-50"
          title="View on GitHub"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-foreground"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
      )}

      {/* Footer Credit - Only for expanded mode */}
      {!isPopupMode && (
        <footer className="fixed bottom-0 left-0 right-0 py-2 text-center text-xs text-muted-foreground bg-background/80 backdrop-blur-sm border-t border-border/40">
          <span className="flex items-center justify-center gap-1">
            Made with
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 text-[#0000db]"
              fill="currentColor"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            for Octra
          </span>
        </footer>
      )}
    </div>
  );
}