import { ExtensionStorageManager } from './extensionStorage';
import { verifyPassword, decryptWalletData, encryptWalletData, isRateLimited, getRemainingAttempts, generateSessionKey, encryptSessionData, decryptSessionData } from './password';
import { Wallet } from '../types/wallet';
import { deriveEvmFromOctraKey } from './evmDerive';

// Storage key for EVM address mapping
const EVM_ADDRESS_MAP_KEY = 'evmAddressMap';

export class WalletManager {
  // Store password temporarily in memory for encrypting new wallets
  private static sessionPassword: string | null = null;
  // Session encryption key (random, stored in memory only)
  private static sessionEncryptionKey: string | null = null;
  private static sessionTimeout: ReturnType<typeof setTimeout> | null = null;
  private static SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes auto-lock (industry standard)
  private static onAutoLockCallback: (() => void) | null = null;
  private static isAutoLockEnabled: boolean = true;
  private static timerStartTime: number = 0;
  
  // Storage key for session timestamp (shared across instances)
  private static SESSION_TIMESTAMP_KEY = 'walletSessionTimestamp';
  
  // Migration version key
  private static MIGRATION_VERSION_KEY = 'walletMigrationVersion';
  private static CURRENT_MIGRATION_VERSION = 2; // v2 = encrypted-only storage

  /**
   * Migrate legacy unencrypted wallet data to encrypted-only storage
   * This ensures user data is safe and properly encrypted
   */
  static async migrateIfNeeded(): Promise<{ migrated: boolean; message?: string }> {
    try {
      const currentVersion = parseInt(localStorage.getItem(this.MIGRATION_VERSION_KEY) || '1', 10);
      
      if (currentVersion >= this.CURRENT_MIGRATION_VERSION) {
        return { migrated: false };
      }
      
      console.log('🔄 WalletManager: Starting migration from v' + currentVersion + ' to v' + this.CURRENT_MIGRATION_VERSION);
      
      // Check if there's unencrypted wallet data
      const unencryptedWallets = localStorage.getItem('wallets');
      const hasPassword = localStorage.getItem('walletPasswordHash');
      
      if (unencryptedWallets && hasPassword) {
        // User has legacy unencrypted data - remove it
        // The encrypted version should already exist in encryptedWallets
        const encryptedWallets = localStorage.getItem('encryptedWallets');
        
        if (encryptedWallets) {
          // Safe to remove unencrypted data
          localStorage.removeItem('wallets');
          await ExtensionStorageManager.remove('wallets');
          console.log('🔐 WalletManager: Removed legacy unencrypted wallet data');
        } else {
          // No encrypted wallets exist - this is a problem
          // User needs to re-enter password to encrypt their wallets
          console.warn('⚠️ WalletManager: Found unencrypted wallets but no encrypted version');
          return { 
            migrated: false, 
            message: 'Please unlock your wallet to complete security upgrade. Your wallet data will be re-encrypted.'
          };
        }
      }
      
      // Update migration version
      localStorage.setItem(this.MIGRATION_VERSION_KEY, this.CURRENT_MIGRATION_VERSION.toString());
      await ExtensionStorageManager.set(this.MIGRATION_VERSION_KEY, this.CURRENT_MIGRATION_VERSION.toString());
      
      console.log('✅ WalletManager: Migration completed to v' + this.CURRENT_MIGRATION_VERSION);
      return { migrated: true };
    } catch (error) {
      console.error('❌ WalletManager: Migration failed:', error);
      return { migrated: false, message: 'Migration failed. Please contact support.' };
    }
  }

