/**
 * Cache Service - Hybrid LocalStorage + IndexedDB
 * 
 * Strategy:
 * - LocalStorage: Fast access for current wallet data (balance, nonce, recent activities)
 * - IndexedDB: Large data storage for full history
 * 
 * Performance Targets:
 * - Cache Hit: < 50ms
 * - Cache Write: < 100ms
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ============================================================================
// Types
// ============================================================================

interface ActivitySummary {
  hash: string;
  type: 'standard' | 'encrypt' | 'decrypt' | 'stealth' | 'claim' | 'contract';
  direction: 'in' | 'out' | 'state-change';
  amount: number;
  timestamp: number;
  from?: string;
  to?: string;
  status: 'confirmed' | 'pending' | 'failed';
  finality?: 'pending' | 'confirmed' | 'rejected';
}

interface WalletCache {
  address: string;
  publicBalance: number;
  encryptedBalance: {
    encrypted: number;
    cipher: string;
    public?: number;
  };
  nonce: number;
  recentActivities: ActivitySummary[]; // Max 11 items
  lastUpdate: number; // timestamp
  version: string; // cache version for migration
}

interface CacheDBSchema extends DBSchema {
  wallets: {
    key: string; // wallet address
    value: WalletCache;
    indexes: { 'by-lastUpdate': number };
  };
  activities: {
    key: string; // `${address}:${hash}`
    value: ActivitySummary & { address: string };
    indexes: { 
      'by-address': string;
      'by-timestamp': number;
    };
  };
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_VERSION = '1.0.0';
const DB_NAME = 'octwa-cache';
const DB_VERSION = 1;
const LOCALSTORAGE_PREFIX = 'octwa_cache_';
const MAX_RECENT_ACTIVITIES = 11;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Cache Service Class
// ============================================================================

class CacheService {
  private db: IDBPDatabase<CacheDBSchema> | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        this.db = await openDB<CacheDBSchema>(DB_NAME, DB_VERSION, {
          upgrade(db) {
            // Wallets store
            if (!db.objectStoreNames.contains('wallets')) {
              const walletStore = db.createObjectStore('wallets', { keyPath: 'address' });
              walletStore.createIndex('by-lastUpdate', 'lastUpdate');
            }

            // Activities store
            if (!db.objectStoreNames.contains('activities')) {
              const activityStore = db.createObjectStore('activities', { keyPath: 'hash' });
              activityStore.createIndex('by-address', 'address');
              activityStore.createIndex('by-timestamp', 'timestamp');
            }
          },
        });
        
      } catch (error) {
        console.error('[CacheService] Failed to initialize IndexedDB:', error);
        this.db = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Get LocalStorage key for wallet
   */
  private getLocalStorageKey(address: string): string {
    return `${LOCALSTORAGE_PREFIX}${address}`;
  }

  /**
   * Check if cache is stale
   */
  private isCacheStale(lastUpdate: number): boolean {
    return Date.now() - lastUpdate > CACHE_TTL;
  }

  /**
   * Get wallet cache from LocalStorage (Fast)
   */
  getWalletCacheFast(address: string): WalletCache | null {
    try {
      const key = this.getLocalStorageKey(address);
      const cached = localStorage.getItem(key);
      
      if (!cached) {
        
        return null;
      }

      const data: WalletCache = JSON.parse(cached);
      
      // Validate cache version
      if (data.version !== CACHE_VERSION) {
        
        this.clearWalletCache(address);
        return null;
      }

      // Check if stale
      if (this.isCacheStale(data.lastUpdate)) {
        
        return data; // Return stale data, but caller should refresh
      }

      return data;
    } catch (error) {
      console.error('[CacheService] Error reading from LocalStorage:', error);
      return null;
    }
  }

  /**
   * Set wallet cache to LocalStorage (Fast)
   */
  setWalletCacheFast(data: WalletCache): void {
    try {
      const key = this.getLocalStorageKey(data.address);
      
      // Ensure version and timestamp
      data.version = CACHE_VERSION;
      data.lastUpdate = Date.now();
      
      // Limit recent activities to MAX_RECENT_ACTIVITIES
      if (data.recentActivities.length > MAX_RECENT_ACTIVITIES) {
        data.recentActivities = data.recentActivities
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_RECENT_ACTIVITIES);
      }

      localStorage.setItem(key, JSON.stringify(data));
      
    } catch (error) {
      console.error('[CacheService] Error writing to LocalStorage:', error);
      
      // If quota exceeded, clear old caches
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.warn('[CacheService] LocalStorage quota exceeded, clearing old caches');
        this.clearOldCaches();
        
        // Retry
        try {
          const key = this.getLocalStorageKey(data.address);
          localStorage.setItem(key, JSON.stringify(data));
        } catch (retryError) {
          console.error('[CacheService] Failed to write after clearing:', retryError);
        }
      }
    }
  }

  /**
   * Get wallet cache from IndexedDB (Slower, more data)
   */
  async getWalletCache(address: string): Promise<WalletCache | null> {
    await this.init();
    
    if (!this.db) {
      console.warn('[CacheService] IndexedDB not available, using LocalStorage only');
      return this.getWalletCacheFast(address);
    }

    try {
      const data = await this.db.get('wallets', address);
      
      if (!data) {
        
        return null;
      }

      // Validate cache version
      if (data.version !== CACHE_VERSION) {
        
        await this.clearWalletCache(address);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[CacheService] Error reading from IndexedDB:', error);
      return this.getWalletCacheFast(address);
    }
  }

  /**
   * Set wallet cache to IndexedDB
   */
  async setWalletCache(data: WalletCache): Promise<void> {
    await this.init();

    // Always write to LocalStorage first (fast)
    this.setWalletCacheFast(data);

    // Then write to IndexedDB (background)
    if (!this.db) {
      console.warn('[CacheService] IndexedDB not available, using LocalStorage only');
      return;
    }

    try {
      // Ensure version and timestamp
      data.version = CACHE_VERSION;
      data.lastUpdate = Date.now();
      
      await this.db.put('wallets', data);
      
    } catch (error) {
      console.error('[CacheService] Error writing to IndexedDB:', error);
    }
  }

  /**
   * Update specific fields in cache (partial update)
   */
  async updateWalletCache(
    address: string,
    updates: Partial<Omit<WalletCache, 'address' | 'version' | 'lastUpdate'>>
  ): Promise<void> {
    // Get existing cache
    const existing = this.getWalletCacheFast(address) || await this.getWalletCache(address);
    
    if (!existing) {
      console.warn('[CacheService] Cannot update non-existent cache:', address);
      return;
    }

    // Merge updates
    const updated: WalletCache = {
      ...existing,
      ...updates,
      address,
      version: CACHE_VERSION,
      lastUpdate: Date.now(),
    };

    // Write back
    await this.setWalletCache(updated);
  }

  /**
   * Clear wallet cache
   */
  async clearWalletCache(address: string): Promise<void> {
    // Clear LocalStorage
    const key = this.getLocalStorageKey(address);
    localStorage.removeItem(key);

    // Clear IndexedDB
    await this.init();
    if (this.db) {
      try {
        await this.db.delete('wallets', address);
        
      } catch (error) {
        console.error('[CacheService] Error clearing IndexedDB cache:', error);
      }
    }
  }

  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<void> {
    // Clear LocalStorage
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(LOCALSTORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }

    // Clear IndexedDB
    await this.init();
    if (this.db) {
      try {
        await this.db.clear('wallets');
        await this.db.clear('activities');
        
      } catch (error) {
        console.error('[CacheService] Error clearing IndexedDB:', error);
      }
    }
  }

  /**
   * Clear old caches (keep only recent 5 wallets)
   */
  private clearOldCaches(): void {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(k => k.startsWith(LOCALSTORAGE_PREFIX));
      
      // Parse and sort by lastUpdate
      const caches = cacheKeys
        .map(key => {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            return { key, lastUpdate: data.lastUpdate || 0 };
          } catch {
            return { key, lastUpdate: 0 };
          }
        })
        .sort((a, b) => b.lastUpdate - a.lastUpdate);

      // Keep only recent 5, remove others
      const toRemove = caches.slice(5);
      for (const { key } of toRemove) {
        localStorage.removeItem(key);
        
      }
    } catch (error) {
      console.error('[CacheService] Error clearing old caches:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    localStorageSize: number;
    localStorageCaches: number;
  } {
    const keys = Object.keys(localStorage);
    const cacheKeys = keys.filter(k => k.startsWith(LOCALSTORAGE_PREFIX));
    
    let totalSize = 0;
    for (const key of cacheKeys) {
      const value = localStorage.getItem(key);
      if (value) {
        totalSize += value.length;
      }
    }

    return {
      localStorageSize: totalSize,
      localStorageCaches: cacheKeys.length,
    };
  }
}

// ============================================================================
// Export Singleton
// ============================================================================

export const cacheService = new CacheService();
