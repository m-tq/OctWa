import { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { PageTransition } from './components/PageTransition';
import { Wallet } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { WalletManager } from './utils/walletManager';
import { syncOnsConfigFromActiveProvider } from './utils/onsBootstrap';
import { useBackgroundDecryptResponder } from './hooks/useBackgroundDecryptResponder';
import { useBackgroundSyncResponder } from './hooks/useBackgroundSyncResponder';

function PopupApp() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Respond to BG_DECRYPT_BALANCE_REQUEST messages from the service worker
  // so dApps that call octra_getEncryptedBalance get a populated
  // `decryptedAmount` whenever the popup is open.
  useBackgroundDecryptResponder(wallets);
  useBackgroundSyncResponder(wallets);
  // Only show splash on very first open (no stored wallet data) to avoid
  // a 1.5 s delay every time the popup is opened.
  const [isPopupMode, setIsPopupMode] = useState(true);
  /**
   * True when any RFC-O-1 dApp request is pending (connect, sign, tx,
   * contract, encrypt/decrypt, stealth, claim, sensitive write).
   * Triggers DAppRequestHandler to render the appropriate approval UI.
   */
  const [hasDAppRequest, setHasDAppRequest] = useState(false);
  /**
   * True when the background service worker has a pending PVAC auto-execute
   * request (identity / ECDH / decrypt / encrypt / scan). These never show a
   * UI prompt — the DAppRequestHandler handles them silently — but the popup
   * still needs to mount DAppRequestHandler so its storage listener fires.
   */
  const [hasPvacRequest, setHasPvacRequest] = useState(false);
  const { toast: _toast } = useToast();

  // ONLY load data once on mount - NO dependencies to prevent loops
  useEffect(() => {
    const loadInitialData = async () => {
      try {

        // Detect if we're in popup mode
        const isPopup = window.location.pathname.includes('popup.html') || window.innerWidth <= 500;
        setIsPopupMode(isPopup);

        await ExtensionStorageManager.init();

        // Keep the ONS resolver pointed at the user's active RPC provider.
        // Without this, domain-name inputs in popup mode stay unresolved
        // because the resolver is still pointed at its default config.
        syncOnsConfigFromActiveProvider();
        
        // Clear legacy sessionStorage to prevent stale data from persisting
        // This ensures auto-lock works properly when browser is restarted
        try {
          sessionStorage.removeItem('sessionWallets');
          sessionStorage.removeItem('sessionKey');
          
        } catch (e) {
          // Ignore
        }
        
        // Setup auto-lock callback
        WalletManager.setAutoLockCallback(() => {
          
          setWallet(null);
          setWallets([]);
          setIsLocked(true);
        });
        
        // Check localStorage FIRST (synchronous, always available)
        const localPasswordHash = localStorage.getItem('walletPasswordHash');
        const localEncryptedWallets = localStorage.getItem('encryptedWallets');

        // CRITICAL: Sync password hash from localStorage to ExtensionStorage if missing
        const extPasswordHash = await ExtensionStorageManager.get('walletPasswordHash');
        
        if (!extPasswordHash && localPasswordHash) {
          
          const localSalt = localStorage.getItem('walletPasswordSalt');
          const localIsLocked = localStorage.getItem('isWalletLocked');
          
          await ExtensionStorageManager.set('walletPasswordHash', localPasswordHash);
          if (localSalt) await ExtensionStorageManager.set('walletPasswordSalt', localSalt);
          if (localEncryptedWallets) await ExtensionStorageManager.set('encryptedWallets', localEncryptedWallets);
          if (localIsLocked) await ExtensionStorageManager.set('isWalletLocked', localIsLocked);
        }
        
        // ── Resolve pending dApp requests ─────────────────────────────────────
        // Background writes pending<Type>RequestKey + pending<Type>Request_<key>.
        // DAppRequestHandler reads the actual data; we just need to flag presence.

        // ── Detect pending RFC-O-1 dApp requests ──────────────────────────────
        // Background writes pending<Type>RequestKey when a request is staged.
        // DAppRequestHandler handles loading the actual request data internally.
        try {
          const dappKeyNames = [
            'pendingConnectRequestKey',
            'pendingSignRequestKey',
            'pendingTxRequestKey',
            'pendingSignTxRequestKey',
            'pendingContractRequestKey',
            'pendingEncryptRequestKey',
            'pendingDecryptRequestKey',
            'pendingStealthRequestKey',
            'pendingClaimRequestKey',
            'pendingSensitiveWriteKey',
            'pendingEvmTxRequestKey',
            'pendingEvmSignRequestKey',
            'pendingEvmTypedDataRequestKey',
            'pendingEvmTokenRequestKey',
            'pendingEvmApproveRequestKey',
            'pendingEvmSwitchRequestKey',
            'pendingSwitchNetworkRequestKey',
          ];
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const raw = await chrome.storage.local.get(dappKeyNames);
            if (dappKeyNames.some(k => !!raw[k])) setHasDAppRequest(true);
          }
        } catch (error) {
          console.error('Failed to probe pending dApp requests:', error);
        }

        // Check for pending PVAC auto-execute or ZK-sign requests. These do not
        // carry their own UI — DAppRequestHandler runs them silently — but the
        // handler must be mounted for its storage listeners to fire.
        try {
          const pvacKeyNames = [
            'pendingPvacIdentityKey',
            'pendingPvacEcdhKey',
            'pendingPvacDecryptKey',
            'pendingPvacEncryptKey',
            'pendingPvacScanKey',
            'pendingPvacZkSignKey',
          ];
          let anyPending = false;
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const raw = await chrome.storage.local.get(pvacKeyNames);
            anyPending = pvacKeyNames.some(k => !!raw[k]);
          } else {
            for (const k of pvacKeyNames) {
              // eslint-disable-next-line no-await-in-loop
              const v = await ExtensionStorageManager.get(k);
              if (v) { anyPending = true; break; }
            }
          }
          if (anyPending) setHasPvacRequest(true);
        } catch (error) {
          console.error('Failed to probe pending PVAC requests:', error);
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

        // If no wallet setup, go straight to welcome screen — no splash.
        if (!hasPassword || !hasEncryptedWallets) {
          setIsLocked(false);
          setIsLoading(false);
          return;
        }
        
        // Wallet exists, try to load from session storage
        // Session wallets are now ENCRYPTED, need session key to decrypt
        const sessionKey = await ExtensionStorageManager.getSession('sessionKey');
        const activeWalletId = localStorage.getItem('activeWalletId') || await ExtensionStorageManager.get('activeWalletId');

        // Only try to load session wallets if session key exists
        // Session wallets are encrypted and require the session encryption key in memory
        if (sessionKey) {
          // FIX #3: Add retry mechanism for session restore
          let retryCount = 0;
          const maxRetries = 3;
          const retryDelay = 500; // ms
          
          while (retryCount < maxRetries) {
            try {
              // Restore session password first (this also restores encryption key)
              const restoredPassword = await WalletManager.ensureSessionPassword();
              
              if (restoredPassword) {
                // Re-setup auto-lock callback after session restore
                WalletManager.setAutoLockCallback(() => {
                  
                  setWallet(null);
                  setWallets([]);
                  setIsLocked(true);
                });
                
                // Now we can decrypt session wallets
                const sessionWallets = await WalletManager.getSessionWallets();
                
                if (sessionWallets.length > 0) {

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
                  
                  return;
                }
              }
              break; // Success or no password, exit retry loop
            } catch (error) {
              retryCount++;
              console.error(`Failed to restore session wallets (attempt ${retryCount}/${maxRetries}):`, error);
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount));
              }
            }
          }
        }
        
        // No session wallets, need to unlock to decrypt
        
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
        
        setIsLocked(locked);
        
        if (locked) {
          setWallet(null);
          setWallets([]);
          WalletManager.clearSessionPassword();
        }
        return;
      }

      // When the user swaps RPC providers, repoint the ONS resolver so
      // subsequent name lookups use the new network.
      if (e.key === 'rpcProviders' || e.key === 'activeRpcProvider') {
        syncOnsConfigFromActiveProvider();
      }
      
      if (isLocked) return;
      
      // Handle active wallet changes - reload from session to get latest
      if (e.key === 'activeWalletId' && e.newValue) {
        
        WalletManager.getSessionWallets().then(sessionWallets => {
          if (sessionWallets.length > 0) {
            const foundWallet = sessionWallets.find((w: Wallet) => w.address === e.newValue);
            if (foundWallet) {
              setWallets(sessionWallets);
              setWallet(foundWallet);
              
            }
          }
        });
      }
    };

    // Listen for localStorage changes
    window.addEventListener('storage', handleStorageChange);
    
    // Listen for chrome.storage changes if available
    let chromeStorageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chromeStorageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {

        // Detect newly arriving PVAC auto-execute requests so we can switch
        // the popup over to DAppRequestHandler and process them silently.
        if (areaName === 'local' && !hasPvacRequest) {
          const pvacKeyNames = [
            'pendingPvacIdentityKey',
            'pendingPvacEcdhKey',
            'pendingPvacDecryptKey',
            'pendingPvacEncryptKey',
            'pendingPvacScanKey',
            'pendingPvacZkSignKey',
          ];
          for (const k of pvacKeyNames) {
            if (changes[k]?.newValue) {
              setHasPvacRequest(true);
              break;
            }
          }
        }

        // Detect newly arriving RFC-O-1 dApp requests so DAppRequestHandler
        // can render the appropriate approval UI.
        if (areaName === 'local' && !hasDAppRequest) {
          const dappKeyNames = [
            'pendingConnectRequestKey',
            'pendingSignRequestKey',
            'pendingTxRequestKey',
            'pendingSignTxRequestKey',
            'pendingContractRequestKey',
            'pendingEncryptRequestKey',
            'pendingDecryptRequestKey',
            'pendingStealthRequestKey',
            'pendingClaimRequestKey',
            'pendingSensitiveWriteKey',
            'pendingEvmTxRequestKey',
            'pendingEvmSignRequestKey',
            'pendingEvmTypedDataRequestKey',
            'pendingEvmTokenRequestKey',
            'pendingEvmApproveRequestKey',
            'pendingEvmSwitchRequestKey',
            'pendingSwitchNetworkRequestKey',
          ];
          for (const k of dappKeyNames) {
            if (changes[k]?.newValue) {
              setHasDAppRequest(true);
              break;
            }
          }
        }

        // Handle lock state change - ALWAYS respond to this
        if (changes.isWalletLocked) {
          const locked = changes.isWalletLocked.newValue === 'true';
          
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
          
          // Use async IIFE since callback is not async
          (async () => {
            try {
              // IMPORTANT: First try to restore session password/encryption key
              // This handles the case where another context (expanded) just unlocked
              const restoredPassword = await WalletManager.ensureSessionPassword();
              
              if (!restoredPassword) {
                // Cannot decrypt - session is not active
                // Don't clear wallets here, let the lock state handler do it
                
                return;
              }
              
              // Re-setup auto-lock callback after session restore
              WalletManager.setAutoLockCallback(() => {
                
                setWallet(null);
                setWallets([]);
                setIsLocked(true);
              });
              
              // Now decrypt session wallets
              const newWallets = await WalletManager.getSessionWallets();
              if (Array.isArray(newWallets) && newWallets.length > 0) {
                
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
              // FIX #10: Notify user of sync failure (but don't use toast in storage listener to avoid hook issues)
            }
          })();
          return;
        }
        
        if (isLocked) return;
        
        // Handle activeWalletId change from chrome.storage.local
        if (areaName === 'local' && changes.activeWalletId && changes.activeWalletId.newValue) {
          
          const newActiveId = changes.activeWalletId.newValue;
          
          WalletManager.getSessionWallets().then(sessionWallets => {
            if (sessionWallets.length > 0) {
              const foundWallet = sessionWallets.find((w: Wallet) => w.address === newActiveId);
              if (foundWallet) {
                setWallets(sessionWallets);
                setWallet(foundWallet);
                localStorage.setItem('activeWalletId', newActiveId);
                
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

    // Re-setup auto-lock callback after unlock (session password was just set)
    WalletManager.setAutoLockCallback(() => {
      
      setWallet(null);
      setWallets([]);
      setIsLocked(true);
    });
    
    if (unlockedWallets.length > 0) {
      // Get active wallet FIRST before setting any state
      let activeWalletId = await ExtensionStorageManager.get('activeWalletId');

      // Fallback to localStorage if not in ExtensionStorage
      if (!activeWalletId) {
        activeWalletId = localStorage.getItem('activeWalletId');
        
      }

      let activeWallet = unlockedWallets[0]; // Default to first wallet
      
      if (activeWalletId) {
        const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
        if (foundWallet) {
          activeWallet = foundWallet;
          
        } else {
          
          await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
          localStorage.setItem('activeWalletId', activeWallet.address);
        }
      } else {
        
        await ExtensionStorageManager.set('activeWalletId', activeWallet.address);
        localStorage.setItem('activeWalletId', activeWallet.address);
      }
      
      // Now set all states together
      
      setIsLocked(false);
      setWallets(unlockedWallets);
      setWallet(activeWallet);
      
      // Handle pending dApp requests asynchronously (non-blocking)
      setTimeout(async () => {
        try {
          const dappKeyNames = [
            'pendingConnectRequestKey',
            'pendingSignRequestKey',
            'pendingTxRequestKey',
            'pendingSignTxRequestKey',
            'pendingContractRequestKey',
            'pendingEncryptRequestKey',
            'pendingDecryptRequestKey',
            'pendingStealthRequestKey',
            'pendingClaimRequestKey',
            'pendingSensitiveWriteKey',
          ];
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const raw = await chrome.storage.local.get(dappKeyNames);
            if (dappKeyNames.some(k => !!raw[k])) setHasDAppRequest(true);
          }
        } catch (error) {
          console.error('Error checking pending dApp requests:', error);
        }
      }, 100);
      
    } else {
      setIsLocked(false);
      setWallets([]);
      setWallet(null);
    }
  };

  const addWallet = async (newWallet: Wallet) => {
    
    try {
      // Read current wallets from session storage
      const currentWallets = await WalletManager.getSessionWallets();
      
      // Check if wallet already exists
      const walletExists = currentWallets.some(w => w.address === newWallet.address);
      
      if (walletExists) {
        
        setWallets(currentWallets);
        setWallet(newWallet);
        return;
      }
      
      const updatedWallets = [...currentWallets, newWallet];

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
          JSON.parse(verifyEncrypted);
        } catch (e) {
          console.error('Failed to verify wallet storage:', e);
        }
      }

    } catch (error) {
      console.error('PopupApp: Failed to save wallet:', error);
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

  const reorderWallets = async (newOrder: Wallet[]) => {
    try {
      // Update state immediately for UI feedback
      setWallets(newOrder);
      
      // Persist the new order
      await WalletManager.reorderWallets(newOrder);

    } catch (error) {
      console.error('Failed to reorder wallets:', error);
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

  const openExpandedView = async (mode?: 'evm') => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      if (mode === 'evm') {
        // Store intent in chrome.storage.local so ExpandedApp can read it
        await ExtensionStorageManager.set('pendingEvmMode', 'true');
      }
      const url = chrome.runtime.getURL('index.html');
      chrome.tabs.create({ url });
    }
  };

  // Show splash screen first (shorter duration for popup)
  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background flex items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center space-y-3">
            <div
              className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: '#3B567F', borderRightColor: '#3B567F' }}
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
              <UnlockWallet onUnlock={handleUnlock} isPopupMode={true} />
            </PageTransition>
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Any pending dApp request (RFC-O-1) or PVAC auto-execute — render the
  // unified DAppRequestHandler. It loads the actual request data internally
  // via storage listeners and routes to the correct approval screen.
  if (hasDAppRequest || hasPvacRequest) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-hidden">
            <PageTransition variant="scale" className="h-full">
              <DAppRequestHandler wallets={wallets} />
            </PageTransition>
          </div>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Check if wallet exists in storage (prevents WelcomeScreen flash after unlock)
  const hasStoredWallet = localStorage.getItem('walletPasswordHash') && localStorage.getItem('encryptedWallets');

  // Show welcome screen ONLY if no wallets AND no stored wallet data
  if (wallets.length === 0 && !hasStoredWallet) {
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

  // Show loading if we have stored wallets but wallet state is not ready yet
  if (wallets.length === 0 && hasStoredWallet) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="w-[400px] h-[600px] bg-background popup-view overflow-hidden">
          <div className="popup-container h-full overflow-y-auto flex items-center justify-center">
            <div className="text-center">
              <div
                className="w-8 h-8 mx-auto rounded-full border-2 border-transparent animate-spin mb-3"
                style={{ borderTopColor: '#3B567F', borderRightColor: '#3B567F' }}
              />
              <div className="text-sm text-muted-foreground">Loading wallet...</div>
            </div>
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
                className="w-8 h-8 mx-auto rounded-full border-2 border-transparent animate-spin mb-3"
                style={{ borderTopColor: '#3B567F', borderRightColor: '#3B567F' }}
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
              onReorderWallets={reorderWallets}
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
