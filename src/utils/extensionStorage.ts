// Extension storage manager for Chrome extension
export class ExtensionStorageManager {
  private static isExtension = typeof chrome !== 'undefined' && chrome.storage;
  
  static async init() {
    if (!this.isExtension) return;
    
    // Migrate localStorage data to chrome.storage on first run
    try {
      const migrated = await this.get('_migrated');
      if (!migrated) {
        await this.migrateFromLocalStorage();
        await this.set('_migrated', 'true');
      }
    } catch (error) {
      console.error('Failed to migrate storage:', error);
    }
  }
  
  private static async migrateFromLocalStorage() {
    if (!this.isExtension) return;
    
    const keysToMigrate = [
      'wallets',
      'activeWalletId',
      'isWalletLocked',
      'walletPasswordHash',
      'walletPasswordSalt',
      'encryptedWallets',
      'connectedDApps',
      'rpcProviders',
      'octra-wallet-theme'
    ];
    
    for (const key of keysToMigrate) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        await this.set(key, value);
        // Don't remove from localStorage immediately to avoid data loss
      }
    }
  }
  
  static async get(key: string): Promise<string | null> {
    if (this.isExtension) {
      try {
        const result = await chrome.storage.local.get(key);
        return result[key] || null;
      } catch (error) {
        console.error('Failed to get from chrome.storage:', error);
        return localStorage.getItem(key);
      }
    }
    return localStorage.getItem(key);
  }
  
  static async set(key: string, value: string): Promise<void> {
    if (this.isExtension) {
      let chromeSuccess = false;
      let localSuccess = false;
      
      // Try chrome.storage first (primary)
      try {
        await chrome.storage.local.set({ [key]: value });
        chromeSuccess = true;
      } catch (error) {
        console.error('Failed to set in chrome.storage:', error);
      }
      
      // Also update localStorage for immediate consistency (secondary)
      try {
        localStorage.setItem(key, value);
        localSuccess = true;
      } catch (localStorageError) {
        console.warn('Failed to update localStorage:', localStorageError);
      }
      
      // Throw error only if both failed
      if (!chromeSuccess && !localSuccess) {
        throw new Error(`Failed to save ${key} to any storage`);
      }
    } else {
      localStorage.setItem(key, value);
    }
  }
  
  static async remove(key: string): Promise<void> {
    if (this.isExtension) {
      let chromeSuccess = false;
      let localSuccess = false;
      
      // Try chrome.storage first (primary)
      try {
        await chrome.storage.local.remove(key);
        chromeSuccess = true;
      } catch (error) {
        console.error('Failed to remove from chrome.storage:', error);
      }
      
      // Also remove from localStorage for consistency (secondary)
      try {
        localStorage.removeItem(key);
        localSuccess = true;
      } catch (localStorageError) {
        console.warn('Failed to remove from localStorage:', localStorageError);
      }
      
      // Throw error only if both failed
      if (!chromeSuccess && !localSuccess) {
        throw new Error(`Failed to remove ${key} from any storage`);
      }
    } else {
      localStorage.removeItem(key);
    }
  }
  
  static async clear(): Promise<void> {
    if (this.isExtension) {
      try {
        await chrome.storage.local.clear();
        localStorage.clear();
      } catch (error) {
        console.error('Failed to clear chrome.storage:', error);
        localStorage.clear();
      }
    } else {
      localStorage.clear();
    }
  }
}