import { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { SplashScreen } from './components/SplashScreen';
import { PageTransition } from './components/PageTransition';
import { WalletManager } from './utils/walletManager';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { Wallet } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';

function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [showSetupSplash, setShowSetupSplash] = useState(false);
  const [pendingSetupWallet, setPendingSetupWallet] = useState<Wallet | null>(null);
  const [connectionRequest, setConnectionRequest] = useState<any>(null);
  const [capabilityRequest, setCapabilityRequest] = useState<any>(null);
  const [invokeRequest, setInvokeRequest] = useState<any>(null);

  // Check for connection request in URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    
    if (action === 'connect') {
      const origin = urlParams.get('origin');
      const appName = urlParams.get('appName');
      const appIcon = urlParams.get('appIcon');
      const permissions = urlParams.get('permissions');
      
      if (origin && permissions) {
        setConnectionRequest({
          origin: decodeURIComponent(origin),
          appName: decodeURIComponent(appName || ''),
          appIcon: decodeURIComponent(appName || ''),
          permissions: JSON.parse(decodeURIComponent(permissions))
        });
      }
    }
    
    // Check for capability request
    if (action === 'capability') {
      const circle = urlParams.get('circle');
      const methods = urlParams.get('methods');
      const scope = urlParams.get('scope');
      if (circle && methods && scope) {
        setCapabilityRequest({
          circle: decodeURIComponent(circle),
          methods: JSON.parse(decodeURIComponent(methods)),
          scope: decodeURIComponent(scope),
          encrypted: urlParams.get('encrypted') === 'true',
          appOrigin: urlParams.get('appOrigin') ? decodeURIComponent(urlParams.get('appOrigin')!) : window.location.origin
        });
      }
    }
    
    // Check for invoke request
    if (action === 'invoke') {
      const capabilityId = urlParams.get('capabilityId');
      const method = urlParams.get('method');
      if (capabilityId && method) {
        setInvokeRequest({
          capabilityId: decodeURIComponent(capabilityId),
          method: decodeURIComponent(method)
        });
      }
    }
    
    // Also check chrome.storage for pending requests
    const checkPendingRequests = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const pending = await chrome.storage.local.get([
          'pendingCapabilityRequest',
          'pendingInvokeRequest'
        ]);
        
        if (pending.pendingCapabilityRequest) {
          console.log('🔐 App.tsx: Found pending capability request');
          setCapabilityRequest(pending.pendingCapabilityRequest);
        }
        
        if (pending.pendingInvokeRequest) {
          console.log('⚡ App.tsx: Found pending invoke request');
          setInvokeRequest(pending.pendingInvokeRequest);
        }
      }
    };
    
    checkPendingRequests();
  }, []);

  // ONLY load data once on mount - THIS MUST RUN FIRST
  useEffect(() => {
    console.log('🚀 App.tsx: useEffect for loadInitialData triggered');
    
    const loadInitialData = async () => {
      console.log('🚀 App.tsx: loadInitialData function started');
      
      try {
        await ExtensionStorageManager.init();
        console.log('🚀 App.tsx: ExtensionStorageManager.init() completed');
        
        // Clear legacy sessionStorage to prevent stale data from persisting
        // This ensures auto-lock works properly when browser is restarted
        try {
          sessionStorage.removeItem('sessionWallets');
          sessionStorage.removeItem('sessionKey');
          console.log('🧹 App.tsx: Cleared legacy sessionStorage');
        } catch (e) {
          // Ignore
        }
        
        // Sync rpcProviders to chrome.storage.local for background script access
        const rpcProviders = localStorage.getItem('rpcProviders');
        if (rpcProviders && typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ rpcProviders }).catch(err => {
            console.warn('Failed to sync rpcProviders to chrome.storage:', err);
          });
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
        
        console.log('🔍 App.tsx: localStorage check:', {
          hasPasswordHash: !!localPasswordHash,
          hasEncryptedWallets: !!localEncryptedWallets,
          passwordHashLength: localPasswordHash?.length,
          encryptedWalletsLength: localEncryptedWallets?.length
        });
        
        // CRITICAL: Sync password hash from localStorage to ExtensionStorage if missing
        const extPasswordHash = await ExtensionStorageManager.get('walletPasswordHash');
        console.log('🔍 App.tsx: ExtensionStorage passwordHash exists:', !!extPasswordHash);
        
        if (!extPasswordHash && localPasswordHash) {
          console.log('🔄 App.tsx: Syncing password hash from localStorage to ExtensionStorage');
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
        let encryptedWalletsCount = 0;
        
        if (localEncryptedWallets) {
          try {
            const parsed = JSON.parse(localEncryptedWallets);
            hasEncryptedWallets = Array.isArray(parsed) && parsed.length > 0;
            encryptedWalletsCount = Array.isArray(parsed) ? parsed.length : 0;
          } catch (e) {
            console.error('Failed to parse localStorage encryptedWallets:', e);
          }
        }
        
        console.log('🔍 App.tsx: Wallet state:', { hasPassword, hasEncryptedWallets, encryptedWalletsCount });
        
        // If no wallet setup, show welcome screen
        if (!hasPassword || !hasEncryptedWallets) {
          console.log('👋 App.tsx: No wallet setup, showing welcome screen');
          console.log('👋 App.tsx: Reason - hasPassword:', hasPassword, ', hasEncryptedWallets:', hasEncryptedWallets);
          setIsLocked(false);
          setIsLoading(false);
          return;
        }
        
        // Wallet exists, try to load from session storage
        // Session wallets are now ENCRYPTED, need session key to decrypt
        const sessionKey = await ExtensionStorageManager.getSession('sessionKey');
        const activeWalletId = localStorage.getItem('activeWalletId') || await ExtensionStorageManager.get('activeWalletId');
        
        console.log('🔍 App.tsx: Session check:', {
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
              // Now we can decrypt session wallets
              const sessionWallets = await WalletManager.getSessionWallets();
              
              if (sessionWallets.length > 0) {
                console.log('🔓 App.tsx: Loaded wallets from encrypted session storage:', sessionWallets.length);
                
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
                console.log('✅ App.tsx: Dashboard ready with', sessionWallets.length, 'wallets');
                return;
              }
            }
          } catch (error) {
            console.error('Failed to restore session wallets:', error);
          }
        }
        
        // No session wallets or failed to decrypt, need to unlock
        console.log('🔐 App.tsx: No session wallets, showing unlock screen');
        setIsLocked(true);
        setIsLoading(false);
        
      } catch (error) {
        console.error('❌ App.tsx: Failed to load wallet data:', error);
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Listen for storage changes across tabs - AFTER initial load
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Handle wallet lock state changes
      if (e.key === 'isWalletLocked') {
        const locked = e.newValue === 'true';
        console.log('🔒 App.tsx: Lock state changed via localStorage:', locked);
        setIsLocked(locked);
        
        if (locked) {
          setWallet(null);
          setWallets([]);
          WalletManager.clearSessionPassword();
        }
        return;
      }
      
      if (isLocked) return;
      
      // Handle active wallet changes - need to reload from session to get latest wallets
      if (e.key === 'activeWalletId' && e.newValue) {
        console.log('🔄 App.tsx: activeWalletId changed via localStorage:', e.newValue);
        // Reload wallets from session storage to ensure we have the latest
        WalletManager.getSessionWallets().then(sessionWallets => {
          if (sessionWallets.length > 0) {
            const foundWallet = sessionWallets.find((w: Wallet) => w.address === e.newValue);
            if (foundWallet) {
              setWallets(sessionWallets);
              setWallet(foundWallet);
              console.log('✅ App.tsx: Synced active wallet:', foundWallet.address);
            }
          }
        });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Listen for chrome.storage changes if available
    let chromeStorageListener: ((changes: any, areaName: string) => void) | null = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chromeStorageListener = (changes: any, areaName: string) => {
        console.log('🔔 App.tsx: chrome.storage.onChanged triggered:', areaName, Object.keys(changes));
        
        // Handle lock state change
        if (changes.isWalletLocked) {
          const locked = changes.isWalletLocked.newValue === 'true';
          console.log('🔒 App.tsx: Lock state changed via chrome.storage:', locked);
          setIsLocked(locked);
          
          if (locked) {
            setWallet(null);
            setWallets([]);
            WalletManager.clearSessionPassword();
          }
          return;
        }
        
        // Handle session storage changes (wallets added/removed from popup)
        // Session wallets are now ENCRYPTED, use WalletManager to decrypt
        if (areaName === 'session' && changes.sessionWallets) {
          console.log('🔄 App.tsx: Session wallets changed, syncing...');
          // Use async IIFE since callback is not async
          (async () => {
            try {
              // IMPORTANT: First try to restore session password/encryption key
              // This handles the case where another context (popup) just unlocked
              const restoredPassword = await WalletManager.ensureSessionPassword();
              
              if (!restoredPassword) {
                // Cannot decrypt - session is not active
                // Don't clear wallets here, let the lock state handler do it
                console.log('🔄 App.tsx: Cannot decrypt session wallets - no session password');
                return;
              }
              
              // Re-setup auto-lock callback after session restore
              WalletManager.setAutoLockCallback(() => {
                console.log('🔒 App.tsx: Auto-lock callback triggered (from sync)!');
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now decrypt session wallets
              const newWallets = await WalletManager.getSessionWallets();
              if (Array.isArray(newWallets) && newWallets.length > 0) {
                console.log('🔄 App.tsx: New wallets count:', newWallets.length);
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
          console.log('🔄 App.tsx: activeWalletId changed via chrome.storage:', changes.activeWalletId.newValue);
          const newActiveId = changes.activeWalletId.newValue;
          
          // Reload wallets from session storage to ensure we have the latest
          WalletManager.getSessionWallets().then(sessionWallets => {
            if (sessionWallets.length > 0) {
              const foundWallet = sessionWallets.find((w: Wallet) => w.address === newActiveId);
              if (foundWallet) {
                setWallets(sessionWallets);
                setWallet(foundWallet);
                localStorage.setItem('activeWalletId', newActiveId);
                console.log('✅ App.tsx: Synced active wallet from chrome.storage:', foundWallet.address);
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

  const handleUnlock = async (unlockedWallets: Wallet[]) => {
    console.log('🔓 App.tsx: handleUnlock called with', unlockedWallets.length, 'wallets');
    
    // Re-setup auto-lock callback after unlock
    WalletManager.setAutoLockCallback(() => {
      console.log('🔒 App.tsx: Auto-lock callback triggered!');
      setWallet(null);
      setWallets([]);
      setIsLocked(true);
    });
    
    if (unlockedWallets.length > 0) {
      setWallets(unlockedWallets);
      setIsLocked(false);
      
      const activeWalletId = localStorage.getItem('activeWalletId') || await ExtensionStorageManager.get('activeWalletId');
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
    console.log('📥 App.tsx addWallet called with:', newWallet.address);
    try {
      // Read current wallets from session storage
      const currentWallets = await WalletManager.getSessionWallets();
      
      // Check if wallet already exists
      const walletExists = currentWallets.some(w => w.address === newWallet.address);
      
      if (walletExists) {
        console.log('✅ App.tsx: Wallet already exists, syncing state');
        setWallets(currentWallets);
        setWallet(newWallet);
        return;
      }
      
      const updatedWallets = [...currentWallets, newWallet];
      console.log('➕ App.tsx: Adding new wallet, total:', updatedWallets.length);
      
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
          console.log('🔍 App.tsx: Verify wallet stored:', !!found, 'needsEncryption:', found?.needsEncryption);
        } catch (e) {
          console.error('Failed to verify wallet storage:', e);
        }
      }
      
      console.log('🎉 App.tsx: Wallet added successfully, total wallets:', updatedWallets.length);
    } catch (error) {
      console.error('❌ App.tsx: Failed to add wallet:', error);
    }
  };

  const switchWallet = async (selectedWallet: Wallet) => {
    setWallet(selectedWallet);
    // Save to both localStorage and ExtensionStorage for persistence
    localStorage.setItem('activeWalletId', selectedWallet.address);
    await ExtensionStorageManager.set('activeWalletId', selectedWallet.address);
  };

  const removeWallet = async (walletToRemove: Wallet) => {
    try {
      // Filter out the wallet to remove from current state
      const updatedWallets = wallets.filter(w => w.address !== walletToRemove.address);
      
      // Remove from encrypted storage
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

  const reorderWallets = async (newOrder: Wallet[]) => {
    try {
      // Update state immediately for UI feedback
      setWallets(newOrder);
      
      // Persist the new order
      await WalletManager.reorderWallets(newOrder);
      
      console.log('🔄 App: Wallets reordered successfully');
    } catch (error) {
      console.error('Failed to reorder wallets:', error);
    }
  };

  const disconnectWallet = () => {
    // Lock the wallet properly using WalletManager
    WalletManager.lockWallets();
    
    // Clear UI state
    setWallet(null);
    setWallets([]);
    setIsLocked(true);
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
          onComplete={() => {
            console.log('🎨 App.tsx: Setup splash complete, calling addWallet');
            setShowSetupSplash(false);
            addWallet(pendingSetupWallet);
            setPendingSetupWallet(null);
          }} 
          duration={3500}
          isPopupMode={false}
        />
      </ThemeProvider>
    );
  }

  // Show loading state
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

  // Show connection approval if there's a connection request
  if (connectionRequest && wallets.length > 0 && !isLocked) {
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

  // Show capability approval if there's a capability request
  if (capabilityRequest && wallets.length > 0 && !isLocked) {
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

  // Show invoke approval if there's an invoke request
  if (invokeRequest && wallets.length > 0 && !isLocked) {
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

  // Show unlock screen if wallet is locked
  if (isLocked) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background overflow-hidden">
          <PageTransition variant="fade-slide">
            <UnlockWallet onUnlock={handleUnlock} />
          </PageTransition>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="min-h-screen bg-background">
        {!wallet ? (
          <WelcomeScreen 
            onWalletCreated={(w) => {
              console.log('🎨 App.tsx: onWalletCreated - showing setup splash');
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
            onReorderWallets={reorderWallets}
          />
        )}
        <Toaster />
      </div>
    </ThemeProvider>
  );
}

export default App;