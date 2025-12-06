import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppConnection } from './components/DAppConnection';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { Wallet, DAppConnectionRequest } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { WalletManager } from './utils/walletManager';

function PopupApp() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPopupMode, setIsPopupMode] = useState(true);
  const [connectionRequest, setConnectionRequest] = useState<DAppConnectionRequest | null>(null);
  const [contractRequest, setContractRequest] = useState<any>(null);

  // ONLY load data once on mount - NO dependencies to prevent loops
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log('🔄 PopupApp: Loading initial data...');
        
        // Detect if we're in popup mode
        const isPopup = window.location.pathname.includes('popup.html') || window.innerWidth <= 500;
        setIsPopupMode(isPopup);

        await ExtensionStorageManager.init();
        
        // Check for pending connection request first
        const pendingRequest = await ExtensionStorageManager.get('pendingConnectionRequest');
        if (pendingRequest) {
          try {
            const connectionReq = typeof pendingRequest === 'string' 
              ? JSON.parse(pendingRequest) 
              : pendingRequest;
            setConnectionRequest(connectionReq);
          } catch (error) {
            console.error('Failed to parse connection request:', error);
            await ExtensionStorageManager.remove('pendingConnectionRequest');
          }
        }
        
        // Check for pending contract request
        const pendingContractRequest = await ExtensionStorageManager.get('pendingContractRequest');
        if (pendingContractRequest) {
          try {
            const contractReq = typeof pendingContractRequest === 'string' 
              ? JSON.parse(pendingContractRequest) 
              : pendingContractRequest;
            setContractRequest(contractReq);
          } catch (error) {
            console.error('Failed to parse contract request:', error);
            await ExtensionStorageManager.remove('pendingContractRequest');
          }
        }
        
        // Use WalletManager to check if should show unlock screen
        const shouldShowUnlock = await WalletManager.shouldShowUnlockScreen();
        
        console.log('🔒 PopupApp: Should show unlock:', shouldShowUnlock);
        
        if (shouldShowUnlock) {
          console.log('🔒 PopupApp: Showing unlock screen - wallet is locked');
          setIsLocked(true);
          setIsLoading(false);
          return;
        }
        
        // Only load wallets if not locked
        const [storedWallets, activeWalletId] = await Promise.all([
          ExtensionStorageManager.get('wallets'),
          ExtensionStorageManager.get('activeWalletId')
        ]);
        
        let loadedWallets: Wallet[] = [];
        let activeWallet: Wallet | null = null;
        
        if (storedWallets) {
          try {
            const parsedWallets = typeof storedWallets === 'string' 
              ? JSON.parse(storedWallets) 
              : storedWallets;
            
            if (Array.isArray(parsedWallets)) {
              loadedWallets = parsedWallets;
              console.log('✅ PopupApp: Loaded wallets:', loadedWallets.length);
              
              if (loadedWallets.length > 0) {
                activeWallet = loadedWallets[0];
                if (activeWalletId) {
                  const foundWallet = loadedWallets.find((w: Wallet) => w.address === activeWalletId);
                  if (foundWallet) {
                    activeWallet = foundWallet;
                  }
                }
                console.log('🎯 PopupApp: Selected active wallet:', activeWallet?.address);
              }
            }
          } catch (error) {
            console.error('Failed to parse wallets:', error);
          }
        }
        
        // Set states
        setWallets(loadedWallets);
        setWallet(activeWallet);
        setIsLocked(false);
        
        console.log('🔓 PopupApp: Wallet unlocked and ready');
        
      } catch (error) {
        console.error('❌ PopupApp: Failed to load wallet data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []); // NO dependencies - only run once

  // Listen for storage changes across extension contexts
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (isLocked) return; // Don't update if locked
      
      // Handle wallet data changes
      if (e.key === 'wallets' && e.newValue) {
        try {
          const newWallets = JSON.parse(e.newValue);
          console.log('📦 PopupApp: Storage change detected - wallets updated:', newWallets.length);
          setWallets(newWallets);
          
          // Update active wallet if needed
          const activeWalletId = localStorage.getItem('activeWalletId');
          if (activeWalletId && newWallets.length > 0) {
            const foundWallet = newWallets.find((w: Wallet) => w.address === activeWalletId);
            if (foundWallet) {
              setWallet(foundWallet);
            }
          } else if (newWallets.length > 0 && !wallet) {
            setWallet(newWallets[0]);
          }
        } catch (error) {
          console.error('Failed to parse wallets from storage change:', error);
        }
      }
      
      // Handle active wallet changes
      if (e.key === 'activeWalletId' && e.newValue && wallets.length > 0) {
        const foundWallet = wallets.find((w: Wallet) => w.address === e.newValue);
        if (foundWallet) {
          console.log('🎯 PopupApp: Active wallet changed:', e.newValue);
          setWallet(foundWallet);
        }
      }
      
      // Handle wallet lock state changes
      if (e.key === 'isWalletLocked') {
        const isLocked = e.newValue === 'true';
        setIsLocked(isLocked);
        
        if (isLocked) {
          setWallet(null);
          setWallets([]);
        }
      }
    };

    // Listen for localStorage changes
    window.addEventListener('storage', handleStorageChange);
    
    // Listen for chrome.storage changes if available
    let chromeStorageListener: ((changes: any) => void) | null = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chromeStorageListener = (changes: any) => {
        if (isLocked) return;
        
        // Handle wallets change
        if (changes.wallets && changes.wallets.newValue) {
          try {
            const newWallets = JSON.parse(changes.wallets.newValue);
            console.log('🔧 PopupApp: Chrome storage change - wallets updated:', newWallets.length);
            setWallets(newWallets);
            
            // Update localStorage for consistency
            localStorage.setItem('wallets', changes.wallets.newValue);
            
            // Update active wallet
            const activeWalletId = localStorage.getItem('activeWalletId');
            if (activeWalletId && newWallets.length > 0) {
              const foundWallet = newWallets.find((w: Wallet) => w.address === activeWalletId);
              if (foundWallet) {
                setWallet(foundWallet);
              }
            } else if (newWallets.length > 0 && !wallet) {
              setWallet(newWallets[0]);
            }
          } catch (error) {
            console.error('Failed to parse wallets from chrome storage change:', error);
          }
        }
        
        // Handle activeWalletId change
        if (changes.activeWalletId && changes.activeWalletId.newValue && wallets.length > 0) {
          const foundWallet = wallets.find((w: Wallet) => w.address === changes.activeWalletId.newValue);
          if (foundWallet) {
            console.log('🎯 PopupApp: Chrome storage - Active wallet changed:', changes.activeWalletId.newValue);
            setWallet(foundWallet);
            localStorage.setItem('activeWalletId', changes.activeWalletId.newValue);
          }
        }
        
        // Handle lock state change
        if (changes.isWalletLocked) {
          const isLocked = changes.isWalletLocked.newValue === 'true';
          setIsLocked(isLocked);
          
          if (isLocked) {
            setWallet(null);
            setWallets([]);
          }
        }
      };
      
      chrome.storage.onChanged.addListener(chromeStorageListener);
    }
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (chromeStorageListener && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.removeListener(chromeStorageListener);
      }
    };
  }, [isLocked, wallets, wallet]);

  // Add keyboard navigation for popup mode
  useEffect(() => {
    if (isPopupMode) {
      const handleKeyDown = (event: KeyboardEvent) => {
        const container = document.querySelector('.popup-container');
        if (!container) return;

        const scrollAmount = 40; // pixels to scroll per arrow press

        switch (event.key) {
          case 'ArrowUp':
            event.preventDefault();
            container.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
            break;
          case 'ArrowDown':
            event.preventDefault();
            container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            break;
          case 'PageUp':
            event.preventDefault();
            container.scrollBy({ top: -200, behavior: 'smooth' });
            break;
          case 'PageDown':
            event.preventDefault();
            container.scrollBy({ top: 200, behavior: 'smooth' });
            break;
          case 'Home':
            event.preventDefault();
            container.scrollTo({ top: 0, behavior: 'smooth' });
            break;
          case 'End':
            event.preventDefault();
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            break;
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isPopupMode]);

  // Enhanced unlock handler to properly restore wallet state and handle pending DApp requests
  const handleUnlock = (unlockedWallets: Wallet[]) => {
    console.log('🔓 PopupApp: Handling unlock with wallets:', unlockedWallets.length);
    console.log('🔓 PopupApp: Current state before unlock - isLocked:', isLocked, 'wallets:', wallets.length, 'wallet:', wallet?.address);
    
    // CRITICAL FIX: Use synchronous state updates to prevent race conditions
    if (unlockedWallets.length > 0) {
      console.log('🔓 PopupApp: Setting isLocked to false...');
      setIsLocked(false);
      
      console.log('🔓 PopupApp: Setting wallets...', unlockedWallets.length);
      setWallets(unlockedWallets);
      
      // Set the first wallet as active immediately
      console.log('🔓 PopupApp: Setting active wallet...', unlockedWallets[0].address.slice(0, 8) + '...');
      setWallet(unlockedWallets[0]);
      
      // Handle active wallet selection and pending requests asynchronously
      setTimeout(async () => {
        try {
          // Set active wallet - prioritize stored activeWalletId, fallback to first wallet
          const activeWalletId = await ExtensionStorageManager.get('activeWalletId');
          let activeWallet = unlockedWallets[0]; // Default to first wallet
          
          if (activeWalletId) {
            const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
            if (foundWallet) {
              activeWallet = foundWallet;
              console.log('🎯 PopupApp: Restored active wallet:', activeWallet.address.slice(0, 8) + '...');
              setWallet(activeWallet); // Update if different from first wallet
            } else {
              console.log('🔄 PopupApp: Active wallet not found, using first wallet:', activeWallet.address.slice(0, 8) + '...');
              await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
            }
          } else {
            console.log('🆕 PopupApp: No active wallet stored, using first wallet:', activeWallet.address.slice(0, 8) + '...');
            await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
          }
          
          // Check for pending DApp requests
          console.log('🔗 PopupApp: Checking for pending DApp requests after unlock...');
          
          // Check for pending connection request
          const pendingRequest = await ExtensionStorageManager.get('pendingConnectionRequest');
          if (pendingRequest) {
            try {
              const connectionReq = typeof pendingRequest === 'string' 
                ? JSON.parse(pendingRequest) 
                : pendingRequest;
              console.log('🔗 PopupApp: Found pending connection request, continuing flow for:', connectionReq.origin);
              setConnectionRequest(connectionReq);
            } catch (error) {
              console.error('Failed to parse pending connection request after unlock:', error);
              await ExtensionStorageManager.remove('pendingConnectionRequest');
            }
          }
          
          // Check for pending contract request
          const pendingContractRequest = await ExtensionStorageManager.get('pendingContractRequest');
          if (pendingContractRequest) {
            try {
              const contractReq = typeof pendingContractRequest === 'string' 
                ? JSON.parse(pendingContractRequest) 
                : pendingContractRequest;
              console.log('🔗 PopupApp: Found pending contract request, continuing flow for:', contractReq.origin);
              setContractRequest(contractReq);
            } catch (error) {
              console.error('Failed to parse pending contract request after unlock:', error);
              await ExtensionStorageManager.remove('pendingContractRequest');
            }
          }
          
          console.log('✅ PopupApp: Unlock handling completed successfully');
        } catch (error) {
          console.error('❌ PopupApp: Error in async unlock handler:', error);
        }
      }, 0);
      
    } else {
      console.warn('⚠️ PopupApp: No wallets returned from unlock process');
      setIsLocked(false);
      setWallets([]);
      setWallet(null);
    }
  };

  const addWallet = async (newWallet: Wallet) => {
    const updatedWallets = [...wallets, newWallet];
    setWallets(updatedWallets);
    setWallet(newWallet);
    
    try {
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      await ExtensionStorageManager.set('activeWalletId', newWallet.address);
    } catch (error) {
      console.error('Failed to save wallet:', error);
    }
  };

  const switchWallet = async (selectedWallet: Wallet) => {
    setWallet(selectedWallet);
    
    try {
      await ExtensionStorageManager.set('activeWalletId', selectedWallet.address);
    } catch (error) {
      console.error('Failed to switch wallet:', error);
    }
  };

  const removeWallet = async (walletToRemove: Wallet) => {
    const updatedWallets = wallets.filter(w => w.address !== walletToRemove.address);
    setWallets(updatedWallets);
    
    if (wallet?.address === walletToRemove.address && updatedWallets.length === 0) {
      setWallet(null);
    }
    
    try {
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      if (wallet?.address === walletToRemove.address && updatedWallets.length === 0) {
        await ExtensionStorageManager.remove('activeWalletId');
      }
    } catch (error) {
      console.error('Failed to remove wallet:', error);
    }
  };

  const disconnectWallet = async () => {
    try {
      // Use WalletManager to properly lock wallets
      await WalletManager.lockWallets();
      
      // Update UI state
      setWallet(null);
      setWallets([]);
      setIsLocked(true);
      
      console.log('🔒 PopupApp: Wallet disconnected and locked');
    } catch (error) {
      console.error('Failed to lock wallet:', error);
    }
  };

  const openExpandedView = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('index.html')
      });
    }
  };

  const handleConnectionApprove = async (selectedWallet: Wallet) => {
    if (!connectionRequest) return;
    
    // Send approval message to background script
    chrome.runtime.sendMessage({
      type: 'CONNECTION_RESULT',
      origin: connectionRequest.origin,
      approved: true,
      address: selectedWallet.address
    });
    
    // Clear pending request and close popup
    await ExtensionStorageManager.remove('pendingConnectionRequest');
    window.close();
  };

  const handleConnectionReject = async () => {
    if (!connectionRequest) return;
    
    // Send rejection message to background script
    chrome.runtime.sendMessage({
      type: 'CONNECTION_RESULT',
      origin: connectionRequest.origin,
      approved: false
    });
    
    // Clear pending request and close popup
    await ExtensionStorageManager.remove('pendingConnectionRequest');
    window.close();
  };

  const handleContractApprove = async (result: any) => {
    if (!contractRequest) return;
    
    // Send success response
    chrome.runtime.sendMessage({
      type: 'CONTRACT_RESULT',
      origin: contractRequest.origin,
      approved: true,
      result: result
    });
    
    // Clear pending request and close popup
    await ExtensionStorageManager.remove('pendingContractRequest');
    window.close();
  };

  const handleContractReject = async (error?: string) => {
    if (!contractRequest) return;
    
    // Send rejection response
    chrome.runtime.sendMessage({
      type: 'CONTRACT_RESULT',
      origin: contractRequest.origin,
      approved: false,
      error: error
    });
    
    // Clear pending request and close popup
    await ExtensionStorageManager.remove('pendingContractRequest');
    window.close();
  };

  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background flex items-center justify-center">
          <div>Loading...</div>
        </div>
      </ThemeProvider>
    );
  }

  // FORGE INSTRUCTION FIX: Show unlock screen for DApp requests when wallet is locked
  if (isLocked) {
    console.log('🔒 PopupApp: Wallet is locked, showing unlock screen');
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view">
          <div className="popup-container h-full overflow-y-auto">
            <UnlockWallet onUnlock={handleUnlock} />
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Handle connection request - Show even if no wallets loaded yet
  if (connectionRequest) {
    console.log('🔗 PopupApp: Showing connection request screen');
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view">
          <div className="popup-container h-full overflow-y-auto">
            <DAppConnection
              connectionRequest={connectionRequest}
              wallets={wallets}
              selectedWallet={wallet}
              onWalletSelect={setWallet}
              onApprove={handleConnectionApprove}
              onReject={handleConnectionReject}
            />
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Handle contract request - Show contract interaction interface
  if (contractRequest) {
    console.log('🔗 PopupApp: Showing contract request screen');
    
    // Find the wallet that is connected to this dApp
    const connectedWallet = contractRequest.connectedAddress 
      ? wallets.find(w => w.address === contractRequest.connectedAddress)
      : null;
    
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view">
          <div className="popup-container h-full overflow-y-auto">
            <DAppRequestHandler 
              wallets={wallets}
              contractRequest={contractRequest}
              selectedWallet={connectedWallet || wallet}
              onWalletSelect={setWallet}
              onApprove={handleContractApprove}
              onReject={handleContractReject}
            />
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Show welcome screen if no wallets
  if (wallets.length === 0) {
    console.log('📝 PopupApp: No wallets found, showing welcome screen');
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view">
          <div className="popup-container h-full overflow-y-auto">
            <WelcomeScreen onWalletCreated={addWallet} />
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Show wallet dashboard
  console.log('💰 PopupApp: Showing wallet dashboard for:', wallet?.address?.slice(0, 8) + '...');
  console.log('💰 PopupApp: Wallet dashboard conditions - wallet exists:', !!wallet, 'wallets.length:', wallets.length, 'isLocked:', isLocked);
  
  // CRITICAL FIX: Ensure we have a valid wallet before rendering dashboard
  if (!wallet) {
    console.log('⚠️ PopupApp: No active wallet available, showing loading or welcome screen');
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view">
          <div className="popup-container h-full overflow-y-auto flex items-center justify-center">
            <div className="text-center">
              <div className="text-lg">Loading wallet...</div>
              <div className="text-sm text-muted-foreground mt-2">Please wait</div>
            </div>
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }
  
  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="w-[400px] h-[600px] bg-background popup-view">
        <div className="popup-container h-full overflow-y-auto">
          <WalletDashboard
            wallet={wallet}
            wallets={wallets}
            onDisconnect={disconnectWallet}
            onSwitchWallet={switchWallet}
            onAddWallet={addWallet}
            onRemoveWallet={removeWallet}
            onExpandedView={openExpandedView}
            isPopupMode={isPopupMode}
          />
        </div>
        <Toaster />
      </div>
    </ThemeProvider>
  );
}

export default PopupApp;