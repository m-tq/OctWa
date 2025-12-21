import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { ConnectionApproval } from './components/ConnectionApproval';
import { ThemeProvider } from './components/ThemeProvider';
import { WalletManager } from './utils/walletManager';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { Wallet } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';

function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [connectionRequest, setConnectionRequest] = useState<any>(null);

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
          appIcon: decodeURIComponent(appIcon || ''),
          permissions: JSON.parse(decodeURIComponent(permissions))
        });
      }
    }
  }, []);

  // Listen for storage changes across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Handle wallet lock state changes
      if (e.key === 'isWalletLocked') {
        const isLocked = e.newValue === 'true';
        setIsLocked(isLocked);
        
        if (isLocked) {
          // If wallet is locked, clear current wallet data
          setWallet(null);
          setWallets([]);
        } else {
          // If wallet is unlocked, reload wallet data with a small delay
          // to ensure localStorage is fully updated
          setTimeout(() => {
            const storedWallets = localStorage.getItem('wallets');
            const activeWalletId = localStorage.getItem('activeWalletId');
            
            if (storedWallets) {
              const parsedWallets = JSON.parse(storedWallets);
              setWallets(parsedWallets);
              
              if (parsedWallets.length > 0) {
                let activeWallet = parsedWallets[0];
                if (activeWalletId) {
                  const foundWallet = parsedWallets.find((w: Wallet) => w.address === activeWalletId);
                  if (foundWallet) {
                    activeWallet = foundWallet;
                  }
                }
                setWallet(activeWallet);
              }
            }
          }, 100);
        }
      }
      
      // Handle wallet data changes
      if (e.key === 'wallets' && !isLocked) {
        // Only update if we don't have wallets or if the data actually changed
        if (e.newValue) {
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
            // If no active wallet is set but we have wallets, set the first one
            setWallet(newWallets[0]);
          }
        }
      }
      
      // Handle active wallet changes
      if (e.key === 'activeWalletId' && !isLocked) {
        const newActiveWalletId = e.newValue;
        const currentWallets = wallets.length > 0 ? wallets : JSON.parse(localStorage.getItem('wallets') || '[]');
        if (newActiveWalletId && currentWallets.length > 0) {
          const foundWallet = currentWallets.find((w: Wallet) => w.address === newActiveWalletId);
          if (foundWallet) {
            setWallet(foundWallet);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [isLocked, wallets, wallet]);

  useEffect(() => {
    const checkWalletStatus = async () => {
      try {
        // Sync rpcProviders to chrome.storage.local for background script access
        const rpcProviders = localStorage.getItem('rpcProviders');
        if (rpcProviders && typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ rpcProviders }).catch(err => {
            console.warn('Failed to sync rpcProviders to chrome.storage:', err);
          });
        }
        
        // Check if wallet is locked
        const walletLocked = localStorage.getItem('isWalletLocked');
        const hasPassword = localStorage.getItem('walletPasswordHash');
        
        // Show unlock screen if password exists and wallet is not explicitly unlocked
        if (hasPassword && walletLocked !== 'false') {
          setIsLocked(true);
          return;
        }
        
        // Only load wallets if not locked
        const storedWallets = localStorage.getItem('wallets');
        const activeWalletId = localStorage.getItem('activeWalletId');
        
        if (storedWallets) {
          const parsedWallets = JSON.parse(storedWallets);
          setWallets(parsedWallets);
          
          // Set active wallet based on stored ID or default to first wallet
          if (parsedWallets.length > 0) {
            let activeWallet = parsedWallets[0];
            if (activeWalletId) {
              const foundWallet = parsedWallets.find((w: Wallet) => w.address === activeWalletId);
              if (foundWallet) {
                activeWallet = foundWallet;
              }
            }
            setWallet(activeWallet);
            
            // CRITICAL: Sync encryptedWallets with loaded wallets to prevent deleted wallets from reappearing
            try {
              const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
              if (encryptedWalletsData) {
                const encryptedWallets = typeof encryptedWalletsData === 'string' 
                  ? JSON.parse(encryptedWalletsData) 
                  : encryptedWalletsData;
                if (Array.isArray(encryptedWallets)) {
                  const validAddresses = new Set(parsedWallets.map((w: Wallet) => w.address));
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
        }
      } catch (error) {
        console.error('Failed to check wallet status:', error);
      }
    };

    checkWalletStatus();
  }, []);

  const handleUnlock = (unlockedWallets: Wallet[]) => {
    if (unlockedWallets.length > 0) {
      setWallets(unlockedWallets);
      setIsLocked(false);
      
      // Set active wallet - prioritize stored activeWalletId, fallback to first wallet
      const activeWalletId = localStorage.getItem('activeWalletId');
      let activeWallet = unlockedWallets[0];
      
      if (activeWalletId) {
        const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
        if (foundWallet) {
          activeWallet = foundWallet;
        } else {
          localStorage.setItem('activeWalletId', activeWallet.address);
        }
      } else {
        localStorage.setItem('activeWalletId', activeWallet.address);
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
      // Read current wallets from storage to avoid overwriting
      const currentWalletsData = await ExtensionStorageManager.get('wallets');
      let currentWallets: Wallet[] = [];
      
      if (currentWalletsData) {
        try {
          currentWallets = JSON.parse(currentWalletsData);
          console.log('📦 App.tsx: Found', currentWallets.length, 'wallets in storage');
        } catch (error) {
          console.error('Failed to parse current wallets:', error);
          currentWallets = wallets; // fallback to state
        }
      } else {
        currentWallets = wallets; // fallback to state
      }
      
      // Check if wallet already exists in current data
      const existingWallet = currentWallets.find(w => w.address === newWallet.address);
      if (existingWallet) {
        // Wallet exists in storage (e.g., from PasswordSetup)
        // Update state to reflect storage
        console.log('✅ App.tsx: Wallet exists in storage, syncing state');
        setWallets(currentWallets);
        setWallet(existingWallet);
        await ExtensionStorageManager.set('activeWalletId', existingWallet.address);
        localStorage.setItem('activeWalletId', existingWallet.address);
        return;
      }
      
      // Add new wallet to current data
      const updatedWallets = [...currentWallets, newWallet];
      console.log('➕ App.tsx: Adding new wallet, total:', updatedWallets.length);
      
      // Update state immediately for UI responsiveness
      setWallets(updatedWallets);
      setWallet(newWallet);
      
      // Save to storage using ExtensionStorageManager for consistency
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      await ExtensionStorageManager.set('activeWalletId', newWallet.address);
      
      // Also sync to localStorage
      localStorage.setItem('wallets', JSON.stringify(updatedWallets));
      localStorage.setItem('activeWalletId', newWallet.address);
      
      // Sync encryptedWallets to match current wallets
      // This ensures deleted wallets stay deleted and new wallets are properly tracked
      try {
        const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
        if (encryptedWalletsData) {
          const encryptedWallets = typeof encryptedWalletsData === 'string' 
            ? JSON.parse(encryptedWalletsData) 
            : encryptedWalletsData;
          if (Array.isArray(encryptedWallets)) {
            // Filter encryptedWallets to only include wallets that exist in updatedWallets
            const validAddresses = new Set(updatedWallets.map(w => w.address));
            const syncedEncryptedWallets = encryptedWallets.filter(
              (w: any) => validAddresses.has(w.address)
            );
            
            // Add new wallet to encryptedWallets if not already there
            const newWalletExists = syncedEncryptedWallets.some((w: any) => w.address === newWallet.address);
            if (!newWalletExists) {
              syncedEncryptedWallets.push({
                address: newWallet.address,
                encryptedData: JSON.stringify(newWallet),
                createdAt: Date.now(),
                needsEncryption: true
              });
            }
            
            await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
            localStorage.setItem('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
          }
        } else {
          // No encryptedWallets yet, create it with the new wallet
          const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
          if (hasPassword) {
            const newEncryptedWallets = [{
              address: newWallet.address,
              encryptedData: JSON.stringify(newWallet),
              createdAt: Date.now(),
              needsEncryption: true
            }];
            await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(newEncryptedWallets));
            localStorage.setItem('encryptedWallets', JSON.stringify(newEncryptedWallets));
          }
        }
      } catch (syncError) {
        console.error('Failed to sync encryptedWallets:', syncError);
      }
    } catch (error) {
      console.error('❌ App: Failed to add wallet:', error);
    }
  };

  const switchWallet = (selectedWallet: Wallet) => {
    setWallet(selectedWallet);
    localStorage.setItem('activeWalletId', selectedWallet.address);
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
      
      // CRITICAL: Also remove from encryptedWallets storage to prevent resurrection on unlock
      try {
        const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
        if (encryptedWalletsData) {
          const encryptedWallets = typeof encryptedWalletsData === 'string' 
            ? JSON.parse(encryptedWalletsData) 
            : encryptedWalletsData;
          if (Array.isArray(encryptedWallets)) {
            const updatedEncryptedWallets = encryptedWallets.filter(
              (w: any) => w.address !== walletToRemove.address
            );
            await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
            localStorage.setItem('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
          }
        }
      } catch (encError) {
        console.error('Failed to remove from encryptedWallets:', encError);
      }
      
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

  const disconnectWallet = () => {
    // Lock the wallet properly using WalletManager
    WalletManager.lockWallets();
    
    // Clear UI state
    setWallet(null);
    setWallets([]);
    setIsLocked(true);
  };

  // Show connection approval if there's a connection request
  if (connectionRequest && wallets.length > 0 && !isLocked) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background">
          <ConnectionApproval 
            request={connectionRequest}
            wallets={wallets}
            onApprove={(approved: boolean, selectedAddress?: string) => {
              // Send response to background script
              chrome.runtime.sendMessage({
                type: 'CONNECTION_RESULT',
                origin: connectionRequest.origin,
                approved,
                address: selectedAddress
              });
              
              // Close the tab
              window.close();
            }}
          />
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  // Show unlock screen if wallet is locked
  if (isLocked) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background">
          <UnlockWallet onUnlock={handleUnlock} />
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="min-h-screen bg-background">
        {!wallet ? (
          <WelcomeScreen onWalletCreated={addWallet} />
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

export default App;