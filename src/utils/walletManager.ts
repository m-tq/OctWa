import { ExtensionStorageManager } from './extensionStorage';
import { verifyPassword, decryptWalletData, encryptWalletData, secureWipe, isRateLimited, getRemainingAttempts } from './password';
import { Wallet } from '../types/wallet';

export class WalletManager {
  // Store password temporarily in memory for encrypting new wallets
  private static sessionPassword: string | null = null;
  private static sessionTimeout: ReturnType<typeof setTimeout> | null = null;
  private static SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes auto-lock (industry standard)
  private static lastActivity: number = Date.now();
  private static onAutoLockCallback: (() => void) | null = null;
  private static isAutoLockEnabled: boolean = true;
  private static timerStartTime: number = 0;

  // Set callback for auto-lock (to trigger UI update)
  static setAutoLockCallback(callback: () => void): void {
    console.log('🔧 WalletManager: Auto-lock callback registered, sessionPassword exists:', !!this.sessionPassword);
    this.onAutoLockCallback = callback;
    
    // If session is already active, restart the timer with the callback
    if (this.sessionPassword && this.isAutoLockEnabled) {
      console.log('🔧 WalletManager: Session active, restarting auto-lock timer');
      this.startAutoLockTimer();
    }
  }

  // Start or restart the auto-lock timer
  private static startAutoLockTimer(): void {
    // Clear any existing timeout
    if (this.sessionTimeout) {
      console.log('⏱️ WalletManager: Clearing existing timer');
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    
    if (!this.isAutoLockEnabled) {
      console.log('🔧 WalletManager: Auto-lock is disabled');
      return;
    }
    
    this.timerStartTime = Date.now();
    console.log(`⏱️ WalletManager: Starting auto-lock timer (${this.SESSION_TIMEOUT_MS / 1000}s) at ${new Date().toLocaleTimeString()}`);
    
    // Set auto-lock timeout for security
    this.sessionTimeout = setTimeout(() => {
      const elapsed = Date.now() - this.timerStartTime;
      console.log(`🔒 WalletManager: Auto-lock timer triggered after ${elapsed}ms!`);
      this.executeAutoLock();
    }, this.SESSION_TIMEOUT_MS);
    
    console.log('⏱️ WalletManager: Timer ID:', this.sessionTimeout);
  }

  // Execute auto-lock
  private static async executeAutoLock(): Promise<void> {
    console.log('🔒 WalletManager: Executing auto-lock...');
    
    try {
      // Lock wallets first
      await this.lockWallets();
      console.log('🔒 WalletManager: Wallets locked successfully');
      
      // Trigger callback to update UI
      if (this.onAutoLockCallback) {
        console.log('🔒 WalletManager: Triggering UI callback');
        this.onAutoLockCallback();
      } else {
        console.warn('⚠️ WalletManager: No auto-lock callback registered!');
      }
      
      // Dispatch storage event for cross-tab sync
      if (typeof window !== 'undefined') {
        console.log('🔒 WalletManager: Dispatching storage event');
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'isWalletLocked',
          oldValue: 'false',
          newValue: 'true',
          storageArea: localStorage
        }));
      }
    } catch (error) {
      console.error('❌ WalletManager: Auto-lock failed:', error);
    }
  }

  static setSessionPassword(password: string): void {
    console.log('🔑 WalletManager: Setting session password, callback exists:', !!this.onAutoLockCallback);
    
    // Clear old password first
    if (this.sessionPassword) {
      this.clearSessionPassword();
    }
    
    this.sessionPassword = password;
    this.lastActivity = Date.now();
    
    // Start auto-lock timer
    this.startAutoLockTimer();
  }

  static clearSessionPassword(): void {
    console.log('🔒 WalletManager: clearSessionPassword called, current password exists:', !!this.sessionPassword);
    
    // Attempt to clear password from memory
    if (this.sessionPassword) {
      // Create a temporary reference and overwrite
      const len = this.sessionPassword.length;
      // Note: JS strings are immutable, but we dereference to help GC
      this.sessionPassword = null;
      console.log(`🔒 WalletManager: Session password cleared (was ${len} chars)`);
    }
    
    if (this.sessionTimeout) {
      console.log('⏱️ WalletManager: Clearing auto-lock timer');
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  static getSessionPassword(): string | null {
    return this.sessionPassword;
  }
  
  // Refresh session timeout (call on user activity)
  static refreshSessionTimeout(): void {
    const now = Date.now();
    this.lastActivity = now;
    
    // Only refresh if session is active
    if (this.sessionPassword) {
      console.log('⏱️ WalletManager: Refreshing auto-lock timer due to activity');
      this.startAutoLockTimer();
    }
  }
  
  // Check if session is active
  static isSessionActive(): boolean {
    return this.sessionPassword !== null;
  }
  
  // Check rate limit status
  static checkRateLimit(): { limited: boolean; remainingMs?: number; remainingAttempts: number } {
    const rateLimit = isRateLimited();
    return {
      ...rateLimit,
      remainingAttempts: getRemainingAttempts()
    };
  }

  static async unlockWallets(password: string): Promise<Wallet[]> {
    console.log('🔓 WalletManager: unlockWallets called');
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

      console.log('🔓 WalletManager: Password verified, setting session password');
      // Store password in session for encrypting new wallets
      this.setSessionPassword(password);

      // Get encrypted wallets
      const encryptedWallets = await ExtensionStorageManager.get('encryptedWallets');
      const decryptedWallets: Wallet[] = [];

      if (encryptedWallets) {
        try {
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
              let wallet: Wallet;
              
              if (encryptedWallet.needsEncryption) {
                // Legacy: wallet stored as plain JSON, decrypt and re-encrypt properly
                wallet = JSON.parse(encryptedWallet.encryptedData);
                
                // Re-encrypt this wallet properly
                const properlyEncrypted = await encryptWalletData(JSON.stringify(wallet), password);
                encryptedWallet.encryptedData = properlyEncrypted;
                encryptedWallet.needsEncryption = false;
                encryptedWallet._wasUpgraded = true; // Mark for saving
              } else {
                // Properly encrypted wallet
                const decryptedData = await decryptWalletData(encryptedWallet.encryptedData, password);
                wallet = JSON.parse(decryptedData);
              }
              
              // Add type field for backward compatibility
              if (!wallet.type) {
                wallet.type = wallet.mnemonic ? 'generated' : 'imported-private-key';
              }
              
              decryptedWallets.push(wallet);
            } catch (error) {
              console.error('❌ WalletManager: Failed to decrypt wallet:', encryptedWallet.address, error);
            }
          }

          // Save re-encrypted wallets if any were upgraded (had needsEncryption flag removed)
          // We track this during decryption loop
          let walletsWereUpgraded = false;
          for (const encryptedWallet of parsedEncrypted) {
            if (encryptedWallet._wasUpgraded) {
              walletsWereUpgraded = true;
              delete encryptedWallet._wasUpgraded; // Clean up temp flag
            }
          }
          if (walletsWereUpgraded) {
            await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(parsedEncrypted));
            localStorage.setItem('encryptedWallets', JSON.stringify(parsedEncrypted));
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to parse encrypted wallets:', error);
          throw new Error('Failed to parse encrypted wallet data');
        }
      }

      // Update storage
      if (decryptedWallets.length > 0) {
        await Promise.all([
          ExtensionStorageManager.set('wallets', JSON.stringify(decryptedWallets)),
          ExtensionStorageManager.set('isWalletLocked', 'false')
        ]);
        
        localStorage.setItem('wallets', JSON.stringify(decryptedWallets));
        localStorage.setItem('isWalletLocked', 'false');
        
        // Sync encrypted wallets
        const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
        if (encryptedWalletsData) {
          const encWallets = typeof encryptedWalletsData === 'string' 
            ? JSON.parse(encryptedWalletsData) 
            : encryptedWalletsData;
          if (Array.isArray(encWallets)) {
            const validAddresses = new Set(decryptedWallets.map(w => w.address));
            const syncedEncrypted = encWallets.filter((w: any) => validAddresses.has(w.address));
            
            if (syncedEncrypted.length !== encWallets.length) {
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(syncedEncrypted));
              localStorage.setItem('encryptedWallets', JSON.stringify(syncedEncrypted));
            }
          }
        }
      } else {
        await ExtensionStorageManager.set('isWalletLocked', 'false');
        localStorage.setItem('isWalletLocked', 'false');
      }
      
      // Set active wallet
      if (decryptedWallets.length > 0) {
        const activeWalletId = await ExtensionStorageManager.get('activeWalletId');
        if (!activeWalletId || !decryptedWallets.some(w => w.address === activeWalletId)) {
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

  // Encrypt and add a new wallet
  static async addEncryptedWallet(wallet: Wallet): Promise<void> {
    const password = this.getSessionPassword();
    if (!password) {
      console.warn('⚠️ No session password, wallet will be stored for later encryption');
      return;
    }

    try {
      const encryptedData = await encryptWalletData(JSON.stringify(wallet), password);
      
      const existingData = await ExtensionStorageManager.get('encryptedWallets');
      let encryptedWallets: any[] = [];
      
      if (existingData) {
        encryptedWallets = typeof existingData === 'string' 
          ? JSON.parse(existingData) 
          : existingData;
      }

      // Check if wallet already exists
      const existingIndex = encryptedWallets.findIndex((w: any) => w.address === wallet.address);
      
      const encryptedWallet = {
        address: wallet.address,
        encryptedData: encryptedData,
        createdAt: Date.now(),
        needsEncryption: false
      };

      if (existingIndex >= 0) {
        encryptedWallets[existingIndex] = encryptedWallet;
      } else {
        encryptedWallets.push(encryptedWallet);
      }

      await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(encryptedWallets));
      localStorage.setItem('encryptedWallets', JSON.stringify(encryptedWallets));
      
      console.log(`🔐 Wallet ${wallet.address.slice(0, 8)}... encrypted and stored`);
    } catch (error) {
      console.error('❌ Failed to encrypt wallet:', error);
    }
  }

  // Remove wallet from encrypted storage
  static async removeEncryptedWallet(address: string): Promise<void> {
    try {
      const existingData = await ExtensionStorageManager.get('encryptedWallets');
      if (!existingData) return;

      let encryptedWallets = typeof existingData === 'string' 
        ? JSON.parse(existingData) 
        : existingData;

      encryptedWallets = encryptedWallets.filter((w: any) => w.address !== address);

      await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(encryptedWallets));
      localStorage.setItem('encryptedWallets', JSON.stringify(encryptedWallets));
      
      console.log(`🗑️ Wallet ${address.slice(0, 8)}... removed from encrypted storage`);
    } catch (error) {
      console.error('❌ Failed to remove encrypted wallet:', error);
    }
  }

  static async lockWallets(): Promise<void> {
    try {
      // Clear session password
      this.clearSessionPassword();

      // Sync current wallets to encrypted storage before locking
      const currentWalletsData = await ExtensionStorageManager.get('wallets');
      if (currentWalletsData) {
        try {
          const currentWallets: Wallet[] = JSON.parse(currentWalletsData);
          const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
          
          if (hasPassword && currentWallets.length > 0) {
            const existingEncrypted = JSON.parse(
              await ExtensionStorageManager.get('encryptedWallets') || '[]'
            );
            
            const currentAddresses = new Set(currentWallets.map(w => w.address));
            
            // Keep only wallets that still exist
            const filteredEncrypted = existingEncrypted.filter(
              (w: any) => currentAddresses.has(w.address)
            );
            
            // Find wallets not yet in encrypted storage
            const encryptedAddresses = new Set(filteredEncrypted.map((w: any) => w.address));
            const newWallets = currentWallets.filter(w => !encryptedAddresses.has(w.address));
            
            if (newWallets.length > 0) {
              // These wallets need encryption but we don't have password
              // Mark them for encryption on next unlock
              const walletsNeedingEncryption = newWallets.map(wallet => ({
                address: wallet.address,
                encryptedData: JSON.stringify(wallet), // Temporarily store as JSON
                createdAt: Date.now(),
                needsEncryption: true // Flag for encryption on next unlock
              }));
              
              const updatedEncrypted = [...filteredEncrypted, ...walletsNeedingEncryption];
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncrypted));
              localStorage.setItem('encryptedWallets', JSON.stringify(updatedEncrypted));
              
              console.warn(`⚠️ ${newWallets.length} wallet(s) stored temporarily, will be encrypted on next unlock`);
            } else {
              await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(filteredEncrypted));
              localStorage.setItem('encryptedWallets', JSON.stringify(filteredEncrypted));
            }
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to sync wallets before lock:', error);
        }
      }
      
      // Clear wallet data
      await Promise.all([
        ExtensionStorageManager.remove('wallets'),
        ExtensionStorageManager.set('isWalletLocked', 'true')
      ]);
      
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
      
      if (!hasPassword) return false;
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
      
      if (!hasPassword) return false;
      return isLocked !== 'false';
    } catch (error) {
      console.error('Failed to check lock status:', error);
      return false;
    }
  }

  // Export encrypted wallet backup
  static async exportBackup(): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const [encryptedWallets, passwordHash, passwordSalt] = await Promise.all([
        ExtensionStorageManager.get('encryptedWallets'),
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('walletPasswordSalt')
      ]);

      if (!encryptedWallets || !passwordHash || !passwordSalt) {
        return { success: false, error: 'No wallet data to export' };
      }

      const backupData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        encryptedWallets: typeof encryptedWallets === 'string' 
          ? JSON.parse(encryptedWallets) 
          : encryptedWallets,
        passwordHash,
        passwordSalt
      };

      const jsonString = JSON.stringify(backupData, null, 2);
      const base64Data = btoa(unescape(encodeURIComponent(jsonString)));
      
      return { success: true, data: base64Data };
    } catch (error) {
      console.error('Failed to export backup:', error);
      return { success: false, error: 'Failed to create backup' };
    }
  }

  // Import encrypted wallet backup
  static async importBackup(backupData: string): Promise<{ success: boolean; walletsCount?: number; error?: string }> {
    try {
      // Decode base64
      const jsonString = decodeURIComponent(escape(atob(backupData)));
      const backup = JSON.parse(jsonString);

      // Validate backup structure
      if (!backup.version || !backup.encryptedWallets || !backup.passwordHash || !backup.passwordSalt) {
        return { success: false, error: 'Invalid backup format' };
      }

      // Check if there's existing data
      const existingHash = await ExtensionStorageManager.get('walletPasswordHash');
      if (existingHash) {
        return { success: false, error: 'Wallet already exists. Reset first to import backup.' };
      }

      // Restore data
      await Promise.all([
        ExtensionStorageManager.set('encryptedWallets', JSON.stringify(backup.encryptedWallets)),
        ExtensionStorageManager.set('walletPasswordHash', backup.passwordHash),
        ExtensionStorageManager.set('walletPasswordSalt', backup.passwordSalt),
        ExtensionStorageManager.set('isWalletLocked', 'true')
      ]);

      // Also set in localStorage
      localStorage.setItem('encryptedWallets', JSON.stringify(backup.encryptedWallets));
      localStorage.setItem('walletPasswordHash', backup.passwordHash);
      localStorage.setItem('walletPasswordSalt', backup.passwordSalt);
      localStorage.setItem('isWalletLocked', 'true');

      return { 
        success: true, 
        walletsCount: Array.isArray(backup.encryptedWallets) ? backup.encryptedWallets.length : 0 
      };
    } catch (error) {
      console.error('Failed to import backup:', error);
      return { success: false, error: 'Failed to import backup. Invalid data format.' };
    }
  }
}
