/**
 * useOptimisticBalance Hook
 * 
 * Provides balance with optimistic updates
 * 
 * Flow:
 * 1. Display actual balance
 * 2. Apply optimistic update on transaction (instant)
 * 3. Show pending state
 * 4. Verify in background
 * 5. Update to actual balance (silent if match)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  optimisticUpdateService, 
  OptimisticUpdate, 
  UpdateType 
} from '@/services/optimisticUpdateService';

interface Balance {
  public: number;
  encrypted: number;
}

interface UseOptimisticBalanceOptions {
  enableOptimistic?: boolean;
}

interface UseOptimisticBalanceReturn {
  // Displayed balance (actual + optimistic)
  displayBalance: Balance;
  
  // Actual balance (from blockchain)
  actualBalance: Balance;
  
  // Pending updates
  pendingUpdates: OptimisticUpdate[];
  
  // Has pending updates
  hasPending: boolean;
  
  // Total pending amount
  pendingAmount: Balance;
  
  // Apply optimistic update
  applyUpdate: (
    type: UpdateType,
    amount: number,
    fee?: number
  ) => OptimisticUpdate;
  
  // Update actual balance (from blockchain)
  setActualBalance: (balance: Balance) => void;
  
  // Verify update
  verifyUpdate: (updateId: string, actualBalance: Balance) => Promise<void>;
  
  // Fail update
  failUpdate: (updateId: string, reason?: string) => Promise<void>;
  
  // Clear all pending
  clearPending: () => void;
}

export function useOptimisticBalance(
  address: string | null,
  initialBalance: Balance = { public: 0, encrypted: 0 },
  options: UseOptimisticBalanceOptions = {}
): UseOptimisticBalanceReturn {
  const { enableOptimistic = true } = options;

  const [actualBalance, setActualBalance] = useState<Balance>(initialBalance);
  const [pendingUpdates, setPendingUpdates] = useState<OptimisticUpdate[]>([]);
  
  const isMountedRef = useRef(true);

  /**
   * Calculate displayed balance (actual + pending optimistic)
   */
  const displayBalance = useCallback((): Balance => {
    if (!enableOptimistic || pendingUpdates.length === 0) {
      return actualBalance;
    }

    // Get the latest pending update's optimistic balance
    const latestUpdate = pendingUpdates[pendingUpdates.length - 1];
    return latestUpdate.optimisticBalance;
  }, [actualBalance, pendingUpdates, enableOptimistic]);

  /**
   * Calculate total pending amount
   */
  const pendingAmount = useCallback((): Balance => {
    return pendingUpdates.reduce(
      (acc, update) => ({
        public: acc.public + (update.transaction.amount || 0),
        encrypted: acc.encrypted + (update.transaction.amount || 0),
      }),
      { public: 0, encrypted: 0 }
    );
  }, [pendingUpdates]);

  /**
   * Apply optimistic update
   */
  const applyUpdate = useCallback(
    (type: UpdateType, amount: number, fee: number = 0): OptimisticUpdate => {
      if (!address) {
        throw new Error('Cannot apply update without address');
      }

      if (!enableOptimistic) {
        console.warn('[useOptimisticBalance] Optimistic updates disabled');
        // Return a dummy update
        return {
          id: 'disabled',
          address,
          type,
          timestamp: Date.now(),
          optimisticBalance: actualBalance,
          transaction: { amount, fee, status: 'pending' },
          verification: { verified: false },
        };
      }

      // Use the latest balance (either actual or from last pending update)
      const currentBalance = pendingUpdates.length > 0
        ? pendingUpdates[pendingUpdates.length - 1].optimisticBalance
        : actualBalance;

      const update = optimisticUpdateService.applyUpdate(
        address,
        type,
        amount,
        currentBalance,
        fee
      );

      // Update local state
      if (isMountedRef.current) {
        setPendingUpdates(prev => [...prev, update]);
      }

      return update;
    },
    [address, actualBalance, pendingUpdates, enableOptimistic]
  );

  /**
   * Verify update against actual blockchain data
   */
  const verifyUpdate = useCallback(
    async (updateId: string, actualBalanceData: Balance): Promise<void> => {

      await optimisticUpdateService.verifyUpdate(updateId, actualBalanceData);

      // Update actual balance
      if (isMountedRef.current) {
        setActualBalance(actualBalanceData);
      }

      // Remove verified update from pending
      if (isMountedRef.current) {
        setPendingUpdates(prev => prev.filter(u => u.id !== updateId));
      }
    },
    []
  );

  /**
   * Fail update and rollback
   */
  const failUpdate = useCallback(
    async (updateId: string, reason?: string): Promise<void> => {

      await optimisticUpdateService.failUpdate(updateId, reason);

      // Rollback to actual balance
      await optimisticUpdateService.rollbackUpdate(updateId, actualBalance);

      // Remove failed update from pending
      if (isMountedRef.current) {
        setPendingUpdates(prev => prev.filter(u => u.id !== updateId));
      }
    },
    [actualBalance]
  );

  /**
   * Clear all pending updates
   */
  const clearPending = useCallback(() => {
    if (address) {
      optimisticUpdateService.clearAddress(address);
    }
    
    if (isMountedRef.current) {
      setPendingUpdates([]);
    }
  }, [address]);

  /**
   * Subscribe to optimistic update changes
   */
  useEffect(() => {
    if (!address || !enableOptimistic) return;

    const unsubscribe = optimisticUpdateService.subscribe((updates) => {
      // Filter updates for this address
      const addressUpdates = updates.filter(u => u.address === address);
      
      if (isMountedRef.current) {
        setPendingUpdates(addressUpdates);
      }
    });

    return unsubscribe;
  }, [address, enableOptimistic]);

  /**
   * Update actual balance when initial balance changes
   */
  useEffect(() => {
    setActualBalance(initialBalance);
  }, [initialBalance.public, initialBalance.encrypted]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    displayBalance: displayBalance(),
    actualBalance,
    pendingUpdates,
    hasPending: pendingUpdates.length > 0,
    pendingAmount: pendingAmount(),
    applyUpdate,
    setActualBalance,
    verifyUpdate,
    failUpdate,
    clearPending,
  };
}