  /**
   * Store EVM address mapping for a wallet (safe - no private key)
   * Called after wallet unlock/creation
   */
  static async storeEvmAddress(octraAddress: string, privateKeyB64: string): Promise<string> {
    try {
      const { evmAddress } = deriveEvmFromOctraKey(privateKeyB64);
      
      // Get existing map
      const mapStr = localStorage.getItem(EVM_ADDRESS_MAP_KEY);
      const map: Record<string, string> = mapStr ? JSON.parse(mapStr) : {};
      
      // Store mapping
      map[octraAddress] = evmAddress;
      localStorage.setItem(EVM_ADDRESS_MAP_KEY, JSON.stringify(map));
      
      // Also sync to extension storage
      await ExtensionStorageManager.set(EVM_ADDRESS_MAP_KEY, JSON.stringify(map));
      
      console.log('✅ WalletManager: Stored EVM address for', octraAddress.slice(0, 8), '->', evmAddress);
      return evmAddress;
    } catch (error) {
      console.error('❌ WalletManager: Failed to store EVM address:', error);
      return '';
    }
  }

  /**
   * Get EVM address for an Octra address (safe - no private key needed)
   */
  static getEvmAddress(octraAddress: string): string {
    try {
      const mapStr = localStorage.getItem(EVM_ADDRESS_MAP_KEY);
      if (!mapStr) return '';
      
      const map: Record<string, string> = JSON.parse(mapStr);
      return map[octraAddress] || '';
    } catch {
      return '';
    }
  }

  /**
   * Store EVM addresses for all wallets (called after unlock)
   */
  static async storeAllEvmAddresses(wallets: Wallet[]): Promise<void> {
    for (const wallet of wallets) {
      if (wallet.privateKey) {
        await this.storeEvmAddress(wallet.address, wallet.privateKey);
      }
    }
  }

  /**
   * Clean up any unencrypted wallet data from storage
   * Call this after successful unlock to ensure security
   */
  static async cleanupUnencryptedData(): Promise<void> {
    try {
      localStorage.removeItem('wallets');
      await ExtensionStorageManager.remove('wallets');
      console.log('🧹 WalletManager: Cleaned up unencrypted wallet data');
    } catch (error) {
      console.error('❌ WalletManager: Failed to cleanup unencrypted data:', error);
    }
  }

  /**
   * Security audit: Check for any unencrypted wallet data in storage
   * Returns issues found for logging/debugging
   */
  static async securityAudit(): Promise<{ issues: string[]; isSecure: boolean }> {
    const issues: string[] = [];
    
    try {
      // Check for legacy 'wallets' key (unencrypted)
      const unencryptedWallets = localStorage.getItem('wallets');
      if (unencryptedWallets) {
        issues.push('Found unencrypted "wallets" key in localStorage');
        // Auto-cleanup
        localStorage.removeItem('wallets');
        await ExtensionStorageManager.remove('wallets');
      }
      
      // Check encryptedWallets for any with needsEncryption flag
      const encryptedData = localStorage.getItem('encryptedWallets');
      if (encryptedData) {
        try {
          const wallets = JSON.parse(encryptedData);
          if (Array.isArray(wallets)) {
            for (const w of wallets) {
              if (w.needsEncryption) {
                issues.push(`Wallet ${w.address?.slice(0, 8)}... has needsEncryption flag (not properly encrypted)`);
              }
              // Check if encryptedData is actually plain JSON (not encrypted)
              try {
                const parsed = JSON.parse(w.encryptedData);
                if (parsed.privateKey || parsed.mnemonic) {
                  issues.push(`Wallet ${w.address?.slice(0, 8)}... has unencrypted sensitive data!`);
                }
              } catch {
                // Good - encryptedData is not parseable as JSON, meaning it's encrypted
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse encryptedWallets for audit:', e);
        }
      }
      
      // Check for any keys containing sensitive terms
      const sensitiveTerms = ['privateKey', 'mnemonic', 'seed', 'secret'];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          for (const term of sensitiveTerms) {
            if (key.toLowerCase().includes(term.toLowerCase())) {
              issues.push(`Found potentially sensitive key in localStorage: ${key}`);
            }
          }
        }
      }
      
      const isSecure = issues.length === 0;
      
      if (isSecure) {
        console.log('✅ Security audit passed: No unencrypted wallet data found');
      } else {
        console.warn('⚠️ Security audit found issues:', issues);
      }
      
      return { issues, isSecure };
    } catch (error) {
      console.error('Security audit failed:', error);
      return { issues: ['Audit failed: ' + String(error)], isSecure: false };
    }
  }

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
    
    // Save session timestamp to storage for cross-instance sharing
    localStorage.setItem(this.SESSION_TIMESTAMP_KEY, this.timerStartTime.toString());
    
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
    
    // Generate new session encryption key for encrypting session storage
    this.sessionEncryptionKey = generateSessionKey();
    console.log('🔐 WalletManager: Generated new session encryption key');
    
    // Store password and encryption key in chrome.storage.session for cross-instance access
    // This is secure because session storage is cleared when browser closes
    this.storeSessionPasswordToStorage(password);
    this.storeSessionEncryptionKeyToStorage(this.sessionEncryptionKey);
    
    // Start auto-lock timer
    this.startAutoLockTimer();
  }
  
