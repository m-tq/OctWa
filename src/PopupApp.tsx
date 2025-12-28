import { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppConnection } from './components/DAppConnection';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { SplashScreen } from './components/SplashScreen';
import { PageTransition } from './components/PageTransition';
import { Wallet, DAppConnectionRequest } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { WalletManager } from './utils/walletManager';

function PopupApp() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [isPopupMode, setIsPopupMode] = useState(true);
  const [connectionRequest, setConnectionRequest] = useState<DAppConnectionRequest | null>(null);
  const [contractRequest, setContractRequest] = useState<any>(null);

  // ONLY load data once on mount - NO dependencies to prevent loops
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log('🚀 PopupApp: loadInitialData started');
        
        // Detect if we're in popup mode
        const isPopup = window.location.pathname.includes('popup.html') || window.innerWidth <= 500;
        setIsPopupMode(isPopup);

        await ExtensionStorageManager.init();
        
        // Clear legacy sessionStorage to prevent stale data from persisting
        // This ensures auto-lock works properly when browser is restarted
        try {
          sessionStorage.removeItem('sessionWallets');
          sessionStorage.removeItem('sessionKey');
          console.log('🧹 PopupApp: Cleared legacy sessionStorage');
        } catch (e) {
          // Ignore
        }
        
        // Setup auto-lock callback
        WalletManager.setAutoLockCallback(() => {
          console.log('🔒 Auto-lock triggered, updating UI');
          setWallet(null);
          setWallets([]);
          setIsLocked(true);
        });
        
        // Check localStorage FIRST (synchronous, always available)
        const localPasswordHash = localStorage.getItem('walletPasswordHash');
        const localEncryptedWallets = localStorage.getItem('encryptedWallets');
        
        console.log('🔍 PopupApp: localStorage check:', {
          hasPasswordHash: !!localPasswordHash,
          hasEncryptedWallets: !!localEncryptedWallets
        });
        
        // CRITICAL: Sync password hash from localStorage to ExtensionStorage if missing
        const extPasswordHash = await ExtensionStorageManager.get('walletPasswordHash');
        
        if (!extPasswordHash && localPasswordHash) {
          console.log('🔄 PopupApp: Syncing password hash from localStorage to ExtensionStorage');
          const localSalt = localStorage.getItem('walletPasswordSalt');
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
        
        // Check if wallet exists (has password and encrypted wallets)
        const hasPassword = !!localPasswordHash || !!extPasswordHash;
        let hasEncryptedWallets = false;
        
        if (localEncryptedWallets) {
          try {
            const parsed = JSON.parse(localEncryptedWallets);
            hasEncryptedWallets = Array.isArray(parsed) && parsed.length > 0;
          } catch (e) {
            console.error('Failed to parse localStorage encryptedWallets:', e);
          }
        }
        
        console.log('🔍 PopupApp: Wallet state:', { hasPassword, hasEncryptedWallets });
        
        // If no wallet setup, show welcome screen
        if (!hasPassword || !hasEncryptedWallets) {
          console.log('👋 PopupApp: No wallet setup, showing welcome screen');
          setIsLocked(false);
          setIsLoading(false);
          return;
        }
        
        // Wallet exists, try to load from session storage
        // Session wallets are now ENCRYPTED, need session key to decrypt
        const sessionKey = await ExtensionStorageManager.getSession('sessionKey');
        const activeWalletId = localStorage.getItem('activeWalletId') || await ExtensionStorageManager.get('activeWalletId');
        
        console.log('🔍 PopupApp: Session check:', {
          hasSessionKey: !!sessionKey,
          activeWalletId
        });
        
        // Only try to load session wallets if session key exists
        // Session wallets are encrypted and require the session encryption key in memory
        if (sessionKey) {
          try {
            // Restore session password first (this also restores encryption key)
            const restoredPassword = await WalletManager.ensureSessionPassword();
            
            if (restoredPassword) {
              // Re-setup auto-lock callback after session restore
              WalletManager.setAutoLockCallback(() => {
                console.log('🔒 PopupApp: Auto-lock callback triggered (from session restore)!');
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now we can decrypt session wallets
              const sessionWallets = await WalletManager.getSessionWallets();
              
              if (sessionWallets.length > 0) {
                console.log('🔓 PopupApp: Loaded wallets from encrypted session storage:', sessionWallets.length);
                
                let activeWallet = sessionWallets[0];
                if (activeWalletId) {
                  const foundWallet = sessionWallets.find((w: Wallet) => w.address === activeWalletId);
                  if (foundWallet) {
                    activeWallet = foundWallet;
                  }
                }
                
                setWallets(sessionWallets);
                setWallet(activeWallet);
                setIsLocked(false);
                setIsLoading(false);
                console.log('✅ PopupApp: Dashboard ready with', sessionWallets.length, 'wallets');
                return;
              }
            }
          } catch (error) {
            console.error('Failed to restore session wallets:', error);
          }
        }
        
        // No session wallets, need to unlock to decrypt
        console.log('🔐 PopupApp: No session wallets, showing unlock screen');
        setIsLocked(true);
        setIsLoading(false);
        
      } catch (error) {
        console.error('Failed to load wallet data:', error);
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []); // NO dependencies - only run once

  // Listen for storage changes across extension contexts
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Handle wallet lock state changes - ALWAYS respond to this
      if (e.key === 'isWalletLocked') {
        const locked = e.newValue === 'true';
        console.log('🔒 PopupApp: Lock state changed via localStorage:', locked);
        setIsLocked(locked);
        
        if (locked) {
          setWallet(null);
          setWallets([]);
          WalletManager.clearSessionPassword();
        }
        return;
      }
      
      if (isLocked) return;
      
      // Handle active wallet changes - reload from session to get latest
      if (e.key === 'activeWalletId' && e.newValue) {
        console.log('🔄 PopupApp: activeWalletId changed via localStorage:', e.newValue);
        WalletManager.getSessionWallets().then(sessionWallets => {
          if (sessionWallets.length > 0) {
            const foundWallet = sessionWallets.find((w: Wallet) => w.address === e.newValue);
            if (foundWallet) {
              setWallets(sessionWallets);
              setWallet(foundWallet);
              console.log('✅ PopupApp: Synced active wallet:', foundWallet.address);
            }
          }
        });
      }
    };

    // Listen for localStorage changes
    window.addEventListener('storage', handleStorageChange);
    
    // Listen for chrome.storage changes if available
    let chromeStorageListener: ((changes: any, areaName: string) => void) | null = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chromeStorageListener = (changes: any, areaName: string) => {
        console.log('🔔 PopupApp: chrome.storage.onChanged triggered:', areaName, Object.keys(changes));
        
        // Handle lock state change - ALWAYS respond to this
        if (changes.isWalletLocked) {
          const locked = changes.isWalletLocked.newValue === 'true';
          console.log('🔒 PopupApp: Lock state changed via chrome.storage:', locked);
          setIsLocked(locked);
          
          if (locked) {
            setWallet(null);
            setWallets([]);
            WalletManager.clearSessionPassword();
          }
          return;
        }
        
        // Handle session storage changes (wallets added/removed from expanded)
        // Session wallets are now ENCRYPTED, use WalletManager to decrypt
        if (areaName === 'session' && changes.sessionWallets) {
          console.log('🔄 PopupApp: Session wallets changed, syncing...');
          // Use async IIFE since callback is not async
          (async () => {
            try {
              // IMPORTANT: First try to restore session password/encryption key
              // This handles the case where another context (expanded) just unlocked
              const restoredPassword = await WalletManager.ensureSessionPassword();
              
              if (!restoredPassword) {
                // Cannot decrypt - session is not active
                // Don't clear wallets here, let the lock state handler do it
                console.log('🔄 PopupApp: Cannot decrypt session wallets - no session password');
                return;
              }
              
              // Re-setup auto-lock callback after session restore
              WalletManager.setAutoLockCallback(() => {
                console.log('🔒 PopupApp: Auto-lock callback triggered (from sync)!');
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now decrypt session wallets
              const newWallets = await WalletManager.getSessionWallets();
              if (Array.isArray(newWallets) && newWallets.length > 0) {
                console.log('🔄 PopupApp: New wallets count:', newWallets.length);
                setWallets(newWallets);
                setIsLocked(false); // Unlock UI since we have valid session
                
                // Get current active wallet ID
                const currentActiveId = localStorage.getItem('activeWalletId');
                
                // Check if current wallet still exists in new list
                const currentWalletExists = currentActiveId && newWallets.some(w => w.address === currentActiveId);
                
                if (currentWalletExists) {
                  const updatedWallet = newWallets.find(w => w.address === currentActiveId);
                  if (updatedWallet) {
                    setWallet(updatedWallet);
                  }
                } else {
                  setWallet(newWallets[0]);
                  localStorage.setItem('activeWalletId', newWallets[0].address);
                }
              }
              // Note: Don't set wallets to [] if newWallets is empty
              // This could be a decryption failure, not actual empty wallets
            } catch (error) {
              console.error('Failed to sync session wallets:', error);
            }
          })();
          return;
        }
        
        if (isLocked) return;
        
        // Handle activeWalletId change from chrome.storage.local
        if (areaName === 'local' && changes.activeWalletId && changes.activeWalletId.newValue) {
          console.log('🔄 PopupApp: activeWalletId changed via chrome.storage:', changes.activeWalletId.newValue);
          const newActiveId = changes.activeWalletId.newValue;
          
          WalletManager.getSessionWallets().then(sessionWallets => {
            if (sessionWallets.length > 0) {
              const foundWallet = sessionWallets.find((w: Wallet) => w.address === newActiveId);
              if (foundWallet) {
                setWallets(sessionWallets);
                setWallet(foundWallet);
                localStorage.setItem('activeWalletId', newActiveId);
                console.log('✅ PopupApp: Synced active wallet from chrome.storage:', foundWallet.address);
              }
            }
          });
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
  }, [isLocked]);

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
  const handleUnlock = async (unlockedWallets: Wallet[]) => {
    console.log('🔓 PopupApp: handleUnlock called with', unlockedWallets.length, 'wallets');
    console.log('🔓 PopupApp: Wallet addresses:', unlockedWallets.map((w, i) => `[${i}] ${w.address}`));
    
    // Re-setup auto-lock callback after unlock (session password was just set)
    WalletManager.setAutoLockCallback(() => {
      console.log('🔒 PopupApp: Auto-lock callback triggered!');
      setWallet(null);
      setWallets([]);
      setIsLocked(true);
    });
    
    if (unlockedWallets.length > 0) {
      // Get active wallet FIRST before setting any state
      let activeWalletId = await ExtensionStorageManager.get('activeWalletId');
      console.log('🔓 PopupApp: activeWalletId from ExtensionStorage:', activeWalletId);
      
      // Fallback to localStorage if not in ExtensionStorage
      if (!activeWalletId) {
        activeWalletId = localStorage.getItem('activeWalletId');
        console.log('🔓 PopupApp: activeWalletId from localStorage (fallback):', activeWalletId);
      }
      
      console.log('🔓 PopupApp: Final activeWalletId:', activeWalletId);
      
      let activeWallet = unlockedWallets[0]; // Default to first wallet
      
      if (activeWalletId) {
        const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
        if (foundWallet) {
          activeWallet = foundWallet;
          console.log('🔓 PopupApp: Found active wallet:', activeWallet.address);
        } else {
          console.log('🔓 PopupApp: Active wallet not found in list, using first wallet');
          await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
          localStorage.setItem('activeWalletId', activeWallet.address);
        }
      } else {
        console.log('🔓 PopupApp: No activeWalletId stored, using first wallet');
        await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
        localStorage.setItem('activeWalletId', activeWallet.address);
      }
      
      // Now set all states together
      console.log('🔓 PopupApp: Setting wallet state to:', activeWallet.address);
      setIsLocked(false);
      setWallets(unlockedWallets);
      setWallet(activeWallet);
      
      // Handle pending requests asynchronously (non-blocking)
      setTimeout(async () => {
        try {
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
          console.error('Error checking pending requests:', error);
        }
      }, 100);
      
    } else {
      setIsLocked(false);
      setWallets([]);
      setWallet(null);
    }
  };

  const addWallet = async (newWallet: Wallet) => {
    console.log('📥 PopupApp: addWallet called with:', newWallet.address);
    try {
      // Read current wallets from session storage
      const currentWallets = await WalletManager.getSessionWallets();
      
      // Check if wallet already exists
      const walletExists = currentWallets.some(w => w.address === newWallet.address);
      
      if (walletExists) {
        console.log('✅ PopupApp: Wallet already exists, syncing state');
        setWallets(currentWallets);
        setWallet(newWallet);
        return;
      }
      
      const updatedWallets = [...currentWallets, newWallet];
      console.log('➕ PopupApp: Adding new wallet, total:', updatedWallets.length);
      
      // Update state FIRST for immediate UI feedback
      setWallets(updatedWallets);
      setWallet(newWallet);
      
      // Save active wallet ID
      await ExtensionStorageManager.set('activeWalletId', newWallet.address);
      localStorage.setItem('activeWalletId', newWallet.address);
      
      // IMPORTANT: Update session wallets FIRST (this triggers sync to other contexts)
      await WalletManager.updateSessionWallets(updatedWallets);
      
      // Then encrypt and store the new wallet
      // SECURITY: Will throw error if session password not available
      await WalletManager.addEncryptedWallet(newWallet);
      
      // Verify the wallet was stored
      const verifyEncrypted = localStorage.getItem('encryptedWallets');
      if (verifyEncrypted) {
        try {
          const parsed = JSON.parse(verifyEncrypted);
          const found = parsed.find((w: any) => w.address === newWallet.address);
          console.log('🔍 PopupApp: Verify wallet stored:', !!found, 'needsEncryption:', found?.needsEncryption);
        } catch (e) {
          console.error('Failed to verify wallet storage:', e);
        }
      }
      
      console.log('🎉 PopupApp: Wallet added successfully, total wallets:', updatedWallets.length);
    } catch (error) {
      console.error('❌ PopupApp: Failed to save wallet:', error);
    }
  };

  const switchWallet = async (selectedWallet: Wallet) => {
    console.log('🔄 PopupApp: switchWallet called, switching to:', selectedWallet.address);
    setWallet(selectedWallet);
    
    try {
      await ExtensionStorageManager.set('activeWalletId', selectedWallet.address);
      localStorage.setItem('activeWalletId', selectedWallet.address);
      console.log('✅ PopupApp: activeWalletId saved to both storages:', selectedWallet.address);
      
      // Verify it was saved
      const verifyExt = await ExtensionStorageManager.get('activeWalletId');
      const verifyLocal = localStorage.getItem('activeWalletId');
      console.log('🔍 PopupApp: Verify - ExtensionStorage:', verifyExt, ', localStorage:', verifyLocal);
    } catch (error) {
      console.error('Failed to switch wallet:', error);
    }
  };

  const removeWallet = async (walletToRemove: Wallet) => {
    try {
      // Filter out the wallet to remove from current state
      const updatedWallets = wallets.filter(w => w.address !== walletToRemove.address);
      
      // Remove from encrypted storage (this also updates session storage)
      await WalletManager.removeEncryptedWallet(walletToRemove.address);
      
      // Update state
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

  // Show splash screen first (shorter duration for popup)
  if (showSplash) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] overflow-hidden">
          <SplashScreen onComplete={() => setShowSplash(false)} />
        </div>
      </ThemeProvider>
    );
  }

  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background flex items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center space-y-3">
            <div
              className="w-8 h-8 rounded-full border-3 border-transparent animate-spin"
              style={{ borderTopColor: '#0000db', borderRightColor: '#0000db' }}
            />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  // Show unlock screen for DApp requests when wallet is locked
  if (isLocked) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto">
            <PageTransition variant="fade-slide">
              <UnlockWallet onUnlock={handleUnlock} />
            </PageTransition>
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
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto">
            <PageTransition variant="scale">
              <DAppConnection
                connectionRequest={connectionRequest}
                wallets={wallets}
                selectedWallet={wallet}
                onWalletSelect={setWallet}
                onApprove={handleConnectionApprove}
                onReject={handleConnectionReject}
              />
            </PageTransition>
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
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto">
            <PageTransition variant="scale">
              <DAppRequestHandler 
                wallets={wallets}
                contractRequest={contractRequest}
                selectedWallet={connectedWallet || wallet}
                onWalletSelect={setWallet}
                onApprove={handleContractApprove}
                onReject={handleContractReject}
              />
            </PageTransition>
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
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto">
            <PageTransition variant="fade-slide">
              <WelcomeScreen onWalletCreated={addWallet} />
            </PageTransition>
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
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto flex items-center justify-center">
            <div className="text-center">
              <div
                className="w-8 h-8 mx-auto rounded-full border-3 border-transparent animate-spin mb-3"
                style={{ borderTopColor: '#0000db', borderRightColor: '#0000db' }}
              />
              <div className="text-sm text-muted-foreground">Loading wallet...</div>
            </div>
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }
  
  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="w-[400px] h-[600px] bg-background popup-view relative flex flex-col overflow-hidden">
        <div className="popup-container flex-1 overflow-hidden">
          <PageTransition variant="fade">
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
          </PageTransition>
        </div>
        <Toaster />
      </div>
    </ThemeProvider>
  );
}

export default PopupApp;
