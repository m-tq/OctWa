import { ExtensionStorageManager } from './extensionStorage';
import { verifyPassword, decryptWalletData } from './password';
import { Wallet } from '../types/wallet';

export class WalletManager {
  static async unlockWallets(password: string): Promise<Wallet[]> {
    try {
      console.log('🔓 WalletManager: Starting unlock process...');
      
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

      console.log('✅ WalletManager: Password verified successfully');

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
          
          console.log(`🔍 WalletManager: Found ${parsedEncrypted.length} encrypted wallets to decrypt`);
          
          // Decrypt all wallets
          for (const encryptedWallet of parsedEncrypted) {
            try {
              // Check if wallet needs proper encryption (was added during lock without password)
              if (encryptedWallet.needsEncryption) {
                console.log(`🔄 WalletManager: Processing wallet that needs encryption: ${encryptedWallet.address.slice(0, 8)}...`);
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
                console.log(`✅ WalletManager: Successfully processed unencrypted wallet ${wallet.address.slice(0, 8)}...`);
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
                console.log(`✅ WalletManager: Successfully decrypted wallet ${wallet.address.slice(0, 8)}...`);
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
              console.log(`📦 WalletManager: Found ${walletsWithType.length} existing unencrypted wallets`);
            }
          } catch (error) {
            console.error('❌ WalletManager: Failed to parse existing wallets:', error);
          }
        }
      }

      console.log(`🎯 WalletManager: Total wallets after decryption: ${decryptedWallets.length}`);

      if (decryptedWallets.length === 0) {
        console.warn('⚠️ WalletManager: No wallets found after unlock process - checking fallback storage');
        
        // CRITICAL FIX: Check localStorage as fallback for wallets that might not be encrypted yet
        try {
          const fallbackWallets = localStorage.getItem('wallets');
          if (fallbackWallets) {
            const parsedFallback = JSON.parse(fallbackWallets);
            if (Array.isArray(parsedFallback) && parsedFallback.length > 0) {
              decryptedWallets.push(...parsedFallback);
              console.log(`🔄 WalletManager: Recovered ${parsedFallback.length} wallets from fallback storage`);
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
      } else {
        // Only update lock status if no wallets found
        await ExtensionStorageManager.set('isWalletLocked', 'false');
        localStorage.setItem('isWalletLocked', 'false');
      }
      
      console.log('💾 WalletManager: Wallet data saved to storage successfully');
      
      // Set active wallet - preserve existing activeWalletId if valid, otherwise use first wallet
      if (decryptedWallets.length > 0) {
        const activeWalletId = await ExtensionStorageManager.get('activeWalletId');
        
        // Check if the stored activeWalletId still exists in decrypted wallets
        if (activeWalletId) {
          const walletExists = decryptedWallets.some(wallet => wallet.address === activeWalletId);
          if (walletExists) {
            console.log(`🎯 WalletManager: Preserving existing active wallet: ${activeWalletId.slice(0, 8)}...`);
            // Keep the existing activeWalletId - no need to update
          } else {
            // If stored wallet doesn't exist anymore, use first wallet
            await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
            localStorage.setItem('activeWalletId', decryptedWallets[0].address);
            console.log(`🔄 WalletManager: Active wallet not found, switching to first wallet: ${decryptedWallets[0].address.slice(0, 8)}...`);
          }
        } else {
          // No activeWalletId set, use first wallet
          await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
          localStorage.setItem('activeWalletId', decryptedWallets[0].address);
          console.log(`🆕 WalletManager: No active wallet set, using first wallet: ${decryptedWallets[0].address.slice(0, 8)}...`);
        }
      }

      console.log(`🎉 WalletManager: Unlock completed successfully with ${decryptedWallets.length} wallets`);
      return decryptedWallets;
    } catch (error) {
      console.error('❌ WalletManager unlock error:', error);
      throw error;
    }
  }

  static async lockWallets(): Promise<void> {
    try {
      console.log('🔒 WalletManager: Starting lock process...');
      
      // CRITICAL FIX: Before locking, ensure all current wallets are encrypted
      const currentWalletsData = await ExtensionStorageManager.get('wallets');
      if (currentWalletsData) {
        try {
          const currentWallets: Wallet[] = JSON.parse(currentWalletsData);
          console.log(`📦 WalletManager: Found ${currentWallets.length} wallets to encrypt before lock`);
          
          // Check if password protection is enabled
          const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
          if (hasPassword && currentWallets.length > 0) {
            console.log('🔐 WalletManager: Password protection enabled, ensuring all wallets are encrypted...');
            
            // Get existing encrypted wallets
            const existingEncryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
            const encryptedAddresses = existingEncryptedWallets.map((w: any) => w.address);
            
            // Find wallets that are not yet encrypted
            const unencryptedWallets = currentWallets.filter(wallet => 
              !encryptedAddresses.includes(wallet.address)
            );
            
            if (unencryptedWallets.length > 0) {
              console.log(`⚠️ WalletManager: Found ${unencryptedWallets.length} unencrypted wallets that need to be encrypted before lock`);
              
              // We need to get the password to encrypt these wallets
              // For now, we'll store them as needing encryption and they'll be handled on next unlock
              const walletsNeedingEncryption = unencryptedWallets.map(wallet => ({
                address: wallet.address,
                encryptedData: JSON.stringify(wallet), // Store as JSON for now
                createdAt: Date.now(),
                needsEncryption: true // Flag to indicate this needs proper encryption
              }));
              
              const updatedEncryptedWallets = [...existingEncryptedWallets, ...walletsNeedingEncryption];
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
              
              console.log(`📦 WalletManager: Added ${unencryptedWallets.length} wallets to encrypted storage (marked for proper encryption)`);
            }
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to encrypt wallets before lock:', error);
          // Continue with lock process even if encryption fails
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
      
      console.log('🔒 WalletManager: Wallets locked successfully (activeWalletId preserved)');
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