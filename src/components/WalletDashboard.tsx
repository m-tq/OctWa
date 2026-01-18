import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollAreaContent } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  Download,
  Menu,
  RotateCcw,
  Eye,
  EyeOff,
  Key,
  Unlock,
  QrCode,
  ExternalLink,
  ArrowUpRight,
  ArrowDownLeft,
  Check,
  PanelLeftClose,
  PanelLeft,
  Wallet as WalletIcon,
  BookUser,
  Layers,
  FileText,
  MessageSquare,
  Coins,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ExtensionStorageManager } from '../utils/extensionStorage';
import { MultiSend } from './MultiSend';
import { SendTransaction } from './SendTransaction';
import { PrivateTransfer } from './PrivateTransfer';
import { ClaimTransfers } from './ClaimTransfers';
import { FileMultiSend } from './FileMultiSend';
import { UnifiedHistory } from './UnifiedHistory';
import { ModeToggle } from './ModeToggle';
import { resetModeSwitchReminder } from './ModeSwitchConfirmDialog';
import { ThemeToggle } from './ThemeToggle';
import { AddWalletPopup } from './AddWalletPopup';
import { RPCProviderManager } from './RPCProviderManager';
import { ConnectedDAppsManager } from './ConnectedDAppsManager';
import { ExportPrivateKeys } from './ExportPrivateKeys';
import { ReceiveDialog } from './ReceiveDialog';
import { EncryptBalanceDialog } from './EncryptBalanceDialog';
import { DecryptBalanceDialog } from './DecryptBalanceDialog';
import { AddressBook } from './AddressBook';
import { OnboardingOverlay, useOnboarding, resetOnboardingState } from './OnboardingOverlay';
import { WalletLabelEditor, WalletDisplayName } from './WalletLabelEditor';
import { DraggableWalletList } from './DraggableWalletList';
import { Wallet } from '../types/wallet';
import { WalletManager } from '../utils/walletManager';
import { fetchBalance, getTransactionHistory, fetchEncryptedBalance, fetchTransactionDetails, fetchPendingTransactionByHash, getPendingPrivateTransfers, apiCache } from '../utils/api';
import { getEVMWalletData, EVMWalletData } from '../utils/evmDerive';
import {
  getEVMBalance, DEFAULT_EVM_NETWORKS, EVMNetwork, getActiveEVMNetwork,
  setActiveEVMNetwork, checkEVMRpcStatus, getEVMRpcUrl, saveEVMProvider,
  getEVMGasPrice, getRpcDisplayName, sendEVMTransaction, getEVMTransactions, EVMTransaction,
  getETHPrice, calculateUSDValue,
} from '../utils/evmRpc';

import { useToast } from '@/hooks/use-toast';
import { OperationMode, saveOperationMode, loadOperationMode, isPrivateModeAvailable } from '../utils/modeStorage';
import { verifyPassword } from '../utils/password';
import { isPrivateTransfer } from '../utils/historyMerge';
import { useAddressBook } from '../hooks/useAddressBook';
import { addressBook } from '../utils/addressBook';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
  message?: string;
  op_type?: string;
}

