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
          }
        }
      } catch (error) {
        console.error('Failed to check wallet status:', error);
      }
    };

    checkWalletStatus();
  }, []);

  const handleUnlock = (unlockedWallets: Wallet[]) => {
    console.log('🔓 App: Handling unlock with', unlockedWallets.length, 'wallets');
    
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
          console.log('🎯 App: Restored active wallet:', activeWallet.address.slice(0, 8) + '...');
        } else {
          console.log('🔄 App: Active wallet not found, using first wallet:', activeWallet.address.slice(0, 8) + '...');
          // Update stored activeWalletId to match the new active wallet
          localStorage.setItem('activeWalletId', activeWallet.address);
        }
      } else {
        console.log('🆕 App: No active wallet stored, using first wallet:', activeWallet.address.slice(0, 8) + '...');
        localStorage.setItem('activeWalletId', activeWallet.address);
      }
      
      setWallet(activeWallet);
    } else {
      console.warn('⚠️ App: No wallets returned from unlock process');
      setWallets([]);
      setWallet(null);
      setIsLocked(false);
    }
    
    console.log('✅ App: Unlock handling completed successfully');
  };

  const addWallet = async (newWallet: Wallet) => {
    try {
      console.log('📝 App: Adding new wallet:', newWallet.address.slice(0, 8) + '...');
      
      // CRITICAL: Read current wallets from storage to avoid overwriting
      const currentWalletsData = await ExtensionStorageManager.get('wallets');
      let currentWallets: Wallet[] = [];
      
      if (currentWalletsData) {
        try {
          currentWallets = JSON.parse(currentWalletsData);
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
        // If wallet exists, just switch to it
        setWallet(existingWallet);
        await ExtensionStorageManager.set('activeWalletId', existingWallet.address);
        console.log('ℹ️ App: Wallet already exists, switched to existing wallet');
        return;
      }
      
      // Add new wallet to current data
      const updatedWallets = [...currentWallets, newWallet];
      
      // Update state immediately for UI responsiveness
      setWallets(updatedWallets);
      setWallet(newWallet);
      
      // Save to storage using ExtensionStorageManager for consistency
      await ExtensionStorageManager.set('wallets', JSON.stringify(updatedWallets));
      await ExtensionStorageManager.set('activeWalletId', newWallet.address);
      
      console.log('✅ App: Wallet added to unencrypted storage. Total wallets:', updatedWallets.length);
      
      // CRITICAL: Also save to encrypted storage if password protection is enabled
      const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
      if (hasPassword) {
        console.log('🔐 App: Password protection enabled, encrypting new wallet...');
        
        // Get the current password from user (we need this to encrypt)
        // For now, we'll add it to encrypted storage but it needs proper encryption
        const existingEncryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
        const walletExists = existingEncryptedWallets.some((w: any) => w.address === newWallet.address);
        
        if (!walletExists) {
          // Import the encryption function
          const { encryptWalletData } = await import('./utils/password');
          
          // We need to get the password from somewhere - this is a limitation
          // For now, we'll store unencrypted but mark it for encryption
          const newEncryptedWallet = {
            address: newWallet.address,
            encryptedData: JSON.stringify(newWallet), // TODO: Proper encryption needed
            createdAt: Date.now(),
            needsEncryption: true // Flag to indicate this needs proper encryption during lock/unlock
          };
          
          const updatedEncryptedWallets = [...existingEncryptedWallets, newEncryptedWallet];
          await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
          
          console.log('📦 App: Added wallet to encrypted storage (needs proper encryption). Total encrypted wallets:', updatedEncryptedWallets.length);
        }
      }
    } catch (error) {
      console.error('❌ App: Failed to add wallet:', error);
    }
  };

  const switchWallet = (selectedWallet: Wallet) => {
    setWallet(selectedWallet);
    localStorage.setItem('activeWalletId', selectedWallet.address);
  };

  const removeWallet = (walletToRemove: Wallet) => {
    const updatedWallets = wallets.filter(w => w.address !== walletToRemove.address);
    setWallets(updatedWallets);
    localStorage.setItem('wallets', JSON.stringify(updatedWallets));
    
    // Only update wallet state if we're removing the currently active wallet
    // and there are no remaining wallets
    if (wallet?.address === walletToRemove.address && updatedWallets.length === 0) {
      setWallet(null);
      localStorage.removeItem('activeWalletId');
    }
    
    // Note: Active wallet switching is handled in WalletDashboard component
    // to ensure proper state synchronization
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