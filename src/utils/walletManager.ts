import { ExtensionStorageManager } from './extensionStorage';
import { verifyPassword, decryptWalletData } from './password';
import { Wallet } from '../types/wallet';

export class WalletManager {
  static async unlockWallets(password: string): Promise<Wallet[]> {
    try {
      // Get password hash and salt
      const hashedPassword = await ExtensionStorageManager.get('walletPasswordHash');
      const salt = await ExtensionStorageManager.get('walletPasswordSalt');
      
      if (!hashedPassword || !salt) {
        throw new Error('No password set');
      }

      // Verify password
      const isValid = await verifyPassword(password, hashedPassword, salt);
      
      if (!isValid) {
        throw new Error('Invalid password');
      }

      // Get encrypted wallets
      const encryptedWallets = await ExtensionStorageManager.get('encryptedWallets');
      const decryptedWallets: Wallet[] = [];

      if (encryptedWallets) {
        try {
          // Safe parsing - handle both string and object
          let parsedEncrypted: any[];
          if (typeof encryptedWallets === 'string') {
            parsedEncrypted = JSON.parse(encryptedWallets);
          } else if (Array.isArray(encryptedWallets)) {
            parsedEncrypted = encryptedWallets;
          } else {
            throw new Error('Invalid encrypted wallets format');
          }
          
          // Decrypt all wallets
          for (const encryptedWallet of parsedEncrypted) {
            try {
              // Check if wallet needs proper encryption (was added during lock without password)
              if (encryptedWallet.needsEncryption) {
                // This wallet was stored as JSON during lock, parse it directly
                const wallet = JSON.parse(encryptedWallet.encryptedData);
                
                // CRITICAL FIX: Add type field for backward compatibility if missing
                if (!wallet.type) {
                  if (wallet.mnemonic) {
                    wallet.type = 'generated'; // Default to generated if has mnemonic but no type
                  } else {
                    wallet.type = 'imported-private-key'; // Default to imported if no mnemonic
                  }
                }
                
                decryptedWallets.push(wallet);
              } else {
                // This is a properly encrypted wallet
                const decryptedData = await decryptWalletData(encryptedWallet.encryptedData, password);
                const wallet = JSON.parse(decryptedData);
                
                // CRITICAL FIX: Add type field for backward compatibility if missing
                if (!wallet.type) {
                  if (wallet.mnemonic) {
                    wallet.type = 'generated'; // Default to generated if has mnemonic but no type
                  } else {
                    wallet.type = 'imported-private-key'; // Default to imported if no mnemonic
                  }
                }
                
                decryptedWallets.push(wallet);
              }
            } catch (error) {
              console.error('❌ WalletManager: Failed to decrypt wallet:', encryptedWallet.address, error);
              // Continue with other wallets instead of failing completely
            }
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to parse encrypted wallets:', error);
          throw new Error('Failed to parse encrypted wallet data');
        }
      } else {
        // If no encrypted wallets found, check if there are unencrypted wallets in storage
        // This handles the case where wallets exist but aren't encrypted yet
        const existingWallets = await ExtensionStorageManager.get('wallets');
        if (existingWallets) {
          try {
            const parsedWallets = JSON.parse(existingWallets);
            if (Array.isArray(parsedWallets) && parsedWallets.length > 0) {
              // CRITICAL FIX: Add type field for backward compatibility if missing
              const walletsWithType = parsedWallets.map(wallet => {
                if (!wallet.type) {
                  if (wallet.mnemonic) {
                    wallet.type = 'generated'; // Default to generated if has mnemonic but no type
                  } else {
                    wallet.type = 'imported-private-key'; // Default to imported if no mnemonic
                  }
                }
                return wallet;
              });
              
              decryptedWallets.push(...walletsWithType);
            }
          } catch (error) {
            console.error('❌ WalletManager: Failed to parse existing wallets:', error);
          }
        }
      }

      if (decryptedWallets.length === 0) {
        console.warn('⚠️ WalletManager: No wallets found after unlock process - checking fallback storage');
        
        // CRITICAL FIX: Check localStorage as fallback for wallets that might not be encrypted yet
        try {
          const fallbackWallets = localStorage.getItem('wallets');
          if (fallbackWallets) {
            const parsedFallback = JSON.parse(fallbackWallets);
            if (Array.isArray(parsedFallback) && parsedFallback.length > 0) {
              decryptedWallets.push(...parsedFallback);
            }
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to load fallback wallets:', error);
        }
      }

      // CRITICAL FIX: Update storage atomically - ensure all wallets are preserved
      if (decryptedWallets.length > 0) {
        await Promise.all([
          ExtensionStorageManager.set('wallets', JSON.stringify(decryptedWallets)),
          ExtensionStorageManager.set('isWalletLocked', 'false')
        ]);
        
        // Also update localStorage for immediate consistency
        localStorage.setItem('wallets', JSON.stringify(decryptedWallets));
        localStorage.setItem('isWalletLocked', 'false');
        
        // CRITICAL: Sync encryptedWallets to match decrypted wallets
        // This ensures any wallets that were deleted while unlocked stay deleted
        try {
          const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
          if (encryptedWalletsData) {
            const encryptedWallets = typeof encryptedWalletsData === 'string' 
              ? JSON.parse(encryptedWalletsData) 
              : encryptedWalletsData;
            if (Array.isArray(encryptedWallets)) {
              const validAddresses = new Set(decryptedWallets.map(w => w.address));
              const syncedEncryptedWallets = encryptedWallets.filter(
                (w: any) => validAddresses.has(w.address)
              );
              
              // Only update if there's a difference
              if (syncedEncryptedWallets.length !== encryptedWallets.length) {
                await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
                localStorage.setItem('encryptedWallets', JSON.stringify(syncedEncryptedWallets));
              }
            }
          }
        } catch (syncError) {
          console.error('Failed to sync encryptedWallets after unlock:', syncError);
        }
      } else {
        // Only update lock status if no wallets found
        await ExtensionStorageManager.set('isWalletLocked', 'false');
        localStorage.setItem('isWalletLocked', 'false');
      }
      
      // Set active wallet - preserve existing activeWalletId if valid, otherwise use first wallet
      if (decryptedWallets.length > 0) {
        const activeWalletId = await ExtensionStorageManager.get('activeWalletId');
        
        // Check if the stored activeWalletId still exists in decrypted wallets
        if (activeWalletId) {
          const walletExists = decryptedWallets.some(wallet => wallet.address === activeWalletId);
          if (!walletExists) {
            // If stored wallet doesn't exist anymore, use first wallet
            await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
            localStorage.setItem('activeWalletId', decryptedWallets[0].address);
          }
        } else {
          // No activeWalletId set, use first wallet
          await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
          localStorage.setItem('activeWalletId', decryptedWallets[0].address);
        }
      }

      return decryptedWallets;
    } catch (error) {
      console.error('❌ WalletManager unlock error:', error);
      throw error;
    }
  }

  static async lockWallets(): Promise<void> {
    try {
      // Before locking, sync encryptedWallets with current wallets
      // This ensures deleted wallets stay deleted and new wallets are added
      const currentWalletsData = await ExtensionStorageManager.get('wallets');
      if (currentWalletsData) {
        try {
          const currentWallets: Wallet[] = JSON.parse(currentWalletsData);
          
          // Check if password protection is enabled
          const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
          if (hasPassword && currentWallets.length > 0) {
            
            // Get existing encrypted wallets
            const existingEncryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
            
            // Create a map of current wallet addresses for quick lookup
            const currentWalletAddresses = new Set(currentWallets.map(w => w.address));
            
            // CRITICAL: Filter out deleted wallets from encryptedWallets
            // Only keep encrypted wallets that still exist in currentWallets
            const filteredEncryptedWallets = existingEncryptedWallets.filter(
              (w: any) => currentWalletAddresses.has(w.address)
            );
            
            // Find wallets that are not yet encrypted
            const encryptedAddresses = new Set(filteredEncryptedWallets.map((w: any) => w.address));
            const unencryptedWallets = currentWallets.filter(wallet => 
              !encryptedAddresses.has(wallet.address)
            );
            
            if (unencryptedWallets.length > 0) {
              // Store them as needing encryption
              const walletsNeedingEncryption = unencryptedWallets.map(wallet => ({
                address: wallet.address,
                encryptedData: JSON.stringify(wallet),
                createdAt: Date.now(),
                needsEncryption: true
              }));
              
              const updatedEncryptedWallets = [...filteredEncryptedWallets, ...walletsNeedingEncryption];
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
              localStorage.setItem('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
            } else {
              // Even if no new wallets, save the filtered list to remove deleted wallets
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(filteredEncryptedWallets));
              localStorage.setItem('encryptedWallets', JSON.stringify(filteredEncryptedWallets));
            }
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to sync wallets before lock:', error);
        }
      }
      
      // Clear wallet data but preserve activeWalletId for unlock restoration
      await Promise.all([
        ExtensionStorageManager.remove('wallets'),
        ExtensionStorageManager.set('isWalletLocked', 'true')
      ]);
      
      // Also clear localStorage for consistency
      localStorage.removeItem('wallets');
      localStorage.setItem('isWalletLocked', 'true');
    } catch (error) {
      console.error('WalletManager lock error:', error);
      throw error;
    }
  }

  static async isWalletSetup(): Promise<boolean> {
    try {
      const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
      return !!hasPassword;
    } catch (error) {
      console.error('Failed to check wallet setup:', error);
      return false;
    }
  }

  static async shouldShowUnlockScreen(): Promise<boolean> {
    try {
      const [hasPassword, isLocked, hasWallets] = await Promise.all([
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('isWalletLocked'),
        ExtensionStorageManager.get('wallets')
      ]);
      
      // If no password is set, never show unlock screen
      if (!hasPassword) {
        return false;
      }
      
      // If password is set and wallet is not explicitly unlocked, show unlock screen
      // OR if password is set but no decrypted wallets are available
      return isLocked !== 'false' || !hasWallets;
    } catch (error) {
      console.error('Failed to check unlock status:', error);
      return false;
    }
  }

  static async isWalletLocked(): Promise<boolean> {
    try {
      const [hasPassword, isLocked] = await Promise.all([
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('isWalletLocked')
      ]);
      
      // If no password, never locked
      if (!hasPassword) {
        return false;
      }
      
      // If password exists, locked unless explicitly unlocked
      return isLocked !== 'false';
    } catch (error) {
      console.error('Failed to check lock status:', error);
      return false;
    }
  }
}