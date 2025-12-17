import { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WalletDashboard } from './components/WalletDashboard';
import { UnlockWallet } from './components/UnlockWallet';
import { DAppRequestHandler } from './components/DAppRequestHandler';
import { ThemeProvider } from './components/ThemeProvider';
import { Wallet } from './types/wallet';
import { Toaster } from '@/components/ui/toaster';
import { ExtensionStorageManager } from './utils/extensionStorage';
import { WalletManager } from './utils/walletManager';

function ExpandedApp() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
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
        await ExtensionStorageManager.init();
        
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
        if (storedWallets) {
          try {
            const parsedWallets = typeof storedWallets === 'string' 
              ? JSON.parse(storedWallets) 
              : storedWallets;
            
            if (Array.isArray(parsedWallets)) {
              loadedWallets = parsedWallets;
              
              if (loadedWallets.length > 0) {
                let activeWallet = loadedWallets[0];
                if (activeWalletId) {
                  const foundWallet = loadedWallets.find((w: Wallet) => w.address === activeWalletId);
                  if (foundWallet) {
                    activeWallet = foundWallet;
                  }
                }
                setWallet(activeWallet);
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
        
        setWallets(loadedWallets);
        setIsLocked(false);
      } catch (error) {
        console.error('Failed to load wallet data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []); // NO dependencies - only run once

  // Simple unlock handler
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
      
      // CRITICAL: Also sync encryptedWallets to match current wallets
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
        }
      } catch (syncError) {
        console.error('Failed to sync encryptedWallets:', syncError);
      }
      
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

  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div>Loading...</div>
        </div>
      </ThemeProvider>
    );
  }

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

  // Handle dApp requests
  if (isDAppRequest) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
        <div className="min-h-screen bg-background">
          <DAppRequestHandler wallets={wallets} />
          <Toaster />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="octra-wallet-theme">
      <div className="min-h-screen bg-background expanded-view">
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

export default ExpandedApp;