interface WalletDashboardProps {
  wallet: Wallet;
  wallets: Wallet[];
  onDisconnect: () => void;
  onSwitchWallet: (wallet: Wallet) => void;
  onAddWallet: (wallet: Wallet) => void;
  onRemoveWallet: (wallet: Wallet) => void;
  onReorderWallets: (wallets: Wallet[]) => void;
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
  onReorderWallets,
  isPopupMode = false
}: WalletDashboardProps) {
  const [activeTab, setActiveTab] = useState<string>('balance');
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [walletNonces, setWalletNonces] = useState<Record<string, number | null>>({});
  const [showAddWalletDialog, setShowAddWalletDialog] = useState(false);
  const [showRPCManager, setShowRPCManager] = useState(false);
  const [showDAppsManager, setShowDAppsManager] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<Wallet | null>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [showWalletSidebar, setShowWalletSidebar] = useState(true); // Sidebar toggle for expanded mode
  const [showHistorySidebar, setShowHistorySidebar] = useState(true);
  const [bothPanelsHidden, setBothPanelsHidden] = useState(false); // Toggle for hiding both panels
  const [sidebarWidth, setSidebarWidth] = useState(310); // Default 350px
  const [isResizing, setIsResizing] = useState(false);
  const MIN_SIDEBAR_WIDTH = 310;
  const MAX_SIDEBAR_WIDTH = 450;
  const AUTO_HIDE_THRESHOLD = 200; // Auto hide when dragged below this width
  
  // History sidebar state (right side)
  const [historySidebarWidth, setHistorySidebarWidth] = useState(350);
  const [isResizingHistory, setIsResizingHistory] = useState(false);
  const MIN_HISTORY_WIDTH = 350;
  const MAX_HISTORY_WIDTH = 350;
  const AUTO_HIDE_HISTORY_THRESHOLD = 200;
  
  // Computed sidebar left position for all fixed elements
  const sidebarLeftOffset = showWalletSidebar ? `${sidebarWidth}px` : '2px';
  // Computed history sidebar right position
  const historySidebarRightOffset = showHistorySidebar ? `${historySidebarWidth}px` : '2px';
  
  // Toggle both panels function
  const toggleBothPanels = () => {
    if (bothPanelsHidden) {
      // Show both panels
      setShowWalletSidebar(true);
      setShowHistorySidebar(true);
      setBothPanelsHidden(false);
    } else {
      // Hide both panels
      setShowWalletSidebar(false);
      setShowHistorySidebar(false);
      setBothPanelsHidden(true);
    }
  };
  
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
  const [rpcStatus, setRpcStatus] = useState<'connected' | 'disconnected' | 'checking' | 'connecting'>('checking');
  const [operationMode, setOperationMode] = useState<OperationMode>('public');
  const [pendingTransfersCount, setPendingTransfersCount] = useState<number>(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isVerifyingReset, setIsVerifyingReset] = useState(false);
  const [showExportKeys, setShowExportKeys] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [showScrollUpIndicator, setShowScrollUpIndicator] = useState(false);
  // Expanded mode send modal states
  const [expandedSendModal, setExpandedSendModal] = useState<'standard' | 'multi' | 'bulk' | null>(null);
  const [sendModalAnimating, setSendModalAnimating] = useState(false);
  const [sendModalClosing, setSendModalClosing] = useState(false);
  const [bulkResetTrigger, setBulkResetTrigger] = useState(0);
  const [multiResetTrigger, setMultiResetTrigger] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  // Expanded mode encrypt/decrypt modal states (for private mode)
  const [expandedPrivateModal, setExpandedPrivateModal] = useState<'encrypt' | 'decrypt' | null>(null);
  const [privateModalAnimating, setPrivateModalAnimating] = useState(false);
  // Claim screen animation states
  const [claimAnimating, setClaimAnimating] = useState(false);
  const [claimClosing, setClaimClosing] = useState(false);
  const [privateModalClosing, setPrivateModalClosing] = useState(false);
  // Expanded mode transaction details inline screen
  const [showExpandedTxDetails, setShowExpandedTxDetails] = useState(false);
  const [txDetailsAnimating, setTxDetailsAnimating] = useState(false);
  const [txDetailsClosing, setTxDetailsClosing] = useState(false);
  const [prevHistoryWidth, setPrevHistoryWidth] = useState<number | null>(null);
  // Address Book state
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [addressBookPrefilledAddress, setAddressBookPrefilledAddress] = useState<string>('');
  // EVM Assets state
  const [showEVMAssets, setShowEVMAssets] = useState(false);
  // EVM Mode state (integrated mode, not popup)
  const [evmMode, setEvmMode] = useState(false);
  const [evmWallets, setEvmWallets] = useState<(EVMWalletData & { balance: string | null; isLoading: boolean })[]>([]);
  const [selectedEVMWallet, setSelectedEVMWallet] = useState<(EVMWalletData & { balance: string | null; isLoading: boolean }) | null>(null);
  const [evmNetwork, setEvmNetwork] = useState<EVMNetwork>(getActiveEVMNetwork());
  const [evmRpcStatus, setEvmRpcStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [evmGasPrice, setEvmGasPrice] = useState<string | null>(null);
  const [evmTransactions, setEvmTransactions] = useState<EVMTransaction[]>([]);
  const [isLoadingEvmTxs, setIsLoadingEvmTxs] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [showEvmSendDialog, setShowEvmSendDialog] = useState(false);
  const [evmSendTo, setEvmSendTo] = useState('');
  const [evmSendAmount, setEvmSendAmount] = useState('');
  const [isEvmSending, setIsEvmSending] = useState(false);
  const [evmSendError, setEvmSendError] = useState<string | null>(null);
  const [evmTxHash, setEvmTxHash] = useState<string | null>(null);
  const [showEvmRpcManager, setShowEvmRpcManager] = useState(false);
  const [evmCustomRpcUrl, setEvmCustomRpcUrl] = useState('');
  // Current epoch state
  const [currentEpoch, setCurrentEpoch] = useState<number>(0);
  const [isUpdatingEpoch, setIsUpdatingEpoch] = useState(false);
  // Track history panel state before hiding for multi/bulk send
  const [historyPanelWasOpen, setHistoryPanelWasOpen] = useState(false);
  const { autoLabelWallets, getWalletDisplayName } = useAddressBook();
  const { shouldShow: shouldShowOnboarding } = useOnboarding();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { toast } = useToast();

  // Show onboarding after dashboard loads (only once)
  useEffect(() => {
    if (shouldShowOnboarding && !isPopupMode) {
      // Small delay to let dashboard render first
      const timer = setTimeout(() => {
        setShowOnboarding(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowOnboarding, isPopupMode]);

  // Handle add to address book from AddressInput
  const handleAddToAddressBook = (address: string) => {
    setAddressBookPrefilledAddress(address);
    setShowAddressBook(true);
  };

  // Reset prefilled address when dialog closes
  useEffect(() => {
    if (!showAddressBook) {
      setAddressBookPrefilledAddress('');
    }
  }, [showAddressBook]);

  // Handle opening send modal with animation
  const openSendModal = (type: 'standard' | 'multi' | 'bulk') => {
    setSendModalAnimating(true);
    setExpandedSendModal(type);
    // Hide history panel for multi/bulk send, save previous state
    if (type === 'multi' || type === 'bulk') {
      setHistoryPanelWasOpen(showHistorySidebar);
      setShowHistorySidebar(false);
    }
    setTimeout(() => setSendModalAnimating(false), 300);
  };

  // Handle closing send modal with animation
  const closeSendModal = () => {
    setSendModalClosing(true);
    // Restore history panel if it was open before multi/bulk send
    if (expandedSendModal === 'multi' || expandedSendModal === 'bulk') {
      if (historyPanelWasOpen) {
        setShowHistorySidebar(true);
      }
    }
    setTimeout(() => {
      setExpandedSendModal(null);
      setSendModalClosing(false);
    }, 200);
  };

  // Handle opening claim screen with animation
  const openClaimScreen = () => {
    setClaimAnimating(true);
    setActiveTab('claim');
    setTimeout(() => setClaimAnimating(false), 300);
  };

  // Handle closing claim screen with animation
  const closeClaimScreen = () => {
    setClaimClosing(true);
    setTimeout(() => {
      setActiveTab('balance');
      setClaimClosing(false);
    }, 200);
  };

  // Handle opening private modal (encrypt/decrypt) with animation
  const openPrivateModal = (type: 'encrypt' | 'decrypt') => {
    setPrivateModalAnimating(true);
    setExpandedPrivateModal(type);
    setTimeout(() => setPrivateModalAnimating(false), 300);
  };

  // Handle closing private modal with animation
  const closePrivateModal = () => {
    setPrivateModalClosing(true);
    setTimeout(() => {
      setExpandedPrivateModal(null);
      setPrivateModalClosing(false);
    }, 200);
  };

  // Auto-label wallets on mount and when wallets change
  useEffect(() => {
    if (wallets.length > 0) {
      autoLabelWallets(wallets.map(w => ({ address: w.address, type: w.type })));
    }
  }, [wallets, autoLabelWallets]);

  // Handle sidebar resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      if (newWidth < AUTO_HIDE_THRESHOLD) {
        // Auto hide when dragged too far left
        setShowWalletSidebar(false);
        setSidebarWidth(MIN_SIDEBAR_WIDTH);
        setIsResizing(false);
      } else if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Handle history sidebar resize (right side)
  useEffect(() => {
    if (!isResizingHistory) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth < AUTO_HIDE_HISTORY_THRESHOLD) {
        // Auto hide when dragged too far right
        setShowHistorySidebar(false);
        setHistorySidebarWidth(MIN_HISTORY_WIDTH);
        setIsResizingHistory(false);
      } else if (newWidth >= MIN_HISTORY_WIDTH && newWidth <= MAX_HISTORY_WIDTH) {
        setHistorySidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingHistory(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingHistory]);

  // Determine if private mode is available (encrypted balance > 0 OR pending transfers > 0)
  const privateEnabled = isPrivateModeAvailable(encryptedBalance?.encrypted || 0, pendingTransfersCount);

  // Handle mode change
  const handleModeChange = (mode: OperationMode) => {
    setOperationMode(mode);
    saveOperationMode(mode);
    setActiveTab('balance'); // Reset to balance tab when switching modes
    // Refresh session timeout on user activity
    WalletManager.refreshSessionTimeout();
  };

  // Fetch pending transfers count for private mode availability check
  useEffect(() => {
    const fetchPendingCount = async () => {
      if (!wallet?.address || !wallet?.privateKey) return;
      try {
        const pending = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
        setPendingTransfersCount(pending.length);
      } catch (error) {
        console.error('Failed to fetch pending transfers count:', error);
        setPendingTransfersCount(0);
      }
    };
    fetchPendingCount();
  }, [wallet?.address, wallet?.privateKey]);

  // Load operation mode on mount and when encrypted balance or pending transfers change
  useEffect(() => {
    const encBalance = encryptedBalance?.encrypted || 0;
    const savedMode = loadOperationMode(encBalance, pendingTransfersCount);
    setOperationMode(savedMode);
  }, [encryptedBalance, pendingTransfersCount]);

  // Close private modal when wallet changes or when conditions are not met
  useEffect(() => {
    if (expandedPrivateModal) {
      // Close decrypt modal if no encrypted balance
      if (expandedPrivateModal === 'decrypt' && (!encryptedBalance || encryptedBalance.encrypted <= 0)) {
        setExpandedPrivateModal(null);
      }
      // Close encrypt modal if no public balance
      if (expandedPrivateModal === 'encrypt' && (!balance || balance <= 0.001)) {
        setExpandedPrivateModal(null);
      }
    }
  }, [wallet?.address, encryptedBalance, balance, expandedPrivateModal]);

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

  // Check RPC status with shared cache (prevents duplicate fetching between popup/expanded)
  const [activeNetwork, setActiveNetwork] = useState<string>('mainnet');
  
  useEffect(() => {
    // Import dynamically to avoid circular deps
    const initRPCStatus = async () => {
      const { checkRPCStatus, onRPCStatusChange, getActiveRPCProvider } = await import('../utils/rpcStatus');
      
      // Get initial status (uses cache if available)
      const status = await checkRPCStatus();
      setRpcStatus(status.status);
      setActiveNetwork(status.network);
      
      // Listen for status changes from other contexts (popup <-> expanded)
      const unsubscribe = onRPCStatusChange((data) => {
        console.log('📡 RPC status updated from other context:', data.status, data.network);
        setRpcStatus(data.status);
        setActiveNetwork(data.network);
      });
      
      // Check every 3 minutes (force refresh) when connected
      const interval = setInterval(async () => {
        const freshStatus = await checkRPCStatus(true);
        setRpcStatus(freshStatus.status);
        setActiveNetwork(freshStatus.network);
      }, 3 * 60 * 1000);
      
      // Auto-retry every 7 seconds when disconnected
      let retryInterval: ReturnType<typeof setInterval> | null = null;
      
      const startRetryLoop = () => {
        if (retryInterval) return; // Already running
        console.log('🔄 Starting auto-retry for RPC connection...');
        retryInterval = setInterval(async () => {
          console.log('🔄 Retrying RPC connection...');
          const freshStatus = await checkRPCStatus(true);
          setRpcStatus(freshStatus.status);
          setActiveNetwork(freshStatus.network);
          
          if (freshStatus.status === 'connected') {
            console.log('✅ RPC reconnected, stopping retry loop');
            if (retryInterval) {
              clearInterval(retryInterval);
              retryInterval = null;
            }
          }
        }, 7000);
      };
      
      const stopRetryLoop = () => {
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
      };
      
      // Start retry loop if initially disconnected
      if (status.status === 'disconnected') {
        startRetryLoop();
      }
      
      // Listen for status changes to start/stop retry loop
      const unsubscribeRetry = onRPCStatusChange((data) => {
        if (data.status === 'disconnected') {
          startRetryLoop();
        } else if (data.status === 'connected') {
          stopRetryLoop();
        }
      });
      
      return () => {
        unsubscribe();
        unsubscribeRetry();
        clearInterval(interval);
        stopRetryLoop();
      };
    };
    
    let cleanup: (() => void) | undefined;
    initRPCStatus().then(fn => { cleanup = fn; });
    
    return () => { cleanup?.(); };
  }, []);

  // Epoch-based auto-refresh: Poll for epoch changes and refresh data when epoch changes
  useEffect(() => {
    if (!wallet) return;

    // Subscribe to epoch changes
    const unsubscribe = apiCache.onEpochChange(async (newEpoch, oldEpoch) => {
      console.log(
        `🔄 Epoch changed (${oldEpoch} → ${newEpoch}), updating all wallets...`
      );

      // Show updating indicator
      setIsUpdatingEpoch(true);

      try {
        // 1. Update ALL wallets cache in parallel (wait for completion)
        console.log(`📍 Updating ${wallets.length} wallet(s) cache...`);
        
        await Promise.all(
          wallets.map(async (w) => {
            try {
              await fetchBalance(w.address, true);
              await fetchEncryptedBalance(w.address, w.privateKey, true);
              await getTransactionHistory(w.address, {}, true);
              await getPendingPrivateTransfers(w.address, w.privateKey, true);
              console.log(`✓ Cache updated for ${w.address.slice(0, 10)}...`);
            } catch (error) {
              console.error(`✗ Cache update failed for ${w.address.slice(0, 10)}...`, error);
            }
          })
        );
        
        console.log('✅ All wallet caches updated');

        // 2. Reload UI for active wallet from fresh cache
        // Update history FIRST (most visible to user for pending->confirmed status)
        console.log(`🔄 Reloading UI for active wallet...`);
        
        // 1. Fetch fresh transaction history FIRST
        const result = await getTransactionHistory(wallet.address);
        if (Array.isArray(result.transactions)) {
          console.log(
            `📜 Updating transactions: ${transactions.length} → ${result.transactions.length}`
          );
          const transformedTxs = result.transactions.map((tx) => ({
            ...tx,
            type:
              tx.from?.toLowerCase() === wallet.address.toLowerCase()
                ? 'sent'
                : 'received',
          })) as Transaction[];
          setTransactions(transformedTxs);
        }

        // 2. Update balance and nonce
        const balanceData = await fetchBalance(wallet.address);
        console.log(
          `💰 Balance: ${balance} → ${balanceData.balance}, nonce: ${nonce} → ${balanceData.nonce}`
        );
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);

        // 3. Update encrypted balance
        const encData = await fetchEncryptedBalance(
          wallet.address,
          wallet.privateKey
        );
        if (encData) {
          console.log(
            `🔐 Encrypted balance: ${encryptedBalance?.encrypted || 0} → ${encData.encrypted}`
          );
          setEncryptedBalance(encData);
        }

        // 4. Fetch pending transfers count LAST
        const pending = await getPendingPrivateTransfers(
          wallet.address,
          wallet.privateKey
        );
        console.log(
          `🎁 Pending transfers: ${pendingTransfersCount} → ${pending.length}`
        );
        setPendingTransfersCount(pending.length);

        console.log('✅ UI reload complete');
      } catch (error) {
        console.error('Failed to check data after epoch change:', error);
      } finally {
        // Update epoch and hide updating indicator
        setCurrentEpoch(newEpoch);
        setIsUpdatingEpoch(false);
      }
    });

    // Poll for epoch changes every 10 seconds
    const epochPollInterval = setInterval(async () => {
      try {
        await apiCache.checkEpochChange();
        // Also update current epoch state
        setCurrentEpoch(apiCache.getCachedEpoch());
      } catch (error) {
        console.error('Epoch check failed:', error);
      }
    }, 10000);

    // Initialize current epoch on mount
    setCurrentEpoch(apiCache.getCachedEpoch());

    return () => {
      unsubscribe();
      clearInterval(epochPollInterval);
    };
  }, [
    wallet?.address,
    wallet?.privateKey,
    balance,
    nonce,
    encryptedBalance,
    transactions,
    pendingTransfersCount,
    wallets,
  ]);

  // Initial data fetch when wallet is connected
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!wallet) return;

      // Reset encrypted balance and mode to public when wallet changes
      // This ensures new/switched wallets start in public mode
      setEncryptedBalance(null);
      setOperationMode('public');
      
      // Reset transaction details view when wallet changes
      setShowExpandedTxDetails(false);
      setSelectedTxHash(null);
      setSelectedTxDetails(null);

      try {
        // Fetch balance and nonce (from cache, which is updated on epoch change)
        setIsLoadingBalance(true);
        const balanceData = await fetchBalance(wallet.address);
        setBalance(balanceData.balance);
        setNonce(balanceData.nonce);
        
        // Fetch encrypted balance for the new wallet
        try {
          const encData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
          if (encData) {
            setEncryptedBalance(encData);
            // Load operation mode based on encrypted balance
            const savedMode = loadOperationMode(encData.encrypted || 0, pendingTransfersCount);
            setOperationMode(savedMode);
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
        // Fetch transaction history (from cache, which is updated on epoch change)
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
      
      // Fetch pending transfers count
      try {
        const pending = await getPendingPrivateTransfers(wallet.address, wallet.privateKey);
        setPendingTransfersCount(pending.length);
      } catch (error) {
        console.error('Failed to fetch pending transfers:', error);
        setPendingTransfersCount(0);
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

  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Copy failed",
        variant: "destructive",
      });
    }
  };

  // ============================================
  // EVM MODE FUNCTIONS
  // ============================================

  // Initialize EVM wallets when entering EVM mode
  const initializeEvmMode = async () => {
    const derived = wallets.map((w) => {
      const evmData = getEVMWalletData(w.address, w.privateKey);
      return { ...evmData, balance: null, isLoading: false };
    });
    setEvmWallets(derived);
    
    const activeEVM = derived.find((e) => e.octraAddress === wallet.address);
    setSelectedEVMWallet(activeEVM || derived[0] || null);
    
    // Check RPC status
    setEvmRpcStatus('checking');
    try {
      const isConnected = await checkEVMRpcStatus(evmNetwork.id);
      setEvmRpcStatus(isConnected ? 'connected' : 'disconnected');
      if (isConnected) {
        const price = await getEVMGasPrice(evmNetwork.id);
        setEvmGasPrice(price);
      }
    } catch {
      setEvmRpcStatus('disconnected');
    }
    
    // Fetch ETH price
    getETHPrice().then(setEthPrice);
  };

  // Enter EVM mode
  const enterEvmMode = async () => {
    setEvmMode(true);
    await initializeEvmMode();
  };

  // Exit EVM mode
  const exitEvmMode = () => {
    setEvmMode(false);
    setEvmWallets([]);
    setSelectedEVMWallet(null);
    setEvmTransactions([]);
  };

  // Fetch EVM wallet balance
  const fetchEvmBalance = async () => {
    if (!selectedEVMWallet || evmRpcStatus !== 'connected') return;
    
    setEvmWallets((prev) => prev.map((w) => 
      w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, isLoading: true } : w
    ));
    setSelectedEVMWallet((prev) => (prev ? { ...prev, isLoading: true } : null));
    
    try {
      const balance = await getEVMBalance(selectedEVMWallet.evmAddress, evmNetwork.id);
      setEvmWallets((prev) => prev.map((w) => 
        w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, balance, isLoading: false } : w
      ));
      setSelectedEVMWallet((prev) => (prev ? { ...prev, balance, isLoading: false } : null));
    } catch {
      setEvmWallets((prev) => prev.map((w) => 
        w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, balance: '0.000000', isLoading: false } : w
      ));
      setSelectedEVMWallet((prev) => (prev ? { ...prev, balance: '0.000000', isLoading: false } : null));
    }
  };

  // Fetch EVM transactions
  const fetchEvmTransactions = async () => {
    if (!selectedEVMWallet) return;
    setIsLoadingEvmTxs(true);
    try {
      const txs = await getEVMTransactions(selectedEVMWallet.evmAddress, evmNetwork.id);
      setEvmTransactions(txs);
    } catch (error) {
      console.error('Failed to fetch EVM transactions:', error);
      setEvmTransactions([]);
    } finally {
      setIsLoadingEvmTxs(false);
    }
  };

  // Handle EVM wallet selection
  const handleSelectEvmWallet = (evmWallet: typeof selectedEVMWallet) => {
    if (!evmWallet) return;
    setSelectedEVMWallet(evmWallet);
    setEvmTransactions([]);
    const octraWallet = wallets.find((w) => w.address === evmWallet.octraAddress);
    if (octraWallet) onSwitchWallet(octraWallet);
  };

  // Handle EVM network change
  const handleEvmNetworkChange = (networkId: string) => {
    const network = DEFAULT_EVM_NETWORKS.find((n) => n.id === networkId);
    if (network) {
      setEvmNetwork(network);
      setActiveEVMNetwork(networkId);
      setEvmWallets((prev) => prev.map((w) => ({ ...w, balance: null, isLoading: false })));
      if (selectedEVMWallet) setSelectedEVMWallet({ ...selectedEVMWallet, balance: null, isLoading: false });
    }
  };

  // Handle EVM send transaction
  const handleEvmSendTransaction = async () => {
    if (!selectedEVMWallet || !evmSendTo || !evmSendAmount) {
      setEvmSendError('Please fill all fields');
      return;
    }
    setEvmSendError(null);
    setIsEvmSending(true);
    setEvmTxHash(null);
    try {
      const hash = await sendEVMTransaction(selectedEVMWallet.privateKeyHex, evmSendTo, evmSendAmount, evmNetwork.id);
      setEvmTxHash(hash);
      toast({ title: 'Success!', description: 'Transaction sent successfully' });
      setEvmSendTo('');
      setEvmSendAmount('');
      await fetchEvmBalance();
      await fetchEvmTransactions();
    } catch (error: any) {
      setEvmSendError(error.message || 'Transaction failed');
      toast({ title: 'Error', description: error.message || 'Transaction failed', variant: 'destructive' });
    } finally {
      setIsEvmSending(false);
    }
  };

  // Save custom EVM RPC
  const handleSaveEvmCustomRpc = () => {
    if (evmCustomRpcUrl.trim()) {
      saveEVMProvider(evmNetwork.id, evmCustomRpcUrl.trim());
      setShowEvmRpcManager(false);
      setEvmCustomRpcUrl('');
      // Re-check RPC status
      initializeEvmMode();
      toast({ title: 'Saved', description: 'Custom RPC URL saved' });
    }
  };

  // Effect: Fetch EVM data when wallet changes in EVM mode
  useEffect(() => {
    if (!evmMode || !selectedEVMWallet) return;
    if (evmRpcStatus === 'connected') {
      fetchEvmBalance();
    }
    fetchEvmTransactions();
  }, [evmMode, selectedEVMWallet?.evmAddress, evmNetwork.id]);

  // Effect: Fetch balance when RPC becomes connected
  useEffect(() => {
    if (!evmMode || !selectedEVMWallet) return;
    if (evmRpcStatus === 'connected' && selectedEVMWallet.balance === null) {
      fetchEvmBalance();
    }
  }, [evmRpcStatus]);

  // ============================================
  // END EVM MODE FUNCTIONS
  // ============================================

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
      localStorage.removeItem('walletOperationMode');
      localStorage.removeItem('walletRateLimitState');
      localStorage.removeItem('walletCapabilities');

      // Clear address book data
      await addressBook.clearAll();

      // Reset mode switch reminder preference
      resetModeSwitchReminder();

      // Reset onboarding state
      resetOnboardingState();

      // Clear API cache from chrome.storage
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          await chrome.storage.local.remove('octwa_api_cache');
        } catch (e) {
          console.error('Failed to clear API cache:', e);
        }
      }

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
    
    // Remove wallet label from address book
    try {
      await addressBook.removeWalletLabel(addressToDelete);
    } catch (error) {
      console.error('Failed to remove wallet label from address book:', error);
    }
    
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
    return `${address.slice(0, 8)}...${address.slice(-5)}`;
  };

  // Handler for viewing transaction details
  const handleViewTxDetails = async (txHash: string, isPending: boolean = false) => {
    setSelectedTxHash(txHash);
    setLoadingTxDetails(true);
    
    // For popup mode, use fullscreen; for expanded mode, use inline screen
    if (isPopupMode) {
      setPopupScreen('txDetail');
    } else {
      // Add animation when opening
      setTxDetailsAnimating(true);
      setShowExpandedTxDetails(true);
      // Expand sidebar to MAX_HISTORY_WIDTH for better details view
      if (historySidebarWidth < MAX_HISTORY_WIDTH) {
        setPrevHistoryWidth(historySidebarWidth);
        setHistorySidebarWidth(MAX_HISTORY_WIDTH);
      }
      setTimeout(() => setTxDetailsAnimating(false), 300);
    }
    
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

  // Close expanded transaction details with animation
  const closeExpandedTxDetails = () => {
    setTxDetailsClosing(true);
    // Restore previous sidebar width if it was expanded
    if (prevHistoryWidth !== null) {
      setHistorySidebarWidth(prevHistoryWidth);
      setPrevHistoryWidth(null);
    }
    setTimeout(() => {
      setShowExpandedTxDetails(false);
      setSelectedTxHash(null);
      setSelectedTxDetails(null);
      setTxDetailsClosing(false);
    }, 200);
  };

  return (
    <div className="h-screen overflow-hidden transition-all duration-300">
      {/* Onboarding Overlay - shows only once after first wallet setup */}
      {showOnboarding && !isPopupMode && (
        <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
      )}

      {/* ============================================ */}
      {/* POPUP MODE - NEW FULLSCREEN UI */}
      {/* ============================================ */}
      {isPopupMode && popupScreen !== 'main' && (
        <div className="fixed inset-[1px] z-[100] bg-background flex flex-col">
          {/* Fullscreen Encrypt */}
          {popupScreen === 'encrypt' && (
            <div className="flex flex-col h-full pb-10">
              <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  <h2 className="font-semibold text-sm">Encrypt OCT</h2>
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
                <div className="flex items-center gap-2 text-[#0000db]">
                  <Unlock className="h-5 w-5" />
                  <h2 className="font-semibold text-sm">Decrypt OCT</h2>
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
                <div className={`flex items-center gap-2 ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                  <Send className="h-5 w-5" />
                  <h2 className="font-semibold text-sm">
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
                      onAddToAddressBook={handleAddToAddressBook}
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
                      onAddToAddressBook={handleAddToAddressBook}
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
              <div className="flex items-center gap-3 px-4 py-2 border-b">
                <Button variant="ghost" size="sm" onClick={() => setPopupScreen('main')} className="h-8 w-8 p-0">
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </Button>
                <div className="flex items-center gap-2 text-[#0000db]">
                  <Gift className="h-5 w-5" />
                  <h2 className="font-semibold text-sm">Claim Transfers</h2>
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
                  <h2 className="font-semibold">Transaction Details</h2>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {loadingTxDetails ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                  </div>
                ) : selectedTxDetails ? (
                  <>
                  <div className="divide-y divide-dashed divide-border">
                    {/* Status with Epoch */}
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Status</span>
                      {'stage_status' in selectedTxDetails ? (
                        <Badge variant="secondary" className="text-[10px] bg-yellow-500/20 text-yellow-600 h-5">
                          {selectedTxDetails.stage_status || 'pending'}
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] bg-[#0000db]/20 text-[#0000db] h-5">
                            confirmed
                          </Badge>
                          {'epoch' in selectedTxDetails && (
                            <span className="text-[10px] text-muted-foreground font-mono">#{selectedTxDetails.epoch}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Time */}
                    {('timestamp' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="py-2 flex items-center justify-between">
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
                    <div className="py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Hash</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-5 w-5 p-0" 
                          onClick={() => copyToClipboard('hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash, 'txHash')}
                        >
                          {copiedField === 'txHash' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                      <p className="font-mono text-[10px] break-all">
                        {'hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash}
                      </p>
                    </div>

                    {/* From - full address */}
                    {('from' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">From</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-5 w-5 p-0" 
                            onClick={() => copyToClipboard('from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from, 'txFrom')}
                          >
                            {copiedField === 'txFrom' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                        <p className="font-mono text-xs break-all">
                          {'from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from}
                        </p>
                      </div>
                    )}

                    {/* To - full address */}
                    {('to' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                      <div className="py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">To</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-5 w-5 p-0" 
                            onClick={() => copyToClipboard('to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to, 'txTo')}
                          >
                            {copiedField === 'txTo' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                        <p className="font-mono text-xs break-all">
                          {'to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to}
                        </p>
                      </div>
                    )}

                    {/* Amount, OU (Gas), Nonce */}
                    <div className="grid grid-cols-3 gap-0 py-2">
                      {('amount' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                        <div className="pr-2">
                          <span className="text-[10px] text-muted-foreground">Amount</span>
                          <p className="font-mono text-xs mt-0.5">
                            {'amount' in selectedTxDetails ? selectedTxDetails.amount : selectedTxDetails.parsed_tx.amount} OCT
                          </p>
                        </div>
                      )}
                      {('ou' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (() => {
                        const ouValue = 'ou' in selectedTxDetails ? selectedTxDetails.ou : selectedTxDetails.parsed_tx.ou;
                        const ouNum = parseInt(ouValue) || 0;
                        const feeOct = (ouNum * 0.0000001).toFixed(7);
                        return (
                          <div className="px-2">
                            <span className="text-[10px] text-muted-foreground">OU (Gas)</span>
                            <p className="font-mono text-[10px] mt-0.5">{ouValue}</p>
                            <p className="text-[9px] text-muted-foreground">≈ {feeOct} OCT</p>
                          </div>
                        );
                      })()}
                      {('nonce' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                        <div className="pl-2">
                          <span className="text-[10px] text-muted-foreground">Nonce</span>
                          <p className="font-mono text-xs mt-0.5">
                            {'nonce' in selectedTxDetails ? selectedTxDetails.nonce : selectedTxDetails.parsed_tx.nonce}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Message */}
                    {(('message' in selectedTxDetails && selectedTxDetails.message) || 
                      ('parsed_tx' in selectedTxDetails && selectedTxDetails.parsed_tx.message)) && (
                      <div className="py-2">
                        <span className="text-[10px] text-muted-foreground">Message</span>
                        <p className="text-[10px] mt-0.5 break-all">
                          {'message' in selectedTxDetails ? selectedTxDetails.message : selectedTxDetails.parsed_tx.message}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* View on Explorer - outside divide container */}
                  <div className="pt-4 mt-4 border-t border-dashed border-x-0 border-b-0 border-border">
                    <Button
                      variant="ghost"
                      className="w-full h-10"
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
                </>
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
        <div className={`w-full ${isPopupMode ? 'px-3' : 'px-6'}`}>
          <div className={`flex items-center justify-between ${isPopupMode ? 'py-1' : 'py-2'}`}>
            <div className="flex items-center space-x-4">
              <div className={`flex ${isPopupMode ? 'items-center space-x-2' : 'items-center space-x-3'}`}>
                <Avatar className={`${isPopupMode ? 'h-6 w-6' : 'h-10 w-10'} flex-shrink-0`}>
                  <img 
                    src={isPopupMode ? "/icons/octwa32x32.png" : "/icons/octwa48x48.png"}
                    alt="OctWa Logo" 
                    className="h-full w-full object-contain"
                    style={evmMode ? { filter: 'sepia(1) saturate(2) hue-rotate(-5deg) brightness(1.1)' } : undefined}
                  />
                </Avatar>
                <div className={`flex flex-col ${!isPopupMode && showWalletSidebar ? 'justify-center' : ''}`}>
                  <div className="flex items-center gap-2">
                    <h1 className={`${isPopupMode ? 'text-sm' : 'text-xl'} font-semibold text-foreground`}>
                      {__APP_TITLE__}
                    </h1>
                    {/* EVM Mode Badge */}
                    {!isPopupMode && evmMode && (
                      <Badge className="text-xs px-2 py-0.5 bg-orange-500 text-white">
                        EVM Mode
                      </Badge>
                    )}
                    {/* Mode Badge - Only show when inline modal is open, except for decrypt (has corner badge) */}
                    {!isPopupMode && !evmMode && (expandedSendModal || expandedPrivateModal === 'encrypt') && (
                      <Badge 
                        className={`text-xs px-2 py-0.5 pointer-events-none ${
                          operationMode === 'private' 
                            ? 'bg-[#0000db] text-white' 
                            : 'bg-foreground/10 text-foreground border border-foreground/20'
                        }`}
                      >
                        {operationMode === 'private' ? 'Private' : 'Public'}
                      </Badge>
                    )}
                  </div>
                  {/* Address row - with transition for height */}
                  <div className={`overflow-hidden transition-all duration-300 ${
                    isPopupMode || !showWalletSidebar ? 'max-h-8 opacity-100 mt-0.5' : 'max-h-0 opacity-0'
                  }`}>
                    <div className="flex items-center space-x-2">
                      {/* Wallet Selector - Sheet for popup mode, Dropdown for expanded */}
                      {isPopupMode ? (
                        <>
                          <Sheet open={showWalletSelector} onOpenChange={setShowWalletSelector}>
                            <SheetTrigger asChild>
                              <Button variant="ghost" className="h-auto p-0 hover:bg-transparent">
                                <div className="flex items-center space-x-1">
                                  <p className="text-xs text-[#0000db] font-medium">
                                    {truncateAddress(wallet.address)}
                                  </p>
                                  <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                </div>
                              </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-80 flex flex-col pb-14 px-0">
                              <SheetHeader className="px-4">
                                <SheetTitle className="text-sm flex items-center gap-2">
                                  <WalletIcon className="h-4 w-4" />
                                  Wallets ({wallets.length})
                                </SheetTitle>
                                <SheetDescription className="sr-only">Choose a wallet from your list</SheetDescription>
                              </SheetHeader>
                              <div className="flex-1 mt-3 overflow-hidden">
                                <ScrollArea className="h-full max-h-[calc(100vh-200px)]" stabilizeGutter>
                                  <ScrollAreaContent>
                                    <DraggableWalletList
                                      wallets={wallets}
                                      activeWallet={wallet}
                                      nonce={nonce}
                                      walletNonces={walletNonces}
                                      setWalletNonces={setWalletNonces}
                                      onSwitchWallet={onSwitchWallet}
                                      onCopyAddress={copyToClipboard}
                                      onDeleteWallet={setWalletToDelete}
                                      onReorderWallets={onReorderWallets}
                                      copiedField={copiedField}
                                      isPopupMode={true}
                                      closeSelector={() => setShowWalletSelector(false)}
                                    />
                                  </ScrollAreaContent>
                              </ScrollArea>
                            </div>
                            <div className="mt-3 flex-shrink-0 px-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setShowAddWalletDialog(true);
                                  setShowWalletSelector(false);
                                }}
                                className="w-full justify-center gap-1.5 text-xs"
                              >
                                <Plus className="h-3 w-3" />
                                Add Wallet
                              </Button>
                            </div>
                          </SheetContent>
                        </Sheet>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 hover:bg-transparent"
                            onClick={() => copyToClipboard(wallet.address, 'headerAddress')}
                          >
                            {copiedField === 'headerAddress' ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            )}
                          </Button>
                        </>
                      ) : (
                        /* Expanded mode - show label + address only when wallet sidebar is hidden */
                        <>
                          <p className={`text-sm font-medium whitespace-nowrap ${evmMode ? 'text-orange-600 dark:text-orange-400' : 'text-[#0000db]'}`}>
                            {evmMode && selectedEVMWallet 
                              ? `${getWalletDisplayName(selectedEVMWallet.octraAddress)} - ${selectedEVMWallet.evmAddress.slice(0, 10)}...${selectedEVMWallet.evmAddress.slice(-6)}`
                              : `${getWalletDisplayName(wallet.address)} - ${truncateAddress(wallet.address)}`
                            }
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(evmMode && selectedEVMWallet ? selectedEVMWallet.evmAddress : wallet.address, 'headerAddress')}
                            className="h-6 w-6 p-0 flex-shrink-0"
                          >
                            {copiedField === 'headerAddress' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowReceiveDialog(true)}
                            className="h-6 w-6 p-0 flex-shrink-0"
                            title="Show QR Code"
                          >
                            <QrCode className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* Hide badges in popup mode to save space - Nonce moved to sidebar */}
            </div>

            <div className={`flex items-center ${isPopupMode ? 'space-x-1' : 'space-x-2'}`}>
              {isPopupMode ? (
                // Popup mode - Compact layout
                <>
                  <ThemeToggle isPopupMode={true} />
                  {/* Mobile Hamburger Menu with expanded functionality */}
                  <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                        <Menu className="h-3.5 w-3.5" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-72 pb-14 flex flex-col">
                      <SheetHeader className="mt-2">
                        <SheetTitle className="text-sm">Wallet Menu</SheetTitle>
                        <SheetDescription className="sr-only">Wallet settings and actions</SheetDescription>
                      </SheetHeader>
                      <div className="flex-1 flex flex-col justify-center space-y-3">
                        {/* Expand View Button */}
                        {typeof chrome !== 'undefined' && chrome.tabs && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              chrome.tabs.create({
                                url: chrome.runtime.getURL('index.html')
                              });
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-1.5 text-xs h-10"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                            Expand View
                          </Button>
                        )}

                        {/* RPC Provider */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowRPCManager(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10"
                        >
                          <Wifi className="h-3.5 w-3.5" />
                          RPC Provider
                        </Button>

                        {/* Connected dApps */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowDAppsManager(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          Connected dApps
                        </Button>

                        {/* Address Book */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowAddressBook(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10"
                        >
                          <BookUser className="h-3.5 w-3.5" />
                          Address Book
                        </Button>

                        {/* Export Private Keys */}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setShowExportKeys(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10"
                        >
                          <Key className="h-3.5 w-3.5" />
                          Export Private Keys
                        </Button>

                        {/* Lock Wallet */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowLockConfirm(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10 text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 border-orange-600 hover:border-orange-700 dark:border-orange-400 dark:hover:border-orange-300"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Lock Wallet
                        </Button>

                        {/* Reset All */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowResetConfirm(true);
                            setShowMobileMenu(false);
                          }}
                          className="w-full justify-start gap-1.5 text-xs h-10 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-500 hover:border-red-700 dark:border-red-400 dark:hover:border-red-300"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset All
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                </>
              ) : (
                // Expanded mode - Full layout
                <>
                  {/* EVM Mode Header Controls */}
                  {evmMode ? (
                    <>
                      <ThemeToggle isPopupMode={false} className="h-9 w-9" />
                      <div className="flex items-center gap-2">
                        <select
                          value={evmNetwork.id}
                          onChange={(e) => handleEvmNetworkChange(e.target.value)}
                          className="h-9 px-3 pr-8 text-xs bg-background rounded-md text-orange-600 dark:text-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23f97316%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat hover:bg-orange-500/10"
                        >
                          {DEFAULT_EVM_NETWORKS.map((network) => (
                            <option key={network.id} value={network.id}>
                              {network.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowEvmRpcManager(true)}
                          className="h-9 text-xs text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
                        >
                          <Wifi className="h-3.5 w-3.5 mr-1.5" />
                          RPC
                        </Button>
                      </div>
                      {/* Dashed separator */}
                      <div className="h-5 border-l border-dashed border-border mx-1" />
                      {/* Exit EVM Mode Button - Red color */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={exitEvmMode}
                        className="h-9 px-4 text-red-500 hover:text-red-600 hover:bg-red-500/10 font-medium"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Exit EVM Mode
                      </Button>
                    </>
                  ) : (
                    <>
                      <ThemeToggle isPopupMode={false} />
                      {/* Desktop Menu Items - Hidden in EVM mode */}
                      <div className="hidden lg:flex items-center space-x-2">
                        {/* Buttons with caption: RPC, dApps, Address Book */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowRPCManager(true)}
                          className="flex items-center gap-2"
                        >
                          <Wifi className="h-4 w-4" />
                          RPC
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDAppsManager(true)}
                          className="flex items-center gap-2"
                        >
                          <Globe className="h-4 w-4" />
                          dApps
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAddressBook(true)}
                          className="flex items-center gap-2"
                        >
                          <BookUser className="h-4 w-4" />
                          Address Book
                        </Button>
                        
                        {/* Text buttons: Export Private Keys, Lock Wallet, Reset All */}
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-2"
                          onClick={() => setShowExportKeys(true)}
                        >
                          <Key className="h-4 w-4" />
                          Export Keys
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 flex items-center gap-2"
                          onClick={() => setShowLockConfirm(true)}
                        >
                          <Lock className="h-4 w-4" />
                          Lock
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowResetConfirm(true)}
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-2"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reset
                        </Button>
                      </div>

                      {/* Mobile/Tablet Hamburger Menu */}
                      <div className="lg:hidden">
                        <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                          <SheetTrigger asChild>
                            <Button variant="ghost" size="sm">
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

                          {/* Address Book */}
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowAddressBook(true);
                              setShowMobileMenu(false);
                            }}
                            className="w-full justify-start gap-2"
                          >
                            <BookUser className="h-4 w-4" />
                            Address Book
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

              {/* Address Book Dialog */}
              <Dialog open={showAddressBook} onOpenChange={setShowAddressBook}>
                <DialogContent className={isPopupMode ? "w-[360px] max-h-[520px] overflow-hidden p-3" : "sm:max-w-lg max-h-[80vh] overflow-hidden"}>
                  <DialogHeader className={isPopupMode ? "pb-1.5" : ""}>
                    <DialogTitle className={isPopupMode ? "text-xs" : ""}>Address Book</DialogTitle>
                    <DialogDescription className={isPopupMode ? "sr-only" : ""}>
                      Manage your reusable recipients. All data is stored locally and privately.
                    </DialogDescription>
                  </DialogHeader>
                  <AddressBook 
                    isPopupMode={isPopupMode}
                    currentMode={operationMode}
                    prefilledAddress={addressBookPrefilledAddress}
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

              {/* Receive QR Dialog for expanded mode */}
              {!isPopupMode && (
                <ReceiveDialog
                  wallet={wallet}
                  open={showReceiveDialog}
                  onOpenChange={setShowReceiveDialog}
                  isPopupMode={false}
                  isFullscreen={false}
                  customAddress={evmMode && selectedEVMWallet ? selectedEVMWallet.evmAddress : undefined}
                  customTitle={evmMode ? `Receive ${evmNetwork.symbol}` : undefined}
                  customInfo={evmMode ? `Share this address to receive ${evmNetwork.symbol} tokens on ${evmNetwork.name}. Only send ${evmNetwork.symbol} to this address.` : undefined}
                />
              )}
              
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
                          <li>Address book</li>
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
        <div 
          className={`fixed z-40 bg-background/95 backdrop-blur-sm py-3 transition-all ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out`}
          style={{ 
            left: sidebarLeftOffset, 
            right: historySidebarRightOffset,
            top: showWalletSidebar ? '49px' : '69px'
          }}
        >
          <div className="px-6 py-6 sm:px-8 lg:px-12">
            {/* Hide ModeToggle when in EVM mode */}
            {!evmMode && (
              <ModeToggle
                currentMode={operationMode}
                onModeChange={handleModeChange}
                privateEnabled={privateEnabled}
                encryptedBalance={encryptedBalance?.encrypted || 0}
                pendingTransfersCount={pendingTransfersCount}
                isCompact={false}
              />
            )}
          </div>
        </div>
      )}

      {/* Wallet Sidebar - Only for expanded mode */}
      {!isPopupMode && (
        <>
          <aside 
            className={`fixed left-0 bottom-0 z-30 bg-background border-r border-border transition-all ${isResizing ? 'duration-0' : 'duration-300'} ${showWalletSidebar ? '' : 'w-0'} overflow-hidden`}
            style={{ 
              width: showWalletSidebar ? `${sidebarWidth}px` : '0px',
              top: showWalletSidebar ? '49px' : '69px'
            }}
          >
            <div className="h-full flex flex-col pt-4 pb-4 pl-4 pr-3" style={{ width: `${sidebarWidth - 8}px` }}>
              {/* EVM Mode Sidebar Content */}
              {evmMode ? (
                <>
                  <div className="flex items-center justify-between mb-4 mt-2">
                    <h3 className="font-semibold text-base flex items-center gap-2 text-orange-600 dark:text-orange-400">
                      <Coins className="h-5 w-5" />
                      EVM Wallets ({evmWallets.length})
                    </h3>
                  </div>
                  <ScrollArea className="flex-1 -ml-4 -mr-3" stabilizeGutter>
                    <ScrollAreaContent className="space-y-0">
                      {evmWallets.map((evmWallet, index) => {
                        const isActive = selectedEVMWallet?.evmAddress === evmWallet.evmAddress;
                        return (
                          <div key={evmWallet.evmAddress}>
                            {/* Dashed separator between wallets */}
                            {index > 0 && (
                              <div className="border-t border-dashed border-border mx-4" />
                            )}
                            <div 
                              className="relative p-4 cursor-pointer transition-all hover:bg-muted/50"
                              onClick={() => handleSelectEvmWallet(evmWallet)}
                            >
                              {/* Active indicator bar - left side */}
                              <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-orange-500 transition-all duration-200 ${
                                isActive ? 'h-10 opacity-100' : 'h-0 opacity-0'
                              }`} />
                              
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className={`text-[10px] px-1.5 ${isActive ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' : ''}`}>
                                    #{index + 1}
                                  </Badge>
                                  <span className={`text-xs truncate max-w-[140px] ${isActive ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-muted-foreground'}`}>
                                    <WalletDisplayName address={evmWallet.octraAddress} />
                                  </span>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-6 w-6 p-0" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(evmWallet.evmAddress, `evm-${index}`);
                                  }}
                                >
                                  {copiedField === `evm-${index}` ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                              </div>
                              <p className={`font-mono text-sm ${isActive ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                                {evmWallet.evmAddress.slice(0, 10)}...{evmWallet.evmAddress.slice(-8)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </ScrollAreaContent>
                  </ScrollArea>
                </>
              ) : (
                /* Normal Octra Wallet Sidebar */
                <>
                  <div className="flex items-center justify-between mb-4 mt-2">
                    <h3 className="font-semibold text-base flex items-center gap-2">
                      <WalletIcon className="h-5 w-5" />
                      Wallets ({wallets.length})
                    </h3>
                  </div>
                  <ScrollArea className="flex-1 -ml-4 -mr-3" stabilizeGutter>
                    <ScrollAreaContent>
                      <DraggableWalletList
                        wallets={wallets}
                        activeWallet={wallet}
                        nonce={nonce}
                        walletNonces={walletNonces}
                        setWalletNonces={setWalletNonces}
                        onSwitchWallet={onSwitchWallet}
                        onCopyAddress={copyToClipboard}
                        onDeleteWallet={setWalletToDelete}
                        onReorderWallets={onReorderWallets}
                        copiedField={copiedField}
                        isPopupMode={false}
                      />
                    </ScrollAreaContent>
                  </ScrollArea>
                  <div className="pt-4 mt-auto border-t border-dashed border-x-0 border-b-0 border-border">
                    <Button
                      variant="ghost"
                      onClick={() => setShowAddWalletDialog(true)}
                      className="w-full h-10 text-sm justify-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add Wallet
                    </Button>
                  </div>
                </>
              )}
            </div>
            
            {/* Resize Handle - positioned outside content area */}
            <div
              className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors z-10"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
            />
          </aside>
          
          {/* Sidebar Toggle Button - aligned with sidebar edge */}
          <button
            onClick={() => {
              setShowWalletSidebar(!showWalletSidebar);
              // Update bothPanelsHidden state
              if (!showWalletSidebar && showHistorySidebar) setBothPanelsHidden(false);
              if (showWalletSidebar && !showHistorySidebar) setBothPanelsHidden(true);
            }}
            className={`fixed z-[50] h-12 w-4 flex items-center justify-center bg-muted/80 hover:bg-accent border-y border-r border-border transition-all opacity-30 hover:opacity-100 ${isResizing ? 'duration-0' : 'duration-300'}`}
            style={{
              left: showWalletSidebar ? `${sidebarWidth}px` : '0px',
              top: showWalletSidebar ? '57px' : '71px'
            }}
          >
            {showWalletSidebar ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </>
      )}

      {/* Main Content - Add padding-top for fixed header in expanded mode */}
      <div 
        className={isPopupMode ? '' : `transition-[padding-left,padding-right] ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out`}
        style={!isPopupMode ? { paddingLeft: sidebarLeftOffset, paddingRight: historySidebarRightOffset } : undefined}
      >
        <main className={isPopupMode ? 'octra-container pt-0 pb-0 px-3 flex flex-col h-[calc(100vh-50px)] overflow-hidden' : 'pt-[149px] pb-16 px-6 sm:px-8 lg:px-12 sm:pb-20'}>
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
                  pendingTransfersCount={pendingTransfersCount}
                  isCompact={true}
                />
              </div>

              {/* Balance Display */}
              <div className=" p-2">
                <div className="text-center">
                  <p className={`text-[10px] font-medium ${operationMode === 'private' ? 'text-[#0000db]' : 'text-muted-foreground'}`}>
                    Balance
                  </p>
                  {isLoadingBalance ? (
                    <div className="h-10 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <span className={`text-2xl font-bold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                        {operationMode === 'private' 
                          ? (encryptedBalance?.encrypted || 0).toFixed(8)
                          : (balance || 0).toFixed(8)
                        }
                      </span>
                      <Badge variant="outline" className={`text-lg font-bold px-2 py-0.5 border-0 ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                        OCT
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className={`grid ${operationMode === 'private' ? 'grid-cols-4 gap-2' : 'grid-cols-3 gap-2'}`}>
                {operationMode === 'public' ? (
                  <>
                    {/* Encrypt Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-3  border"
                      onClick={() => setPopupScreen('encrypt')}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Encrypt</span>
                    </Button>
                    {/* Send Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-3  border"
                      onClick={() => setPopupScreen('send')}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Send</span>
                    </Button>
                    {/* Receive Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-3  border"
                      onClick={() => setPopupScreen('receive')}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Receive</span>
                    </Button>
                  </>
                ) : (
                  <>
                    {/* Decrypt Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-2  border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('decrypt')}
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Decrypt</span>
                    </Button>
                    {/* Send Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-2  border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('send')}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Send</span>
                    </Button>
                    {/* Receive Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-2  border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('receive')}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Receive</span>
                    </Button>
                    {/* Claim Button */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-0.5 h-auto py-2 px-2  border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/5"
                      onClick={() => setPopupScreen('claim')}
                    >
                      <Gift className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Claim</span>
                    </Button>
                  </>
                )}
              </div>

              {/* Recent Activity Header */}
              <div className="flex items-center justify-between pt-1 pb-2">
                <h3 className={`text-xs font-semibold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                  Recent Activity
                </h3>
                <div className="flex items-center gap-1.5">
                  <a 
                    href={`https://octrascan.io/addresses/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title="View All on Explorer"
                  >
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                </div>
              </div>
            </div>

            {/* Transaction List - Scrollable area */}
            <ScrollArea className="flex-1 min-h-0" stabilizeGutter>
              <ScrollAreaContent className="space-y-1.5 pb-6">
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
                    const txDate = new Date(tx.timestamp * 1000);
                    const timeStr = txDate.toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit', 
                      hour12: false,
                      timeZone: 'UTC'
                    });
                    const dateStr = txDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC'
                    });
                    return (
                      <div 
                        key={tx.hash} 
                        className={`border  p-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                          operationMode === 'private' ? 'border-[#0000db]/20' : 'border-border'
                        }`}
                        onClick={() => handleViewTxDetails(tx.hash, tx.status === 'pending')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {tx.type === 'sent' ? (
                              <ArrowUpRight className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                            ) : (
                              <ArrowDownLeft className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {txIsPrivate ? (
                                  <span className="text-[#0000db] font-medium text-xs">{tx.type === 'sent' ? '-' : '+'}Private</span>
                                ) : (
                                  <span className={`font-mono text-xs ${tx.type === 'sent' ? 'text-red-500' : 'text-green-500'}`}>{tx.type === 'sent' ? '-' : '+'}{(tx.amount || 0).toFixed(4)} OCT</span>
                                )}
                                {tx.status === 'confirmed' ? (
                                  <div className="h-1.5 w-1.5  bg-[#0000db]" />
                                ) : tx.status === 'pending' ? (
                                  <div className="h-1.5 w-1.5  bg-yellow-500 animate-pulse" />
                                ) : (
                                  <div className="h-3 w-3  bg-red-500/20 flex items-center justify-center">
                                    <div className="h-1.5 w-1.5  bg-red-500" />
                                  </div>
                                )}
                                {tx.message && tx.message !== 'PRIVATE_TRANSFER' && tx.message !== '505249564154455f5452414e53464552' && (
                                  <MessageSquare className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {tx.type === 'sent' ? 'To: ' : 'From: '}{truncateAddress(tx.type === 'sent' ? tx.to : tx.from)}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground flex-shrink-0 text-right">
                            <div>{dateStr}</div>
                            <div>{timeStr} UTC</div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </ScrollAreaContent>
            </ScrollArea>
          </div>
        ) : (
        /* ============================================ */
        /* EXPANDED MODE - NEW DASHBOARD UI */
        /* ============================================ */
        <div className="flex flex-col h-[calc(100vh-149px)]">
          {/* Main Content Area */}
          <div className="flex-1 flex flex-col items-center justify-start pt-20 pb-4 overflow-auto">
            {/* EVM Mode Content */}
            {evmMode ? (
              <>
                {/* EVM Mode Label */}
                <div className="text-sm text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  EVM Assets - {evmNetwork.name}
                </div>

                {/* EVM Balance Display */}
                <div className="text-center mb-6">
                  {selectedEVMWallet?.isLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#f97316' }} />
                    </div>
                  ) : selectedEVMWallet?.balance !== null ? (
                    <>
                      <div className="flex items-center justify-center gap-3">
                        <span className="text-4xl font-bold tracking-tight text-orange-600 dark:text-orange-400">
                          {selectedEVMWallet?.balance || '0.000000'} {evmNetwork.symbol}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
                          onClick={() => {
                            fetchEvmBalance();
                            fetchEvmTransactions();
                          }}
                          disabled={evmRpcStatus !== 'connected' || selectedEVMWallet?.isLoading}
                        >
                          <RefreshCw className={`h-4 w-4 ${selectedEVMWallet?.isLoading ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                      {ethPrice !== null && selectedEVMWallet?.balance && (
                        <div className="text-lg text-muted-foreground mt-1">
                          ≈ {calculateUSDValue(selectedEVMWallet.balance, ethPrice)}
                          {evmNetwork.isTestnet && <span className="text-xs ml-2">(testnet)</span>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xl text-muted-foreground">
                      {evmRpcStatus === 'connected' ? 'Loading...' : 'RPC Disconnected'}
                    </div>
                  )}
                </div>

                {/* EVM Address Display */}
                {selectedEVMWallet && (
                  <div className="w-full max-w-lg mb-6 space-y-3">
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <Label className="text-xs text-muted-foreground">EVM Address</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-sm font-mono break-all text-orange-600 dark:text-orange-400">
                          {selectedEVMWallet.evmAddress}
                        </code>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => copyToClipboard(selectedEVMWallet.evmAddress, 'evm-main')}>
                          {copiedField === 'evm-main' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                          <a href={`${evmNetwork.explorer}/address/${selectedEVMWallet.evmAddress}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* EVM Action Button - Send Only */}
                <div className="w-full max-w-lg">
                  {/* Send ETH */}
                  <Button
                    variant="outline"
                    className="w-full flex flex-col items-center gap-3 h-auto py-6 border border-orange-500/30 hover:border-orange-500/50 hover:bg-orange-500/5 transition-all text-orange-600 dark:text-orange-400"
                    onClick={() => setShowEvmSendDialog(true)}
                    disabled={evmRpcStatus !== 'connected'}
                  >
                    <Send className="h-8 w-8" />
                    <span className="text-sm font-medium">Send {evmNetwork.symbol}</span>
                    <span className="text-[10px] text-orange-500/70">Transfer ETH</span>
                  </Button>
                </div>
              </>
            ) : (
              /* Normal Octra Wallet Content */
              <>
                {/* Mode Label */}
                <div className="text-sm text-muted-foreground mb-2">
                  {operationMode === 'private' ? 'Encrypted Balance' : 'Public Balance'}
                </div>

                {/* Balance Display */}
                <div className="text-center mb-6">
                  {isLoadingBalance || isRefreshingData ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                    </div>
                  ) : (
                    <div className={`text-4xl font-bold tracking-tight ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                      {operationMode === 'private' 
                        ? `${(encryptedBalance?.encrypted || 0).toFixed(8)} OCT`
                        : `${(balance || 0).toFixed(8)} OCT`
                      }
                    </div>
                  )}
                </div>

                {/* Encrypt/Decrypt Button */}
                {operationMode === 'public' ? (
                  <Button
                    variant="outline"
                    className="w-full max-w-lg h-12 mb-4 border border-border"
                    onClick={() => openPrivateModal('encrypt')}
                    disabled={!balance || balance <= 0.001}
                  >
                    <Lock className="h-4 w-4 mr-2" />
                    Encrypt
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full max-w-lg h-12 mb-4 border border-[#0000db]/30 text-[#0000db] hover:bg-[#0000db]/10"
                    onClick={() => openPrivateModal('decrypt')}
                    disabled={!encryptedBalance || encryptedBalance.encrypted <= 0}
                  >
                    <Unlock className="h-4 w-4 mr-2" />
                    Decrypt
                  </Button>
                )}

                {/* Action Buttons */}
                {operationMode === 'public' ? (
                  /* Public Mode Actions */
                  <div className="grid grid-cols-3 gap-4 w-full max-w-lg">
                    {/* Standard Send */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-border hover:border-foreground/30 hover:bg-accent transition-all"
                      onClick={() => openSendModal('standard')}
                    >
                      <Send className="h-8 w-8" />
                      <span className="text-sm font-medium">Send</span>
                      <span className="text-[10px] text-muted-foreground">Single transfer</span>
                    </Button>
                    
                    {/* Multi Send */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-border hover:border-foreground/30 hover:bg-accent transition-all"
                      onClick={() => openSendModal('multi')}
                    >
                      <Layers className="h-8 w-8" />
                      <span className="text-sm font-medium">Multi Send</span>
                      <span className="text-[10px] text-muted-foreground">Multiple recipients</span>
                    </Button>
                    
                    {/* Bulk Send */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-border hover:border-foreground/30 hover:bg-accent transition-all"
                      onClick={() => openSendModal('bulk')}
                    >
                      <FileText className="h-8 w-8" />
                      <span className="text-sm font-medium">Bulk Send</span>
                      <span className="text-[10px] text-muted-foreground">Import from file</span>
                    </Button>
                  </div>
                ) : (
                  /* Private Mode Actions */
                  <div className="grid grid-cols-3 gap-4 w-full max-w-lg">
                    {/* Send (Private Transfer) */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-[#0000db]/30 hover:border-[#0000db]/50 hover:bg-[#0000db]/5 transition-all text-[#0000db]"
                      onClick={() => openSendModal('standard')}
                    >
                      <Send className="h-8 w-8" />
                      <span className="text-sm font-medium">Send</span>
                      <span className="text-[10px] text-[#0000db]/70">Private transfer</span>
                    </Button>
                    
                    {/* Multi Send - Coming Soon */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-[#0000db]/20 opacity-50 cursor-not-allowed"
                      disabled
                    >
                      <Layers className="h-8 w-8 text-[#0000db]/50" />
                      <span className="text-sm font-medium text-[#0000db]/50">Multi Send</span>
                      <span className="text-[10px] text-[#0000db]/40">Coming soon</span>
                    </Button>
                    
                    {/* Claim */}
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-3 h-auto py-6 border border-[#0000db]/30 hover:border-[#0000db]/50 hover:bg-[#0000db]/5 transition-all text-[#0000db] relative"
                      onClick={openClaimScreen}
                    >
                      <Gift className="h-8 w-8" />
                      <span className="text-sm font-medium">Claim</span>
                      <span className="text-[10px] text-[#0000db]/70">Pending transfers</span>
                      {pendingTransfersCount > 0 && (
                        <Badge className="absolute -top-2 -right-2 bg-[#0000db] text-white text-[10px] h-5 min-w-5 flex items-center justify-center">
                          {pendingTransfersCount}
                        </Badge>
                      )}
                    </Button>
                  </div>
                )}
                
                {/* EVM Assets Section - Only in Public Mode */}
                {operationMode === 'public' && (
                  <div className="w-full max-w-lg">
                    <div className="border-t border-dashed border-border my-4" />
                    <Button
                      variant="outline"
                      className="w-full flex items-center justify-center gap-3 h-14 border border-orange-500/30 hover:border-orange-500/50 hover:bg-orange-500/5 transition-all text-orange-600 dark:text-orange-400"
                      onClick={enterEvmMode}
                    >
                      <Coins className="h-5 w-5" />
                      <span className="text-sm font-medium">EVM Assets ETH</span>
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Claim Inline Screen (Private Mode) */}
          {operationMode === 'private' && activeTab === 'claim' && !evmMode && (
            <div 
              className={`fixed inset-0 z-[45] bg-background/95 backdrop-blur-sm flex flex-col transition-all duration-200 ${
                claimAnimating ? 'animate-in slide-in-from-right-4 fade-in' : ''
              } ${claimClosing ? 'animate-out slide-out-to-right-4 fade-out' : ''}`}
              style={{ 
                top: showWalletSidebar ? '49px' : '69px', 
                left: sidebarLeftOffset,
                right: historySidebarRightOffset,
                bottom: '40px'
              }}
            >
              <div className="flex items-center justify-between px-6 pt-4 pb-2">
                <div className="flex items-center gap-3">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={closeClaimScreen} 
                    className="h-9 w-9 p-0"
                  >
                    <ChevronDown className="h-5 w-5 rotate-90" />
                  </Button>
                  <div className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-[#0000db]" />
                    <h2 className="text-lg font-semibold text-[#0000db]">Claim Transfers</h2>
                    {pendingTransfersCount > 0 && (
                      <Badge variant="secondary" className="ml-1 bg-[#0000db]/10 text-[#0000db]">
                        {pendingTransfersCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <ClaimTransfers
                  wallet={wallet}
                  onTransactionSuccess={handleTransactionSuccess}
                  isPopupMode={false}
                  hideBorder={true}
                />
              </div>
            </div>
          )}
        </div>
        )}
      </main>
      </div>

      {/* History Sidebar - Right side (Expanded mode only) */}
      {!isPopupMode && (
        <>
          <aside 
            className={`fixed right-0 bottom-0 z-30 bg-background border-l border-border transition-all ${isResizingHistory ? 'duration-0' : 'duration-300'} ${showHistorySidebar ? '' : 'w-0'} overflow-hidden`}
            style={{ 
              width: showHistorySidebar ? `${historySidebarWidth}px` : '0px',
              top: showWalletSidebar ? '49px' : '69px'
            }}
          >
            <div className="h-full flex flex-col" style={{ width: `${historySidebarWidth}px` }}>
              {/* Transaction Details View */}
              {showExpandedTxDetails ? (
                <div className={`h-full flex flex-col transition-all duration-200 ${
                  txDetailsAnimating ? 'animate-in slide-in-from-right-4 fade-in' : ''
                } ${txDetailsClosing ? 'animate-out slide-out-to-right-4 fade-out' : ''}`}>
                  {/* Header */}
                  <div className="flex items-center gap-2 py-3 flex-shrink-0 mt-3">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={closeExpandedTxDetails} 
                      className="h-8 w-8 p-0 ml-2"
                    >
                      <ChevronDown className="h-4 w-4 rotate-90" />
                    </Button>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">Transaction Details</h3>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <ScrollArea className="flex-1">
                    <div className="p-3 pb-4 min-h-full flex flex-col">
                      {loadingTxDetails ? (
                        <div className="flex-1 flex items-center justify-center py-12">
                          <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                        </div>
                      ) : selectedTxDetails ? (
                        <>
                        <div className="flex-1 flex flex-col divide-y divide-dashed divide-border">
                          {/* Status */}
                          <div className="py-2.5 flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Status</span>
                            {'stage_status' in selectedTxDetails ? (
                              <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-600">
                                {selectedTxDetails.stage_status || 'pending'}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs bg-[#0000db]/20 text-[#0000db]">
                                confirmed
                              </Badge>
                            )}
                          </div>

                          {/* Epoch - only for confirmed */}
                          {'epoch' in selectedTxDetails && (
                            <div className="py-2.5 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Epoch</span>
                              <span className="font-mono text-sm">{selectedTxDetails.epoch}</span>
                            </div>
                          )}

                          {/* Time */}
                          {('timestamp' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                            <div className="py-2.5 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Time (UTC)</span>
                              <span className="text-xs">
                                {'timestamp' in selectedTxDetails 
                                  ? new Date(selectedTxDetails.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                                  : new Date(selectedTxDetails.parsed_tx.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                                }
                              </span>
                            </div>
                          )}

                          {/* Hash */}
                          <div className="py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Hash</span>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-5 w-5 p-0" 
                                onClick={() => copyToClipboard('hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash, 'txHash')}
                              >
                                {copiedField === 'txHash' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                              </Button>
                            </div>
                            <p className="font-mono text-[11px] break-all leading-relaxed">
                              {'hash' in selectedTxDetails ? selectedTxDetails.hash : selectedTxDetails.tx_hash}
                            </p>
                          </div>

                          {/* From */}
                          {('from' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                            <div className="py-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">From</span>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 w-5 p-0" 
                                  onClick={() => copyToClipboard('from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from, 'txFrom')}
                                >
                                  {copiedField === 'txFrom' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                              </div>
                              <p className="font-mono text-xs break-all leading-relaxed">
                                {'from' in selectedTxDetails ? selectedTxDetails.from : selectedTxDetails.parsed_tx.from}
                              </p>
                            </div>
                          )}

                          {/* To */}
                          {('to' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                            <div className="py-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">To</span>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 w-5 p-0" 
                                  onClick={() => copyToClipboard('to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to, 'txTo')}
                                >
                                  {copiedField === 'txTo' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                              </div>
                              <p className="font-mono text-xs break-all leading-relaxed">
                                {'to' in selectedTxDetails ? selectedTxDetails.to : selectedTxDetails.parsed_tx.to}
                              </p>
                            </div>
                          )}

                          {/* Amount */}
                          {('amount' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                            <div className="py-2.5 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <span className="font-mono text-sm font-medium">
                                {'amount' in selectedTxDetails ? selectedTxDetails.amount : selectedTxDetails.parsed_tx.amount} OCT
                              </span>
                            </div>
                          )}

                          {/* OU (Gas) */}
                          {('ou' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (() => {
                            const ouValue = 'ou' in selectedTxDetails ? selectedTxDetails.ou : selectedTxDetails.parsed_tx.ou;
                            const ouNum = parseInt(ouValue) || 0;
                            const feeOct = (ouNum * 0.0000001).toFixed(7);
                            return (
                              <div className="py-2.5 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">OU (Gas)</span>
                                <div className="text-right">
                                  <span className="font-mono text-sm">{ouValue}</span>
                                  <p className="text-[10px] text-muted-foreground">≈ {feeOct} OCT</p>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Nonce */}
                          {('nonce' in selectedTxDetails || 'parsed_tx' in selectedTxDetails) && (
                            <div className="py-2.5 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Nonce</span>
                              <span className="font-mono text-sm">
                                {'nonce' in selectedTxDetails ? selectedTxDetails.nonce : selectedTxDetails.parsed_tx.nonce}
                              </span>
                            </div>
                          )}

                          {/* Message */}
                          {(('message' in selectedTxDetails && selectedTxDetails.message) || 
                            ('parsed_tx' in selectedTxDetails && selectedTxDetails.parsed_tx.message)) && (
                            <div className="py-2.5">
                              <span className="text-xs text-muted-foreground">Message</span>
                              <p className="text-xs mt-1 break-all">
                                {'message' in selectedTxDetails ? selectedTxDetails.message : selectedTxDetails.parsed_tx.message}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Spacer to push button to bottom */}
                        <div className="flex-1" />

                        {/* View on Explorer - outside divide container */}
                        {!('stage_status' in selectedTxDetails) && (
                          <div className="pt-4 border-t border-dashed border-x-0 border-b-0 border-border">
                            <Button
                              variant="ghost"
                              className="w-full h-10 text-sm"
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
                        )}
                      </>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground">
                          <p className="text-sm">No transaction data available</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                /* History List View */
                <div className={`h-full flex flex-col p-3 pl-5 pb-6 transition-all duration-200 ${
                  txDetailsClosing ? 'animate-in slide-in-from-left-4 fade-in' : ''
                }`}>
                  {/* EVM Mode History */}
                  {evmMode ? (
                    <>
                      <div className="flex items-center justify-between mb-4 mt-2 mr-2 flex-shrink-0">
                        <h3 className="font-semibold text-base flex items-center gap-2 text-orange-600 dark:text-orange-400">
                          <History className="h-5 w-5" />
                          EVM Activity
                        </h3>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 w-7 p-0"
                            onClick={fetchEvmTransactions}
                            disabled={isLoadingEvmTxs}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingEvmTxs ? 'animate-spin' : ''}`} />
                          </Button>
                          {selectedEVMWallet && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-7 w-7 p-0"
                              asChild
                            >
                              <a href={`${evmNetwork.explorer}/address/${selectedEVMWallet.evmAddress}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ScrollArea className="h-full">
                          <ScrollAreaContent className="pr-2">
                            {isLoadingEvmTxs ? (
                              <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                              </div>
                            ) : evmTransactions.length > 0 ? (
                              evmTransactions.map((tx, index) => (
                                <a 
                                  key={tx.hash} 
                                  href={`${evmNetwork.explorer}/tx/${tx.hash}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  {index > 0 && (
                                    <div className="border-t border-dashed border-border mx-2" />
                                  )}
                                  <div className="p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        {tx.type === 'sent' ? (
                                          <ArrowUpRight className="h-4 w-4 text-red-500" />
                                        ) : (
                                          <ArrowDownLeft className="h-4 w-4 text-green-500" />
                                        )}
                                        <span className="text-sm font-medium capitalize">{tx.type}</span>
                                      </div>
                                      <p className={`text-sm font-semibold ${tx.type === 'sent' ? 'text-red-500' : 'text-green-500'}`}>
                                        {tx.type === 'sent' ? '-' : '+'}{tx.value} {evmNetwork.symbol}
                                      </p>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <code className="text-[10px] font-mono text-muted-foreground truncate max-w-[150px]">
                                        {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
                                      </code>
                                      <span className="text-[10px] text-muted-foreground">
                                        {new Date(tx.timestamp).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </a>
                              ))
                            ) : (
                              <div className="flex items-center justify-center py-12">
                                <div className="text-center text-muted-foreground">
                                  <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                                  <p className="text-sm font-medium">No transactions found</p>
                                  {selectedEVMWallet && (
                                    <Button variant="link" size="sm" className="mt-4 text-orange-600 dark:text-orange-400" asChild>
                                      <a href={`${evmNetwork.explorer}/address/${selectedEVMWallet.evmAddress}`} target="_blank" rel="noopener noreferrer">
                                        View on Explorer <ExternalLink className="h-3 w-3 ml-1" />
                                      </a>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </ScrollAreaContent>
                        </ScrollArea>
                      </div>
                    </>
                  ) : (
                    /* Normal Octra History */
                    <>
                      <div className="flex items-center justify-between mb-4 mt-2 mr-2 flex-shrink-0">
                        <h3 className={`font-semibold text-base flex items-center gap-2 ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                          <History className="h-5 w-5" />
                          {operationMode === 'private' ? 'Encrypted Activity' : 'Public Activity'}
                        </h3>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 w-7 p-0"
                            asChild
                          >
                            <a href={`https://octrascan.io/addresses/${wallet.address}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <UnifiedHistory 
                          wallet={wallet} 
                          transactions={transactions}
                          onTransactionsUpdate={handleTransactionsUpdate}
                          isLoading={isLoadingTransactions}
                          isPopupMode={false}
                          hideBorder={true}
                          operationMode={operationMode}
                          isCompact={true}
                          onViewTxDetails={handleViewTxDetails}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* Resize Handle - positioned on left side */}
            <div
              className="absolute top-0 left-0 w-2 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors z-10"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingHistory(true);
              }}
            />
          </aside>
          
          {/* History Sidebar Toggle Button */}
          <button
            onClick={() => {
              setShowHistorySidebar(!showHistorySidebar);
              // Update bothPanelsHidden state
              if (showWalletSidebar && !showHistorySidebar) setBothPanelsHidden(false);
              if (!showWalletSidebar && showHistorySidebar) setBothPanelsHidden(true);
            }}
            className={`fixed z-[50] h-12 w-4 flex items-center justify-center bg-muted/80 hover:bg-accent border-y border-l border-border transition-all opacity-30 hover:opacity-100 ${isResizingHistory ? 'duration-0' : 'duration-300'}`}
            style={{
              right: showHistorySidebar ? `${historySidebarWidth}px` : '0px',
              top: showWalletSidebar ? '57px' : '71px'
            }}
          >
            {showHistorySidebar ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
          </button>
        </>
      )}

      {/* Expanded Mode Send Modals */}
      {!isPopupMode && expandedSendModal && (
        <div 
          className={`fixed z-[45] bg-background/95 backdrop-blur-sm flex flex-col transition-all ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out ${
            sendModalAnimating ? 'animate-send-modal-enter' : ''
          } ${sendModalClosing ? 'animate-send-modal-exit' : ''}`}
          style={{ 
            top: showWalletSidebar ? '49px' : '69px', 
            left: sidebarLeftOffset,
            right: historySidebarRightOffset,
            bottom: '40px'
          }}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={closeSendModal} 
                className="h-9 w-9 p-0"
              >
                <ChevronDown className="h-5 w-5 rotate-90" />
              </Button>
              <div className="flex items-center gap-2">
                {operationMode === 'private' ? (
                  <Send className="h-5 w-5 text-[#0000db]" />
                ) : (
                  <>
                    {expandedSendModal === 'standard' && <Send className="h-5 w-5" />}
                    {expandedSendModal === 'multi' && <Layers className="h-5 w-5" />}
                    {expandedSendModal === 'bulk' && <FileText className="h-5 w-5" />}
                  </>
                )}
                <h2 className={`text-lg font-semibold ${operationMode === 'private' ? 'text-[#0000db]' : ''}`}>
                  {operationMode === 'private' ? 'Private Transfer' : (
                    <>
                      {expandedSendModal === 'standard' && 'Single Send'}
                      {expandedSendModal === 'multi' && 'Multi Send'}
                      {expandedSendModal === 'bulk' && 'Bulk Send'}
                    </>
                  )}
                </h2>
              </div>
            </div>
            {expandedSendModal === 'bulk' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkResetTrigger(prev => prev + 1)}
                className="text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset
              </Button>
            )}
            {expandedSendModal === 'multi' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMultiResetTrigger(prev => prev + 1)}
                className="text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset
              </Button>
            )}
          </div>
          
          {/* Modal Content */}
          {operationMode === 'private' ? (
            /* Private Mode - Private Transfer */
            <ScrollArea className="flex-1">
              <div className="p-6 max-w-xl mx-auto">
                <PrivateTransfer
                  wallet={wallet}
                  balance={balance}
                  nonce={nonce}
                  encryptedBalance={encryptedBalance}
                  onBalanceUpdate={handleBalanceUpdate}
                  onNonceUpdate={handleNonceUpdate}
                  onTransactionSuccess={() => {
                    handleTransactionSuccess();
                    closeSendModal();
                  }}
                  isCompact={false}
                  onAddToAddressBook={handleAddToAddressBook}
                />
              </div>
            </ScrollArea>
          ) : expandedSendModal === 'standard' ? (
            <ScrollArea className="flex-1">
              <div className="p-6 max-w-xl mx-auto">
                <SendTransaction
                  wallet={wallet}
                  balance={balance}
                  nonce={nonce}
                  onBalanceUpdate={handleBalanceUpdate}
                  onNonceUpdate={handleNonceUpdate}
                  onTransactionSuccess={handleTransactionSuccess}
                  onModalClose={closeSendModal}
                  onAddToAddressBook={handleAddToAddressBook}
                />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 px-6 py-2 overflow-auto xl:overflow-hidden">
              {expandedSendModal === 'multi' && (
                <MultiSend
                  wallet={wallet}
                  balance={balance}
                  nonce={nonce}
                  onBalanceUpdate={handleBalanceUpdate}
                  onNonceUpdate={handleNonceUpdate}
                  onTransactionSuccess={handleTransactionSuccess}
                  onModalClose={closeSendModal}
                  hideBorder={true}
                  resetTrigger={multiResetTrigger}
                  sidebarOpen={showWalletSidebar}
                  historySidebarOpen={showHistorySidebar}
                  onAddToAddressBook={handleAddToAddressBook}
                />
              )}
              {expandedSendModal === 'bulk' && (
                <FileMultiSend
                  wallet={wallet}
                  balance={balance}
                  nonce={nonce}
                  onBalanceUpdate={handleBalanceUpdate}
                  onNonceUpdate={handleNonceUpdate}
                  onTransactionSuccess={handleTransactionSuccess}
                  hideBorder={true}
                  resetTrigger={bulkResetTrigger}
                  sidebarOpen={showWalletSidebar}
                  historySidebarOpen={showHistorySidebar}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded Mode Private Modals (Encrypt/Decrypt) */}
      {!isPopupMode && expandedPrivateModal && (
        <div 
          className={`fixed z-[45] bg-background/95 backdrop-blur-sm flex flex-col transition-all ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out ${
            privateModalAnimating ? 'animate-send-modal-enter' : ''
          } ${privateModalClosing ? 'animate-send-modal-exit' : ''}`}
          style={{ 
            top: showWalletSidebar ? '49px' : '69px', 
            left: sidebarLeftOffset,
            right: historySidebarRightOffset,
            bottom: '40px'
          }}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={closePrivateModal} 
                className="h-9 w-9 p-0"
              >
                <ChevronDown className="h-5 w-5 rotate-90" />
              </Button>
              <div className="flex items-center gap-2">
                {expandedPrivateModal === 'encrypt' && <Lock className="h-5 w-5 text-[#0000db]" />}
                {expandedPrivateModal === 'decrypt' && <Unlock className="h-5 w-5 text-[#0000db]" />}
                <h2 className="text-lg font-semibold text-[#0000db]">
                  {expandedPrivateModal === 'encrypt' && 'Encrypt OCT'}
                  {expandedPrivateModal === 'decrypt' && 'Decrypt OCT'}
                </h2>
              </div>
            </div>
          </div>
          
          {/* Modal Content */}
          <ScrollArea className="flex-1">
            <div className="p-6 max-w-xl mx-auto">
              {expandedPrivateModal === 'encrypt' && (
                <EncryptBalanceDialog
                  open={true}
                  onOpenChange={(open) => {
                    if (!open) closePrivateModal();
                  }}
                  wallet={wallet}
                  publicBalance={encryptedBalance?.public || balance || 0}
                  onSuccess={() => {
                    closePrivateModal();
                    refreshWalletData();
                  }}
                  isPopupMode={false}
                  isInline={true}
                />
              )}
              {expandedPrivateModal === 'decrypt' && (
                <DecryptBalanceDialog
                  open={true}
                  onOpenChange={(open) => {
                    if (!open) closePrivateModal();
                  }}
                  wallet={wallet}
                  encryptedBalance={encryptedBalance?.encrypted || 0}
                  onSuccess={() => {
                    closePrivateModal();
                    refreshWalletData();
                  }}
                  isPopupMode={false}
                  isInline={true}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Fixed Bottom Footer - Popup Mode Only - visible on all screens */}
      {isPopupMode && (
        <div className="fixed bottom-[1px] left-[1px] right-[1px] z-[200] bg-background border-t border-border">
          {/* Network Status Footer */}
          <div className="flex items-center justify-between px-3 py-1.5">
            {/* Left: Connection Status */}
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
                {rpcStatus === 'connected' ? `Connected (${activeNetwork.charAt(0).toUpperCase() + activeNetwork.slice(1)})` : 
                 rpcStatus === 'disconnected' ? 'Disconnected' : 
                 'Connecting...'}
              </span>
            </div>
            {/* Right: GitHub + Version */}
            <div className="flex items-center gap-1.5">
              <a
                href="https://github.com/m-tq/OctWa"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors text-muted-foreground"
                title="View on GitHub"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
              <span className="text-muted-foreground/50">|</span>
              <span className="text-[10px] text-muted-foreground">{__APP_NAME__.split(' ')[0]} {__APP_VERSION__}</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer Spacer - Only for expanded mode */}
      {!isPopupMode && <div className="h-10" />}

      {/* Toggle Both Panels Button - Above Footer */}
      {!isPopupMode && (
        <div 
          className={`fixed bottom-10 z-[47] flex justify-center transition-[left,right] ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out group`}
          style={{ left: sidebarLeftOffset, right: historySidebarRightOffset }}
        >
          <button
            onClick={toggleBothPanels}
            className="h-6 px-3 flex items-center justify-center gap-1 bg-muted/80 hover:bg-accent border border-border rounded-full transition-all duration-300 text-xs text-muted-foreground hover:text-foreground opacity-30 hover:opacity-100"
            title={bothPanelsHidden ? "Show panels" : "Hide panels"}
          >
            {bothPanelsHidden ? (
              <>
                <ChevronRight className="h-3 w-3" />
                <ChevronLeft className="h-3 w-3" />
              </>
            ) : (
              <>
                <ChevronLeft className="h-3 w-3" />
                <ChevronRight className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      )}

      {/* Footer Credit - Only for expanded mode */}
      {!isPopupMode && (
        <footer 
          className={`fixed bottom-0 py-2 px-4 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm border-t border-x-0 border-b-0 border-border flex items-center justify-between transition-[left,right] ${isResizing || isResizingHistory ? 'duration-0' : 'duration-300'} ease-out z-[46]`}
          style={{ left: sidebarLeftOffset, right: historySidebarRightOffset }}
        >
          {/* Left: Connection Status */}
          {evmMode ? (
            /* EVM Mode Footer - Left: RPC with wifi icon */
            <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
              <Wifi className="h-3.5 w-3.5" />
              <span>{getRpcDisplayName(getEVMRpcUrl(evmNetwork.id))}</span>
            </div>
          ) : (
            /* Normal Octra Footer */
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                rpcStatus === 'connected' ? 'bg-[#0000db]' : 
                rpcStatus === 'disconnected' ? 'bg-red-500' : 
                'bg-yellow-500 animate-pulse'
              }`} />
              <span className={`${
                rpcStatus === 'connected' ? 'text-[#0000db]' : 
                rpcStatus === 'disconnected' ? 'text-red-500' : 
                'text-yellow-500'
              }`}>
                {rpcStatus === 'connected' ? `Connected (${activeNetwork.charAt(0).toUpperCase() + activeNetwork.slice(1)})` : 
                 rpcStatus === 'disconnected' ? 'Disconnected' : 
                 'Connecting...'}
              </span>
            </div>
          )}
          
          {/* Center: Current Epoch (only for Octra mode) / Gas price (for EVM mode) */}
          {evmMode ? (
            /* EVM Mode - Center: Gas price */
            evmGasPrice && (
              <span className="text-orange-600 dark:text-orange-400">
                Gas: <span className="font-medium">{evmGasPrice} Gwei</span>
              </span>
            )
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              {isUpdatingEpoch ? (
                <>
                  <RotateCcw className="h-3 w-3 animate-spin text-[#0000db]" />
                  <span className="text-[#0000db]">updating data...</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">Epoch:</span>
                  <a 
                    href={currentEpoch ? `https://octrascan.io/epochs/${currentEpoch}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#0000db] hover:underline"
                  >
                    #{currentEpoch || '...'}
                  </a>
                </>
              )}
            </span>
          )}
          
          {/* Right: GitHub + Version */}
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/m-tq/OctWa"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
              title="View on GitHub"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <span className="text-muted-foreground/50">|</span>
            <span className="text-muted-foreground">{__APP_NAME__.split(' ')[0]} {__APP_VERSION__}</span>
          </div>
        </footer>
      )}

      {/* EVM Send Dialog */}
      <Dialog open={showEvmSendDialog} onOpenChange={setShowEvmSendDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Send className="h-5 w-5" />
              Send {evmNetwork.symbol}
            </DialogTitle>
            <DialogDescription>
              Send ETH from your EVM wallet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>To Address</Label>
              <Input
                placeholder="0x..."
                value={evmSendTo}
                onChange={(e) => setEvmSendTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount ({evmNetwork.symbol})</Label>
              <Input
                type="number"
                placeholder="0.0"
                value={evmSendAmount}
                onChange={(e) => setEvmSendAmount(e.target.value)}
              />
              {selectedEVMWallet?.balance && (
                <p className="text-xs text-muted-foreground">
                  Available: {selectedEVMWallet.balance} {evmNetwork.symbol}
                </p>
              )}
            </div>
            {evmSendError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-500">{evmSendError}</p>
              </div>
            )}
            {evmTxHash && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400 mb-2">Transaction sent!</p>
                <a 
                  href={`${evmNetwork.explorer}/tx/${evmTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1"
                >
                  View on Explorer <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowEvmSendDialog(false);
                setEvmSendTo('');
                setEvmSendAmount('');
                setEvmSendError(null);
                setEvmTxHash(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleEvmSendTransaction}
              disabled={isEvmSending || !evmSendTo || !evmSendAmount}
            >
              {isEvmSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* EVM RPC Manager Dialog */}
      <Dialog open={showEvmRpcManager} onOpenChange={setShowEvmRpcManager}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Wifi className="h-5 w-5" />
              EVM RPC Settings
            </DialogTitle>
            <DialogDescription>
              Configure RPC provider for {evmNetwork.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current RPC</Label>
              <div className="p-3 bg-muted rounded-lg">
                <code className="text-xs break-all">{getRpcDisplayName(getEVMRpcUrl(evmNetwork.id))}</code>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Custom RPC URL</Label>
              <Input
                placeholder="https://..."
                value={evmCustomRpcUrl}
                onChange={(e) => setEvmCustomRpcUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowEvmRpcManager(false);
                setEvmCustomRpcUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleSaveEvmCustomRpc}
              disabled={!evmCustomRpcUrl.trim()}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
