import { useState, useEffect } from 'react';
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
        // Detect if we're in popup mode
        const isPopup = window.location.pathname.includes('popup.html') || window.innerWidth <= 500;
        setIsPopupMode(isPopup);

        await ExtensionStorageManager.init();
        
        // CRITICAL: Sync password hash from localStorage to ExtensionStorage if missing
        // This handles the case where password was set in expanded mode but not synced to extension storage
        const extPasswordHash = await ExtensionStorageManager.get('walletPasswordHash');
        const localPasswordHash = localStorage.getItem('walletPasswordHash');
        
        if (!extPasswordHash && localPasswordHash) {
          console.log('🔄 PopupApp: Syncing password hash from localStorage to ExtensionStorage');
          const localSalt = localStorage.getItem('walletPasswordSalt');
          const localEncryptedWallets = localStorage.getItem('encryptedWallets');
          const localIsLocked = localStorage.getItem('isWalletLocked');
          
          await ExtensionStorageManager.set('walletPasswordHash', localPasswordHash);
          if (localSalt) await ExtensionStorageManager.set('walletPasswordSalt', localSalt);
          if (localEncryptedWallets) await ExtensionStorageManager.set('encryptedWallets', localEncryptedWallets);
          if (localIsLocked) await ExtensionStorageManager.set('isWalletLocked', localIsLocked);
        }
        
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
        
        if (shouldShowUnlock) {
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
              
              if (loadedWallets.length > 0) {
                activeWallet = loadedWallets[0];
                if (activeWalletId) {
                  const foundWallet = loadedWallets.find((w: Wallet) => w.address === activeWalletId);
                  if (foundWallet) {
                    activeWallet = foundWallet;
                  }
                }
              }
            }
          } catch (error) {
            console.error('Failed to parse wallets:', error);
          }
        }
        
        // CRITICAL: Sync encryptedWallets with loaded wallets to prevent deleted wallets from reappearing
        if (loadedWallets.length > 0) {
          try {
            const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
            if (encryptedWalletsData) {
              const encryptedWallets = typeof encryptedWalletsData === 'string' 
                ? JSON.parse(encryptedWalletsData) 
                : encryptedWalletsData;
              if (Array.isArray(encryptedWallets)) {
                const validAddresses = new Set(loadedWallets.map(w => w.address));
                const syncedEncryptedWallets = encryptedWallets.filter(
                  (w: any) => validAddresses.has(w.address)
                );
                
                // Only update if there's a difference (deleted wallets were found)
                if (syncedEncryptedWallets.length !== encryptedWallets.length) {
                  await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
                  localStorage.setItem('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
                }
              }
            }
          } catch (syncError) {
            console.error('Failed to sync encryptedWallets on startup:', syncError);
          }
        }
        
        // Set states
        setWallets(loadedWallets);
        setWallet(activeWallet);
        setIsLocked(false);
        
      } catch (error) {
        console.error('Failed to load wallet data:', error);
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
    // CRITICAL FIX: Use synchronous state updates to prevent race conditions
    if (unlockedWallets.length > 0) {
      setIsLocked(false);
      setWallets(unlockedWallets);
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
              setWallet(activeWallet);
            } else {
              await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
            }
          } else {
            await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
          }
          
          // Check for pending connection request
          const pendingRequest = await ExtensionStorageManager.get('pendingConnectionRequest');
          if (pendingRequest) {
            try {
              const connectionReq = typeof pendingRequest === 'string' 
                ? JSON.parse(pendingRequest) 
                : pendingRequest;
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
              setContractRequest(contractReq);
            } catch (error) {
              console.error('Failed to parse pending contract request after unlock:', error);
              await ExtensionStorageManager.remove('pendingContractRequest');
            }
          }
        } catch (error) {
          console.error('Error in async unlock handler:', error);
        }
      }, 0);
      
    } else {
      setIsLocked(false);
      setWallets([]);
      setWallet(null);
    }
  };

  const addWallet = async (newWallet: Wallet) => {
    try {
      // Read current wallets from storage to avoid stale state issues
      const storedWallets = await ExtensionStorageManager.get('wallets');
      let currentWallets: Wallet[] = [];
      
      if (storedWallets) {
        try {
          currentWallets = typeof storedWallets === 'string' 
            ? JSON.parse(storedWallets) 
            : storedWallets;
          if (!Array.isArray(currentWallets)) {
            currentWallets = [];
          }
        } catch (e) {
          currentWallets = [];
        }
      }
      
      // Check if wallet already exists to prevent duplicates
      const walletExists = currentWallets.some(w => w.address === newWallet.address);
      if (walletExists) {
        return;
      }
      
      const updatedWallets = [...currentWallets, newWallet];
      
      // Save to ExtensionStorageManager (chrome.storage) first
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      await ExtensionStorageManager.set('activeWalletId', newWallet.address);
      
      // Also sync to localStorage to prevent inconsistency
      localStorage.setItem('wallets', JSON.stringify(updatedWallets));
      localStorage.setItem('activeWalletId', newWallet.address);
      
      // Encrypt and store the new wallet
      await WalletManager.addEncryptedWallet(newWallet);
      
      // Update state after storage is saved
      setWallets(updatedWallets);
      setWallet(newWallet);
    } catch (error) {
      console.error('Failed to save wallet:', error);
    }
  };

  const switchWallet = async (selectedWallet: Wallet) => {
    setWallet(selectedWallet);
    
    try {
      await ExtensionStorageManager.set('activeWalletId', selectedWallet.address);
      localStorage.setItem('activeWalletId', selectedWallet.address);
    } catch (error) {
      console.error('Failed to switch wallet:', error);
    }
  };

  const removeWallet = async (walletToRemove: Wallet) => {
    try {
      // Read current wallets from storage to avoid stale state issues
      const storedWallets = await ExtensionStorageManager.get('wallets');
      let currentWallets: Wallet[] = [];
      
      if (storedWallets) {
        try {
          currentWallets = typeof storedWallets === 'string' 
            ? JSON.parse(storedWallets) 
            : storedWallets;
          if (!Array.isArray(currentWallets)) {
            currentWallets = [];
          }
        } catch (e) {
          currentWallets = [];
        }
      }
      
      // Filter out the wallet to remove from storage data
      const updatedWallets = currentWallets.filter(w => w.address !== walletToRemove.address);
      
      // Save to ExtensionStorageManager (chrome.storage) first
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      
      // Also sync to localStorage to prevent inconsistency
      localStorage.setItem('wallets', JSON.stringify(updatedWallets));
      
      // Remove from encrypted storage
      await WalletManager.removeEncryptedWallet(walletToRemove.address);
      
      // Update state after storage is saved
      setWallets(updatedWallets);
      
      if (wallet?.address === walletToRemove.address) {
        if (updatedWallets.length > 0) {
          // Switch to first remaining wallet
          setWallet(updatedWallets[0]);
          await ExtensionStorageManager.set('activeWalletId', updatedWallets[0].address);
          localStorage.setItem('activeWalletId', updatedWallets[0].address);
        } else {
          setWallet(null);
          await ExtensionStorageManager.remove('activeWalletId');
          localStorage.removeItem('activeWalletId');
        }
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

  // Show unlock screen for DApp requests when wallet is locked
  if (isLocked) {
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
  // Ensure we have a valid wallet before rendering dashboard
  if (!wallet) {
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