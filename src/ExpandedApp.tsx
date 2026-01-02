import { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { SplashScreen } from './components/SplashScreen';
import { PageTransition } from './components/PageTransition';
import { Wallet } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { WalletManager } from './utils/walletManager';

function ExpandedApp() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [showSetupSplash, setShowSetupSplash] = useState(false);
  const [pendingSetupWallet, setPendingSetupWallet] = useState<Wallet | null>(null);
  const [isDAppRequest, setIsDAppRequest] = useState(false);

  // Check if this is a dApp request
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    setIsDAppRequest(action === 'connect' || action === 'transaction' || action === 'contract');
  }, []);

  // ONLY load data once on mount - NO dependencies to prevent loops
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log('🚀 ExpandedApp: loadInitialData started');
        
        await ExtensionStorageManager.init();
        
        // Clear legacy sessionStorage to prevent stale data from persisting
        // This ensures auto-lock works properly when browser is restarted
        try {
          sessionStorage.removeItem('sessionWallets');
          sessionStorage.removeItem('sessionKey');
          console.log('🧹 ExpandedApp: Cleared legacy sessionStorage');
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
        
        console.log('🔍 ExpandedApp: localStorage check:', {
          hasPasswordHash: !!localPasswordHash,
          hasEncryptedWallets: !!localEncryptedWallets
        });
        
        // CRITICAL: Sync password hash from localStorage to ExtensionStorage if missing
        const extPasswordHash = await ExtensionStorageManager.get('walletPasswordHash');
        
        if (!extPasswordHash && localPasswordHash) {
          console.log('🔄 ExpandedApp: Syncing password hash from localStorage to ExtensionStorage');
          const localSalt = localStorage.getItem('walletPasswordSalt');
          const localIsLocked = localStorage.getItem('isWalletLocked');
          
          await ExtensionStorageManager.set('walletPasswordHash', localPasswordHash);
          if (localSalt) await ExtensionStorageManager.set('walletPasswordSalt', localSalt);
          if (localEncryptedWallets) await ExtensionStorageManager.set('encryptedWallets', localEncryptedWallets);
          if (localIsLocked) await ExtensionStorageManager.set('isWalletLocked', localIsLocked);
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
        
        console.log('🔍 ExpandedApp: Wallet state:', { hasPassword, hasEncryptedWallets });
        
        // If no wallet setup, show welcome screen
        if (!hasPassword || !hasEncryptedWallets) {
          console.log('👋 ExpandedApp: No wallet setup, showing welcome screen');
          setIsLocked(false);
          setIsLoading(false);
          return;
        }
        
        // Wallet exists, try to load from session storage
        // Session wallets are now ENCRYPTED, need session key to decrypt
        const sessionKey = await ExtensionStorageManager.getSession('sessionKey');
        const activeWalletId = localStorage.getItem('activeWalletId') || await ExtensionStorageManager.get('activeWalletId');
        
        console.log('🔍 ExpandedApp: Session check:', {
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
                console.log('🔒 ExpandedApp: Auto-lock callback triggered (from session restore)!');
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now we can decrypt session wallets
              const sessionWallets = await WalletManager.getSessionWallets();
              
              if (sessionWallets.length > 0) {
                console.log('🔓 ExpandedApp: Loaded wallets from encrypted session storage:', sessionWallets.length);
                
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
                console.log('✅ ExpandedApp: Dashboard ready with', sessionWallets.length, 'wallets');
                return;
              }
            }
          } catch (error) {
            console.error('Failed to restore session wallets:', error);
          }
        }
        
        // No session wallets, need to unlock to decrypt
        console.log('🔐 ExpandedApp: No session wallets, showing unlock screen');
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
        console.log('🔒 ExpandedApp: Lock state changed via localStorage:', locked);
        setIsLocked(locked);
        
        if (locked) {
          setWallet(null);
          setWallets([]);
          WalletManager.clearSessionPassword();
        }
        return;
      }
      
      if (isLocked) return; // Don't update other things if locked
      
      // Handle active wallet changes - need to reload from session to get latest wallets
      if (e.key === 'activeWalletId' && e.newValue) {
        console.log('🔄 ExpandedApp: activeWalletId changed via localStorage:', e.newValue);
        // Reload wallets from session storage to ensure we have the latest
        WalletManager.getSessionWallets().then(sessionWallets => {
          if (sessionWallets.length > 0) {
            const foundWallet = sessionWallets.find((w: Wallet) => w.address === e.newValue);
            if (foundWallet) {
              setWallets(sessionWallets);
              setWallet(foundWallet);
              console.log('✅ ExpandedApp: Synced active wallet:', foundWallet.address);
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
        console.log('🔔 ExpandedApp: chrome.storage.onChanged triggered:', areaName, Object.keys(changes));
        
        // Handle lock state change - ALWAYS respond to this
        if (changes.isWalletLocked) {
          const locked = changes.isWalletLocked.newValue === 'true';
          console.log('🔒 ExpandedApp: Lock state changed via chrome.storage:', locked);
          setIsLocked(locked);
          
          if (locked) {
            setWallet(null);
            setWallets([]);
            WalletManager.clearSessionPassword();
          }
        }
        
        // Handle session storage changes (wallets added/removed from popup)
        // Session wallets are now ENCRYPTED, use WalletManager to decrypt
        if (areaName === 'session' && changes.sessionWallets) {
          console.log('🔄 ExpandedApp: Session wallets changed, syncing...');
          // Use async IIFE since callback is not async
          (async () => {
            try {
              // IMPORTANT: First try to restore session password/encryption key
              // This handles the case where another context (popup) just unlocked
              const restoredPassword = await WalletManager.ensureSessionPassword();
              
              if (!restoredPassword) {
                // Cannot decrypt - session is not active
                // Don't clear wallets here, let the lock state handler do it
                console.log('🔄 ExpandedApp: Cannot decrypt session wallets - no session password');
                return;
              }
              
              // Re-setup auto-lock callback after session restore
              WalletManager.setAutoLockCallback(() => {
                console.log('🔒 ExpandedApp: Auto-lock callback triggered (from sync)!');
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now decrypt session wallets
              const newWallets = await WalletManager.getSessionWallets();
              if (Array.isArray(newWallets) && newWallets.length > 0) {
                console.log('🔄 ExpandedApp: New wallets count:', newWallets.length);
                setWallets(newWallets);
                setIsLocked(false); // Unlock UI since we have valid session
                
                // Get current active wallet ID
                const currentActiveId = localStorage.getItem('activeWalletId');
                
                // Check if current wallet still exists in new list
                const currentWalletExists = currentActiveId && newWallets.some(w => w.address === currentActiveId);
                
                if (currentWalletExists) {
                  // Keep current wallet but update from new list (in case data changed)
                  const updatedWallet = newWallets.find(w => w.address === currentActiveId);
                  if (updatedWallet) {
                    setWallet(updatedWallet);
                  }
                } else {
                  // Current wallet doesn't exist, switch to first
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
          console.log('🔄 ExpandedApp: activeWalletId changed via chrome.storage:', changes.activeWalletId.newValue);
          const newActiveId = changes.activeWalletId.newValue;
          
          // Reload wallets from session storage to ensure we have the latest
          WalletManager.getSessionWallets().then(sessionWallets => {
            if (sessionWallets.length > 0) {
              const foundWallet = sessionWallets.find((w: Wallet) => w.address === newActiveId);
              if (foundWallet) {
                setWallets(sessionWallets);
                setWallet(foundWallet);
                localStorage.setItem('activeWalletId', newActiveId);
                console.log('✅ ExpandedApp: Synced active wallet from chrome.storage:', foundWallet.address);
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
  }, [isLocked]); // Only depend on isLocked - wallets/wallet are accessed via session storage

  // Simple unlock handler
  const handleUnlock = async (unlockedWallets: Wallet[]) => {
    console.log('🔓 ExpandedApp: handleUnlock called with', unlockedWallets.length, 'wallets');
    
    // Re-setup auto-lock callback after unlock (session password was just set)
    WalletManager.setAutoLockCallback(() => {
      console.log('🔒 ExpandedApp: Auto-lock callback triggered!');
      setWallet(null);
      setWallets([]);
      setIsLocked(true);
    });
    
    if (unlockedWallets.length > 0) {
      setWallets(unlockedWallets);
      setIsLocked(false);
      
      // Set active wallet - prioritize stored activeWalletId from ExtensionStorage, fallback to first wallet
      const activeWalletId = await ExtensionStorageManager.get('activeWalletId') || localStorage.getItem('activeWalletId');
      let activeWallet = unlockedWallets[0];
      
      if (activeWalletId) {
        const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
        if (foundWallet) {
          activeWallet = foundWallet;
        } else {
          localStorage.setItem('activeWalletId', activeWallet.address);
          await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
        }
      } else {
        localStorage.setItem('activeWalletId', activeWallet.address);
        await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
      }
      
      setWallet(activeWallet);
    } else {
      setWallets([]);
      setWallet(null);
      setIsLocked(false);
    }
  };

  const addWallet = async (newWallet: Wallet) => {
    console.log('📥 ExpandedApp: addWallet called with:', newWallet.address);
    try {
      // Read current wallets from session storage (shared across popup/expanded)
      const currentWallets = await WalletManager.getSessionWallets();
      
      // Check if wallet already exists
      const walletExists = currentWallets.some(w => w.address === newWallet.address);
      
      if (walletExists) {
        console.log('✅ ExpandedApp: Wallet already exists, syncing state');
        setWallets(currentWallets);
        setWallet(newWallet);
        return;
      }
      
      const updatedWallets = [...currentWallets, newWallet];
      console.log('➕ ExpandedApp: Adding new wallet, total:', updatedWallets.length);
      
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
          console.log('🔍 ExpandedApp: Verify wallet stored:', !!found, 'needsEncryption:', found?.needsEncryption);
        } catch (e) {
          console.error('Failed to verify wallet storage:', e);
        }
      }
      
      console.log('🎉 ExpandedApp: Wallet added successfully, total wallets:', updatedWallets.length);
    } catch (error) {
      console.error('❌ ExpandedApp: Failed to save wallet:', error);
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

  // Show splash screen first
  if (showSplash) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <SplashScreen onComplete={() => setShowSplash(false)} isPopupMode={false} />
      </ThemeProvider>
    );
  }

  // Show splash screen after wallet setup
  if (showSetupSplash && pendingSetupWallet) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <SplashScreen 
          onComplete={async () => {
            console.log('🎯 ExpandedApp: Setup splash complete');
            setShowSetupSplash(false);
            
            // Read wallets from session storage
            const sessionWallets = await WalletManager.getSessionWallets();
            const walletsFromStorage: Wallet[] = sessionWallets.length > 0 ? sessionWallets : [pendingSetupWallet];
            
            setWallets(walletsFromStorage);
            setWallet(pendingSetupWallet);
            setPendingSetupWallet(null);
          }} 
          duration={3500}
          isPopupMode={false}
        />
      </ThemeProvider>
    );
  }

  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center space-y-4">
            <div
              className="w-10 h-10 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: '#0000db', borderRightColor: '#0000db' }}
            />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if (isLocked) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background overflow-hidden">
          <PageTransition variant="fade-slide">
            <UnlockWallet onUnlock={handleUnlock} isPopupMode={false} />
          </PageTransition>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Handle dApp requests
  if (isDAppRequest) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background overflow-hidden">
          <PageTransition variant="scale">
            <DAppRequestHandler wallets={wallets} />
          </PageTransition>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="min-h-screen bg-background expanded-view">
        {!wallet ? (
          <WelcomeScreen 
            onWalletCreated={(w) => {
              console.log('🎯 ExpandedApp: onWalletCreated - showing setup splash');
              setPendingSetupWallet(w);
              setShowSetupSplash(true);
            }} 
          />
        ) : (
          <WalletDashboard 
            wallet={wallet} 
            wallets={wallets}
            onDisconnect={disconnectWallet}
            onSwitchWallet={switchWallet}
            onAddWallet={addWallet}
            onRemoveWallet={removeWallet}
          />
        )}
        <Toaster />
      </div>
    </ThemeProvider>
  );
}

export default ExpandedApp;