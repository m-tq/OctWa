// Chrome extension storage manager with dual-write (chrome.storage.local + localStorage).
export class ExtensionStorageManager {
  private static readonly isExtension = typeof chrome !== 'undefined' && !!chrome.storage;

  static async init(): Promise<void> {
    if (!this.isExtension) return;

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

  private static async migrateFromLocalStorage(): Promise<void> {
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
      'octra-wallet-theme',
    ];

    for (const key of keysToMigrate) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        await this.set(key, value);
      }
    }
  }

  static async get(key: string): Promise<string | null> {
    if (this.isExtension) {
      try {
        const result = await chrome.storage.local.get(key);
        return result[key] ?? null;
      } catch (error) {
        console.error('Failed to get from chrome.storage:', error);
        return localStorage.getItem(key);
      }
    }
    return localStorage.getItem(key);
  }

  static async set(key: string, value: string): Promise<void> {
    if (!this.isExtension) {
      localStorage.setItem(key, value);
      return;
    }

    let chromeSuccess = false;
    let localSuccess = false;
    let previousChromeValue: string | null = null;

    try {
      const result = await chrome.storage.local.get(key);
      previousChromeValue = result[key] ?? null;
    } catch { /* no previous value */ }

    try {
      await chrome.storage.local.set({ [key]: value });
      chromeSuccess = true;
    } catch (error) {
      console.error('Failed to set in chrome.storage:', error);
    }

    try {
      localStorage.setItem(key, value);
      localSuccess = true;
    } catch (localStorageError) {
      console.warn('Failed to update localStorage:', localStorageError);

      if (chromeSuccess && previousChromeValue !== null) {
        try {
          await chrome.storage.local.set({ [key]: previousChromeValue });
          chromeSuccess = false;
        } catch { /* rollback failed */ }
      }
    }

    if (!chromeSuccess && !localSuccess) {
      throw new Error(`Failed to save ${key} to any storage`);
    }
  }

  static async remove(key: string): Promise<void> {
    if (!this.isExtension) {
      localStorage.removeItem(key);
      return;
    }

    let chromeSuccess = false;
    let localSuccess = false;

    try {
      await chrome.storage.local.remove(key);
      chromeSuccess = true;
    } catch (error) {
      console.error('Failed to remove from chrome.storage:', error);
    }

    try {
      localStorage.removeItem(key);
      localSuccess = true;
    } catch (error) {
      console.warn('Failed to remove from localStorage:', error);
    }

    if (!chromeSuccess && !localSuccess) {
      throw new Error(`Failed to remove ${key} from any storage`);
    }
  }

  static async clear(): Promise<void> {
    if (this.isExtension) {
      try {
        await chrome.storage.local.clear();
      } catch (error) {
        console.error('Failed to clear chrome.storage:', error);
      }
    }
    localStorage.clear();
  }

  // Session storage — shared across popup/expanded, cleared when browser closes.
  // No fallback to sessionStorage: it can persist on browser restart with tab restore.

  static async getSession(key: string): Promise<string | null> {
    if (this.isExtension && chrome.storage.session) {
      try {
        const result = await chrome.storage.session.get(key);
        return result[key] ?? null;
      } catch (error) {
        console.error('Failed to get from chrome.storage.session:', error);
        return null;
      }
    }
    console.warn('ExtensionStorage.getSession: Not in extension context');
    return null;
  }

  static async setSession(key: string, value: string): Promise<void> {
    if (this.isExtension && chrome.storage.session) {
      try {
        await chrome.storage.session.set({ [key]: value });
        return;
      } catch (error) {
        console.error('Failed to set in chrome.storage.session:', error);
        throw error;
      }
    }
    console.warn('ExtensionStorage.setSession: Not in extension context');
    throw new Error('Session storage not available outside extension context');
  }

  static async removeSession(key: string): Promise<void> {
    if (this.isExtension && chrome.storage.session) {
      try {
        await chrome.storage.session.remove(key);
      } catch (error) {
        console.error('Failed to remove from chrome.storage.session:', error);
      }
    }
    try {
      sessionStorage.removeItem(key);
    } catch { /* ignore */ }
  }

  static async clearAllSession(): Promise<void> {
    if (this.isExtension && chrome.storage.session) {
      try {
        await chrome.storage.session.clear();
      } catch (error) {
        console.error('Failed to clear chrome.storage.session:', error);
      }
    }
    try {
      sessionStorage.clear();
    } catch { /* ignore */ }
  }
}