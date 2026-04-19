/**
 * useCachedWalletData Hook
 * 
 * Provides cached wallet data with background refresh
 * 
 * Flow:
 * 1. Load from cache (instant - < 50ms)
 * 2. Display cached data immediately
 * 3. Fetch fresh data in background
 * 4. Silent update if different
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheService, WalletCache } from '@/services/cacheService';
import { fetchBalance, fetchEncryptedBalance } from '@/utils/api';

interface UseCachedWalletDataOptions {
  enableCache?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number; // ms
}

interface UseCachedWalletDataReturn {
  data: WalletCache | null;
  loading: boolean;
  isStale: boolean;
  isFetching: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  updateCache: (updates: Partial<WalletCache>) => Promise<void>;
}

export function useCachedWalletData(
  address: string | null,
  options: UseCachedWalletDataOptions = {}
): UseCachedWalletDataReturn {
  const {
    enableCache = true,
    autoRefresh = true,
    refreshInterval = 30000, // 30 seconds
  } = options;

  const [data, setData] = useState<WalletCache | null>(null);
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Load data from cache (instant)
   */
  const loadFromCache = useCallback(async (addr: string): Promise<WalletCache | null> => {
    if (!enableCache) return null;

    try {
      
      const cached = cacheService.getWalletCacheFast(addr);
      
      if (cached) {

        // Check if stale (> 5 min)
        const age = Date.now() - cached.lastUpdate;
        const isStaleData = age > 5 * 60 * 1000;
        
        if (isMountedRef.current) {
          setData(cached);
          setIsStale(isStaleData);
          setLoading(false);
        }
        
        return cached;
      } else {
        
        return null;
      }
    } catch (err) {
      console.error('[useCachedWalletData] Error loading from cache:', err);
      return null;
    }
  }, [enableCache]);

  /**
   * Fetch fresh data from blockchain
   */
  const fetchFreshData = useCallback(async (addr: string): Promise<WalletCache | null> => {
    try {
      
      setIsFetching(true);

      // Fetch public balance and nonce
      const balanceData = await fetchBalance(addr);
      
      // Fetch encrypted balance
      let encryptedBalanceData = { encrypted: 0, cipher: '0', public: 0 };
      try {
        const result = await fetchEncryptedBalance(addr);
        if (result && result.cipher) {
          encryptedBalanceData = {
            encrypted: result.encrypted,
            cipher: result.cipher,
            public: result.public || 0,
          };
        }
      } catch (err) {
        console.warn('[useCachedWalletData] Failed to fetch encrypted balance:', err);
      }

      // Create wallet cache data
      const freshData: WalletCache = {
        address: addr,
        publicBalance: balanceData.balance,
        encryptedBalance: {
          encrypted: encryptedBalanceData.encrypted,
          cipher: encryptedBalanceData.cipher,
          public: encryptedBalanceData.public,
        },
        nonce: balanceData.nonce,
        recentActivities: [], // Will be populated from history
        lastUpdate: Date.now(),
        version: '1.0.0',
      };

      // Save to cache
      if (enableCache) {
        await cacheService.setWalletCache(freshData);
      }

      if (isMountedRef.current) {
        setData(freshData);
        setIsStale(false);
        setError(null);
      }

      return freshData;
    } catch (err) {
      console.error('[useCachedWalletData] Error fetching fresh data:', err);
      
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to fetch data'));
      }
      
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsFetching(false);
      }
    }
  }, [enableCache]);

  /**
   * Refresh data (load from cache first, then fetch fresh)
   */
  const refresh = useCallback(async () => {
    if (!address) return;

    // Load from cache first (instant)
    await loadFromCache(address);

    // Fetch fresh data in background
    await fetchFreshData(address);
  }, [address, loadFromCache, fetchFreshData]);

  /**
   * Update cache with partial data
   */
  const updateCache = useCallback(async (updates: Partial<WalletCache>) => {
    if (!address || !enableCache) return;

    try {
      await cacheService.updateWalletCache(address, updates);
      
      // Update local state
      if (isMountedRef.current && data) {
        setData({
          ...data,
          ...updates,
          lastUpdate: Date.now(),
        });
      }
    } catch (err) {
      console.error('[useCachedWalletData] Error updating cache:', err);
    }
  }, [address, enableCache, data]);

  /**
   * Initial load and auto-refresh
   */
  useEffect(() => {
    if (!address) {
      setData(null);
      setLoading(false);
      return;
    }

    // Initial load
    setLoading(true);
    refresh();

    // Auto-refresh
    if (autoRefresh && refreshInterval > 0) {
      refreshTimerRef.current = setInterval(() => {
        
        fetchFreshData(address); // Background refresh only
      }, refreshInterval);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [address, autoRefresh, refreshInterval, refresh, fetchFreshData]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    data,
    loading,
    isStale,
    isFetching,
    error,
    refresh,
    updateCache,
  };
}