  // Store session password to chrome.storage.session (for cross-instance encryption)
  private static async storeSessionPasswordToStorage(password: string): Promise<void> {
    try {
      // We encode the password to base64 for storage (not encryption, just encoding)
      // This is safe because chrome.storage.session is:
      // 1. Only accessible by this extension
      // 2. Cleared when browser closes
      // 3. Not synced to cloud
      const encoded = btoa(unescape(encodeURIComponent(password)));
      await ExtensionStorageManager.setSession('sessionKey', encoded);
      console.log('🔑 WalletManager: Session password stored in session storage');
    } catch (error) {
      console.error('❌ Failed to store session password:', error);
    }
  }
  
  // Store session encryption key to chrome.storage.session
  private static async storeSessionEncryptionKeyToStorage(key: string): Promise<void> {
    try {
      await ExtensionStorageManager.setSession('sessionEncKey', key);
      console.log('🔐 WalletManager: Session encryption key stored in session storage');
    } catch (error) {
      console.error('❌ Failed to store session encryption key:', error);
    }
  }
  
  // Retrieve session password from chrome.storage.session
  private static async retrieveSessionPasswordFromStorage(): Promise<string | null> {
    try {
      const encoded = await ExtensionStorageManager.getSession('sessionKey');
      if (encoded) {
        const password = decodeURIComponent(escape(atob(encoded)));
        return password;
      }
      return null;
    } catch (error) {
      console.error('❌ Failed to retrieve session password:', error);
      return null;
    }
  }
  
  // Retrieve session encryption key from chrome.storage.session
  private static async retrieveSessionEncryptionKeyFromStorage(): Promise<string | null> {
    try {
      const key = await ExtensionStorageManager.getSession('sessionEncKey');
      return key || null;
    } catch (error) {
      console.error('❌ Failed to retrieve session encryption key:', error);
      return null;
    }
  }
  
