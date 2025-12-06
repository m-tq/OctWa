import React, { useState, useEffect } from 'react';
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

        console.log('🔒 ExpandedApp: Should show unlock:', shouldShowUnlock);

        if (shouldShowUnlock) {
          console.log('🔒 ExpandedApp: Showing unlock screen - wallet is locked');
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
        
        setWallets(loadedWallets);
        setIsLocked(false);
        
        console.log('🔓 ExpandedApp: Wallet unlocked and ready');
      } catch (error) {
        console.error('Failed to load wallet data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []); // NO dependencies - only run once

  // Simple unlock handler - NO async operations
  const handleUnlock = (unlockedWallets: Wallet[]) => {
    console.log('🔓 ExpandedApp: Handling unlock with wallets:', unlockedWallets.length);
    
    // CRITICAL FIX: Ensure we preserve all wallets from the unlock process
    if (unlockedWallets.length > 0) {
      setWallets(unlockedWallets);
      setIsLocked(false);
      
      // Set active wallet - prioritize stored activeWalletId, fallback to first wallet
      const activeWalletId = localStorage.getItem('activeWalletId');
      let activeWallet = unlockedWallets[0]; // Default to first wallet
      
      if (activeWalletId) {
        const foundWallet = unlockedWallets.find(w => w.address === activeWalletId);
        if (foundWallet) {
          activeWallet = foundWallet;
          console.log('🎯 ExpandedApp: Restored active wallet:', activeWallet.address.slice(0, 8) + '...');
        } else {
          console.log('🔄 ExpandedApp: Active wallet not found, using first wallet:', activeWallet.address.slice(0, 8) + '...');
          // Update stored activeWalletId to match the new active wallet
          localStorage.setItem('activeWalletId', activeWallet.address);
        }
      } else {
        console.log('🆕 ExpandedApp: No active wallet stored, using first wallet:', activeWallet.address.slice(0, 8) + '...');
        localStorage.setItem('activeWalletId', activeWallet.address);
      }
      
      setWallet(activeWallet);
    } else {
      console.warn('⚠️ ExpandedApp: No wallets returned from unlock process');
      setWallets([]);
      setWallet(null);
      setIsLocked(false);
    }
    
    console.log('✅ ExpandedApp: Unlock handling completed successfully');
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
      
      console.log('🔒 ExpandedApp: Wallet disconnected and locked');
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