  // Ensure session password is available (load from storage if needed)
  static async ensureSessionPassword(): Promise<string | null> {
    // If we have both in memory, return password
    if (this.sessionPassword && this.sessionEncryptionKey) {
      return this.sessionPassword;
    }
    
    // Try to load from session storage (for cross-instance access)
    const storedPassword = await this.retrieveSessionPasswordFromStorage();
    const storedEncKey = await this.retrieveSessionEncryptionKeyFromStorage();
    
    if (storedPassword && storedEncKey) {
      console.log('🔑 WalletManager: Restored session password and encryption key from session storage');
      this.sessionPassword = storedPassword;
      this.sessionEncryptionKey = storedEncKey;
      this.startAutoLockTimer();
      return storedPassword;
    }
    
    return null;
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
    
    // Clear session encryption key
    if (this.sessionEncryptionKey) {
      this.sessionEncryptionKey = null;
      console.log('🔒 WalletManager: Session encryption key cleared');
    }
    
    if (this.sessionTimeout) {
      console.log('⏱️ WalletManager: Clearing auto-lock timer');
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    
    // Clear session timestamp from storage
    localStorage.removeItem(this.SESSION_TIMESTAMP_KEY);
    
    // Clear session password and encryption key from session storage
    this.clearSessionDataFromStorage();
  }
  
  // Clear all session data from chrome.storage.session
  private static async clearSessionDataFromStorage(): Promise<void> {
    try {
      await ExtensionStorageManager.removeSession('sessionKey');
      await ExtensionStorageManager.removeSession('sessionEncKey');
      await ExtensionStorageManager.removeSession('sessionWallets');
      console.log('🔒 WalletManager: All session data cleared from session storage');
    } catch (error) {
      console.error('❌ Failed to clear session data from storage:', error);
    }
  }

  static getSessionPassword(): string | null {
    return this.sessionPassword;
  }
  
  // Refresh session timeout (call on user activity)
  static refreshSessionTimeout(): void {
    
    // Only refresh if session is active
    if (this.sessionPassword) {
      console.log('⏱️ WalletManager: Refreshing auto-lock timer due to activity');
      this.startAutoLockTimer();
    }
  }
  
  // Check if session is active (in this instance)
  static isSessionActive(): boolean {
    return this.sessionPassword !== null;
  }
  
  // Check if session is valid across instances (using stored timestamp)
  static isSessionValidAcrossInstances(): boolean {
    const timestampStr = localStorage.getItem(this.SESSION_TIMESTAMP_KEY);
    if (!timestampStr) {
      return false;
    }
    
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return false;
    }
    
    const elapsed = Date.now() - timestamp;
    const isValid = elapsed < this.SESSION_TIMEOUT_MS;
    
    console.log(`🔍 WalletManager: Session timestamp check - elapsed: ${Math.round(elapsed / 1000)}s, valid: ${isValid}`);
    
    return isValid;
  }
  
  // Refresh session timestamp from another instance (for cross-instance sync)
  static refreshSessionFromStorage(): boolean {
    if (!this.isSessionValidAcrossInstances()) {
      return false;
    }
    
    // Session is valid in storage, restart our local timer
    if (this.sessionPassword) {
      console.log('🔄 WalletManager: Refreshing session timer from storage');
      this.startAutoLockTimer();
      return true;
    }
    
    return false;
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
    
    // Check if activeWalletId is preserved from before lock
    const preservedActiveWalletId = await ExtensionStorageManager.get('activeWalletId');
    console.log('🔓 WalletManager: Preserved activeWalletId:', preservedActiveWalletId);
    
    try {
      // Get password hash and salt - prioritize localStorage (synchronous, more reliable)
      // then fallback to ExtensionStorage
      let hashedPassword = localStorage.getItem('walletPasswordHash');
      let salt = localStorage.getItem('walletPasswordSalt');
      
      // Fallback to ExtensionStorage if localStorage is empty
      if (!hashedPassword || !salt) {
        console.log('🔓 WalletManager: localStorage empty, trying ExtensionStorage');
        hashedPassword = await ExtensionStorageManager.get('walletPasswordHash');
        salt = await ExtensionStorageManager.get('walletPasswordSalt');
        
        // Sync back to localStorage if found in ExtensionStorage
        if (hashedPassword && salt) {
          console.log('🔓 WalletManager: Syncing password hash from ExtensionStorage to localStorage');
          localStorage.setItem('walletPasswordHash', hashedPassword);
          localStorage.setItem('walletPasswordSalt', salt);
        }
      } else {
        // Ensure ExtensionStorage is in sync with localStorage
        const extHash = await ExtensionStorageManager.get('walletPasswordHash');
        if (!extHash || extHash !== hashedPassword) {
          console.log('🔓 WalletManager: Syncing password hash from localStorage to ExtensionStorage');
          await ExtensionStorageManager.set('walletPasswordHash', hashedPassword);
          await ExtensionStorageManager.set('walletPasswordSalt', salt);
        }
      }
      
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

      // Get encrypted wallets - prioritize localStorage, then ExtensionStorage
      let encryptedWallets = localStorage.getItem('encryptedWallets');
      
      // Fallback to ExtensionStorage if localStorage is empty
      if (!encryptedWallets) {
        console.log('🔓 WalletManager: localStorage encryptedWallets empty, trying ExtensionStorage');
        encryptedWallets = await ExtensionStorageManager.get('encryptedWallets');
        
        // Sync back to localStorage if found
        if (encryptedWallets) {
          console.log('🔓 WalletManager: Syncing encryptedWallets from ExtensionStorage to localStorage');
          localStorage.setItem('encryptedWallets', typeof encryptedWallets === 'string' ? encryptedWallets : JSON.stringify(encryptedWallets));
        }
      } else {
        // Ensure ExtensionStorage is in sync
        const extWallets = await ExtensionStorageManager.get('encryptedWallets');
        if (!extWallets) {
          console.log('🔓 WalletManager: Syncing encryptedWallets from localStorage to ExtensionStorage');
          await ExtensionStorageManager.set('encryptedWallets', encryptedWallets);
        }
      }
      
      console.log('🔓 WalletManager: encryptedWallets exists:', !!encryptedWallets);
      
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
          let walletsWereUpgraded = false;
          
          for (const encryptedWallet of parsedEncrypted) {
            try {
              let wallet: Wallet;
              
              if (encryptedWallet.needsEncryption) {
                console.log('🔄 WalletManager: Found wallet needing encryption:', encryptedWallet.address?.slice(0, 8));
                // Legacy: wallet stored as plain JSON, decrypt and re-encrypt properly
                try {
                  wallet = JSON.parse(encryptedWallet.encryptedData);
                } catch (parseError) {
                  console.error('❌ WalletManager: Failed to parse needsEncryption wallet data:', parseError);
                  continue;
                }
                
                // Re-encrypt this wallet properly
                const properlyEncrypted = await encryptWalletData(JSON.stringify(wallet), password);
                encryptedWallet.encryptedData = properlyEncrypted;
                delete encryptedWallet.needsEncryption; // Remove the flag completely
                walletsWereUpgraded = true;
                console.log('✅ WalletManager: Wallet upgraded to encrypted:', wallet.address?.slice(0, 8));
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

          // Save re-encrypted wallets if any were upgraded
          if (walletsWereUpgraded) {
            console.log('💾 WalletManager: Saving upgraded encrypted wallets');
            await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(parsedEncrypted));
            localStorage.setItem('encryptedWallets', JSON.stringify(parsedEncrypted));
          }
        } catch (error) {
          console.error('❌ WalletManager: Failed to parse encrypted wallets:', error);
          throw new Error('Failed to parse encrypted wallet data');
        }
      }

      // Update storage - ONLY store encrypted wallets, not unencrypted
      if (decryptedWallets.length > 0) {
        await Promise.all([
          ExtensionStorageManager.set('isWalletLocked', 'false')
        ]);
        
        localStorage.setItem('isWalletLocked', 'false');
        
        // SECURITY: Remove any unencrypted wallet data
        localStorage.removeItem('wallets');
        await ExtensionStorageManager.remove('wallets');
        
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
        console.log('🔓 WalletManager: Checking activeWalletId:', activeWalletId);
        console.log('🔓 WalletManager: Decrypted wallets addresses:', decryptedWallets.map(w => w.address.slice(0, 8)));
        
        if (!activeWalletId || !decryptedWallets.some(w => w.address === activeWalletId)) {
          console.log('🔓 WalletManager: Setting activeWalletId to first wallet:', decryptedWallets[0].address.slice(0, 8));
          await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
          localStorage.setItem('activeWalletId', decryptedWallets[0].address);
        }
        
        // Store decrypted wallets in session storage (ENCRYPTED)
        // Session encryption key is generated in setSessionPassword
        await this.updateSessionWallets(decryptedWallets);
        console.log('🔓 WalletManager: Stored', decryptedWallets.length, 'wallets in encrypted session storage');
        
        // Store EVM addresses for all wallets (safe - only stores derived addresses)
        await this.storeAllEvmAddresses(decryptedWallets);
      }
      
      // SECURITY: Clean up any legacy unencrypted data and run audit
      await this.cleanupUnencryptedData();
      await this.securityAudit();

      return decryptedWallets;
    } catch (error) {
      console.error('❌ WalletManager unlock error:', error);
      throw error;
    }
  }

  // Update session wallets (for cross-instance sync) - ENCRYPTED
  static async updateSessionWallets(wallets: Wallet[]): Promise<void> {
    try {
      if (!this.sessionEncryptionKey) {
        console.warn('⚠️ WalletManager: No session encryption key, cannot store wallets securely');
        return;
      }
      
      const walletsJson = JSON.stringify(wallets);
      const encryptedWallets = await encryptSessionData(walletsJson, this.sessionEncryptionKey);
      
      await ExtensionStorageManager.setSession('sessionWallets', encryptedWallets);
      console.log('🔐 WalletManager: Updated session wallets (encrypted), count:', wallets.length);
    } catch (error) {
      console.error('❌ Failed to update session wallets:', error);
    }
  }

  // Get session wallets - DECRYPTED
  static async getSessionWallets(): Promise<Wallet[]> {
    try {
      const encryptedSessionWallets = await ExtensionStorageManager.getSession('sessionWallets');
      if (!encryptedSessionWallets) {
        return [];
      }
      
      // Check if we have the encryption key
      if (!this.sessionEncryptionKey) {
        console.warn('⚠️ WalletManager: No session encryption key, cannot decrypt wallets');
        return [];
      }
      
      try {
        const decryptedJson = await decryptSessionData(encryptedSessionWallets, this.sessionEncryptionKey);
        const parsed = JSON.parse(decryptedJson);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (decryptError) {
        console.error('❌ Failed to decrypt session wallets:', decryptError);
        // Clear corrupted session data
        await ExtensionStorageManager.removeSession('sessionWallets');
      }
      
      return [];
    } catch (error) {
      console.error('❌ Failed to get session wallets:', error);
      return [];
    }
  }

  // Encrypt and add a new wallet
  // SECURITY: This method REQUIRES a session password to encrypt the wallet
  // It will throw an error if no password is available to prevent storing unencrypted data
  static async addEncryptedWallet(wallet: Wallet): Promise<void> {
    // Try to get password from memory first, then from session storage
    let password = this.getSessionPassword();
    
    if (!password) {
      // Try to restore from session storage (cross-instance scenario)
      password = await this.ensureSessionPassword();
    }
    
    // SECURITY SAFEGUARD: Never store wallet without encryption
    if (!password) {
      console.error('🚨 SECURITY: Cannot store wallet without encryption password!');
      throw new Error('Session password required to add wallet. Please unlock your wallet first.');
    }
    
    try {
      // Get existing encrypted wallets - prioritize localStorage (more reliable)
      const localData = localStorage.getItem('encryptedWallets');
      const extData = await ExtensionStorageManager.get('encryptedWallets');
      
      let encryptedWallets: any[] = [];
      
      // Prefer localStorage, fallback to ExtensionStorage
      const existingData = localData || extData;
      if (existingData) {
        encryptedWallets = typeof existingData === 'string' 
          ? JSON.parse(existingData) 
          : existingData;
      }
      
      console.log('🔐 addEncryptedWallet: Current encrypted wallets count:', encryptedWallets.length);

      // Check if wallet already exists
      const existingIndex = encryptedWallets.findIndex((w: any) => w.address === wallet.address);
      
      // Always encrypt wallet data - no exceptions
      console.log('🔐 addEncryptedWallet: Encrypting wallet', wallet.address.slice(0, 8));
      const encryptedData = await encryptWalletData(JSON.stringify(wallet), password);
      const encryptedWallet = {
        address: wallet.address,
        encryptedData: encryptedData,
        createdAt: Date.now()
      };

      if (existingIndex >= 0) {
        console.log('🔄 addEncryptedWallet: Updating existing wallet at index', existingIndex);
        encryptedWallets[existingIndex] = encryptedWallet;
      } else {
        console.log('➕ addEncryptedWallet: Adding new wallet');
        encryptedWallets.push(encryptedWallet);
      }

      // Save to BOTH storages for redundancy
      const encryptedJson = JSON.stringify(encryptedWallets);
      await ExtensionStorageManager.set('encryptedWallets', encryptedJson);
      localStorage.setItem('encryptedWallets', encryptedJson);
      
      // Store EVM address for this wallet (safe - only stores derived address)
      await this.storeEvmAddress(wallet.address, wallet.privateKey);
      
      console.log(`🔐 Wallet ${wallet.address.slice(0, 8)}... stored (encrypted), total: ${encryptedWallets.length}`);
      
      // Verify storage
      const verifyExt = await ExtensionStorageManager.get('encryptedWallets');
      const verifyLocal = localStorage.getItem('encryptedWallets');
      console.log('🔍 addEncryptedWallet: Verify - ExtensionStorage length:', verifyExt?.length, ', localStorage length:', verifyLocal?.length);
    } catch (error) {
      console.error('❌ Failed to store wallet:', error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  // Reorder wallets (for drag-and-drop functionality)
  static async reorderWallets(newOrder: Wallet[]): Promise<void> {
    let password = this.getSessionPassword();
    
    if (!password) {
      password = await this.ensureSessionPassword();
    }
    
    if (!password) {
      console.error('🚨 SECURITY: Cannot reorder wallets without session password!');
      throw new Error('Session password required to reorder wallets. Please unlock your wallet first.');
    }
    
    try {
      // Get existing encrypted wallets
      const localData = localStorage.getItem('encryptedWallets');
      const extData = await ExtensionStorageManager.get('encryptedWallets');
      
      const existingData = localData || extData;
      if (!existingData) {
        console.warn('⚠️ reorderWallets: No encrypted wallets found');
        return;
      }
      
      const encryptedWallets: any[] = typeof existingData === 'string' 
        ? JSON.parse(existingData) 
        : existingData;
      
      // Create a map of address to encrypted wallet data
      const encryptedMap = new Map(encryptedWallets.map(w => [w.address, w]));
      
      // Reorder based on newOrder
      const reorderedEncrypted = newOrder
        .map(wallet => encryptedMap.get(wallet.address))
        .filter(Boolean);
      
      // Save reordered wallets to both storages
      const encryptedJson = JSON.stringify(reorderedEncrypted);
      await ExtensionStorageManager.set('encryptedWallets', encryptedJson);
      localStorage.setItem('encryptedWallets', encryptedJson);
      
      // Update session wallets with new order
      await this.updateSessionWallets(newOrder);
      
      console.log('🔄 WalletManager: Wallets reordered successfully, count:', newOrder.length);
    } catch (error) {
      console.error('❌ Failed to reorder wallets:', error);
      throw error;
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
      
      // Also update session wallets
      const currentSessionWallets = await this.getSessionWallets();
      const updatedSessionWallets = currentSessionWallets.filter(w => w.address !== address);
      await this.updateSessionWallets(updatedSessionWallets);
      
      console.log(`🗑️ Wallet ${address.slice(0, 8)}... removed from encrypted storage`);
    } catch (error) {
      console.error('❌ Failed to remove encrypted wallet:', error);
    }
  }

  static async lockWallets(): Promise<void> {
    try {
      console.log('🔒 WalletManager: lockWallets called');
      
      // FIX #7: Preserve activeWalletId BEFORE any clearing operations
      const activeWalletIdBefore = await ExtensionStorageManager.get('activeWalletId');
      const localActiveWalletId = localStorage.getItem('activeWalletId');
      const preservedActiveWalletId = activeWalletIdBefore || localActiveWalletId;
      console.log('🔒 WalletManager: activeWalletId BEFORE lock:', preservedActiveWalletId);
      
      // Clear session password (this calls clearSessionDataFromStorage internally)
      this.clearSessionPassword();
      
      // Set locked state
      await ExtensionStorageManager.set('isWalletLocked', 'true');
      localStorage.setItem('isWalletLocked', 'true');
      
      // SECURITY: Remove any unencrypted wallet data
      localStorage.removeItem('wallets');
      await ExtensionStorageManager.remove('wallets');
      
      // Clear session wallets
      await ExtensionStorageManager.removeSession('sessionWallets');
      console.log('🔒 WalletManager: Cleared session wallets');
      
      // FIX #7: Restore activeWalletId if it was cleared
      if (preservedActiveWalletId) {
        const activeWalletIdAfter = await ExtensionStorageManager.get('activeWalletId');
        if (!activeWalletIdAfter) {
          console.log('🔒 WalletManager: Restoring activeWalletId:', preservedActiveWalletId);
          await ExtensionStorageManager.set('activeWalletId', preservedActiveWalletId);
          localStorage.setItem('activeWalletId', preservedActiveWalletId);
        }
      }
      
      // Verify activeWalletId is still preserved
      const activeWalletIdFinal = await ExtensionStorageManager.get('activeWalletId');
      console.log('🔒 WalletManager: activeWalletId AFTER lock:', activeWalletIdFinal);
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
      const [hasPassword, isLocked, encryptedWallets] = await Promise.all([
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('isWalletLocked'),
        ExtensionStorageManager.get('encryptedWallets')
      ]);
      
      // Also check localStorage as fallback
      const localPasswordHash = localStorage.getItem('walletPasswordHash');
      const localEncryptedWallets = localStorage.getItem('encryptedWallets');
      
      const hasPasswordAnywhere = !!hasPassword || !!localPasswordHash;
      
      console.log('🔍 shouldShowUnlockScreen check:', { 
        hasPassword: !!hasPassword, 
        localPasswordHash: !!localPasswordHash,
        isLocked, 
        hasEncryptedWallets: !!encryptedWallets,
        localEncryptedWallets: !!localEncryptedWallets
      });
      
      // No password set anywhere = no wallet setup yet (show welcome screen)
      if (!hasPasswordAnywhere) {
        console.log('🔍 shouldShowUnlockScreen: No password anywhere, returning false (welcome screen)');
        return false;
      }
      
      // Check if there are encrypted wallets (in either storage)
      let hasEncryptedWallets = false;
      const encryptedData = encryptedWallets || localEncryptedWallets;
      if (encryptedData) {
        try {
          const parsed = typeof encryptedData === 'string' 
            ? JSON.parse(encryptedData) 
            : encryptedData;
          hasEncryptedWallets = Array.isArray(parsed) && parsed.length > 0;
        } catch {
          hasEncryptedWallets = false;
        }
      }
      
      // If has password and encrypted wallets exist, show unlock screen
      if (hasEncryptedWallets) {
        console.log('🔍 shouldShowUnlockScreen: Has encrypted wallets, returning true (unlock screen)');
        return true;
      }
      
      // Has password but no encrypted wallets - something is wrong, show welcome
      console.log('🔍 shouldShowUnlockScreen: Has password but no wallets, returning false');
      return false;
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

  /**
   * Get EVM private key for a wallet (for signing EVM transactions)
   * This retrieves the private key from session storage (decrypted wallets)
   * Only available when wallet is unlocked
   */
  static async getEvmPrivateKey(octraAddress: string): Promise<string | null> {
    try {
      // Get session wallets (decrypted)
      const wallets = await this.getSessionWallets();
      
      if (!wallets || wallets.length === 0) {
        console.warn('[WalletManager] No session wallets available');
        return null;
      }
      
      // Find wallet by address
      const wallet = wallets.find(w => w.address === octraAddress);
      if (!wallet || !wallet.privateKey) {
        console.warn('[WalletManager] Wallet not found or no private key:', octraAddress.slice(0, 8));
        return null;
      }
      
      // Derive EVM private key from Octra private key
      const { privateKeyHex } = deriveEvmFromOctraKey(wallet.privateKey);
      
      return privateKeyHex;
    } catch (error) {
      console.error('[WalletManager] Failed to get EVM private key:', error);
      return null;
    }
  }
}
