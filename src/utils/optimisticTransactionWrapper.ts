/**
 * Optimistic Transaction Wrapper
 * 
 * Wraps transaction functions with optimistic updates
 * Provides instant UI feedback before blockchain confirmation
 */

import { optimisticUpdateService, UpdateType, OptimisticUpdate } from '@/services/optimisticUpdateService';

export interface TransactionResult {
  success: boolean;
  hash?: string;
  error?: string;
  [key: string]: any;
}

export interface OptimisticTransactionOptions {
  address: string;
  type: UpdateType;
  amount: number;
  currentBalance: { public: number; encrypted: number };
  fee?: number;
  onUpdateCreated?: (update: OptimisticUpdate) => void;
  onTransactionHash?: (hash: string, updateId: string) => void;
  onSuccess?: (result: any, updateId: string) => void;
  onError?: (error: Error, updateId: string) => void;
  onVerified?: (actualBalance: { public: number; encrypted: number }, updateId: string) => void;
}

/**
 * Wrap transaction function with optimistic update
 */
export async function withOptimisticUpdate<T extends TransactionResult>(
  options: OptimisticTransactionOptions,
  transactionFn: () => Promise<T>
): Promise<T> {
  const {
    address,
    type,
    amount,
    currentBalance,
    fee = 0,
    onUpdateCreated,
    onTransactionHash,
    onSuccess,
    onError,
  } = options;

  // Apply optimistic update (instant)
  const update = optimisticUpdateService.applyUpdate(
    address,
    type,
    amount,
    currentBalance,
    fee
  );

  // Notify caller
  if (onUpdateCreated) {
    onUpdateCreated(update);
  }

  try {
    // Execute transaction
    
    const result = await transactionFn();

    // Check if transaction was successful
    if (!result.success) {
      const errorMsg = result.error || 'Transaction failed';
      console.error('[OptimisticWrapper] Transaction failed:', errorMsg);
      
      // Fail optimistic update
      await optimisticUpdateService.failUpdate(update.id, errorMsg);
      
      // Notify caller
      if (onError) {
        onError(new Error(errorMsg), update.id);
      }
      
      return result;
    }

    // Update transaction hash if available
    if (result.hash) {
      optimisticUpdateService.updateTransactionHash(update.id, result.hash);
      
      if (onTransactionHash) {
        onTransactionHash(result.hash, update.id);
      }
    }

    // Notify caller
    if (onSuccess) {
      onSuccess(result, update.id);
    }

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    console.error('[OptimisticWrapper] Transaction error:', err);
    
    // Fail optimistic update and rollback
    await optimisticUpdateService.failUpdate(update.id, err.message);
    await optimisticUpdateService.rollbackUpdate(update.id, currentBalance);
    
    // Notify caller
    if (onError) {
      onError(err, update.id);
    }
    
    throw error;
  }
}

/**
 * Verify optimistic update against actual blockchain data
 */
export async function verifyOptimisticUpdate(
  updateId: string,
  actualBalance: { public: number; encrypted: number },
  onVerified?: (actualBalance: { public: number; encrypted: number }) => void
): Promise<void> {

  await optimisticUpdateService.verifyUpdate(updateId, actualBalance);
  
  const update = optimisticUpdateService.getUpdate(updateId);
  
  if (update?.verification.discrepancy) {
    console.warn('[OptimisticWrapper] Discrepancy detected:', {
      optimistic: update.optimisticBalance,
      actual: actualBalance,
      diff: update.verification.discrepancyAmount,
    });
  } else {
    
  }
  
  if (onVerified) {
    onVerified(actualBalance);
  }
}

/**
 * Helper: Create optimistic transaction handler for specific type
 */
export function createOptimisticHandler(
  type: UpdateType,
  getBalance: () => { public: number; encrypted: number },
  getFee: () => number = () => 0
) {
  return async <T extends TransactionResult>(
    address: string,
    amount: number,
    transactionFn: () => Promise<T>,
    callbacks?: {
      onUpdateCreated?: (update: OptimisticUpdate) => void;
      onTransactionHash?: (hash: string, updateId: string) => void;
      onSuccess?: (result: T, updateId: string) => void;
      onError?: (error: Error, updateId: string) => void;
    }
  ): Promise<T> => {
    return withOptimisticUpdate(
      {
        address,
        type,
        amount,
        currentBalance: getBalance(),
        fee: getFee(),
        ...callbacks,
      },
      transactionFn
    );
  };
}

/**
 * Helper: Get update status
 */
export function getUpdateStatus(updateId: string): {
  exists: boolean;
  status?: 'pending' | 'confirming' | 'confirmed' | 'failed';
  verified?: boolean;
  discrepancy?: boolean;
} {
  const update = optimisticUpdateService.getUpdate(updateId);
  
  if (!update) {
    return { exists: false };
  }
  
  return {
    exists: true,
    status: update.transaction.status,
    verified: update.verification.verified,
    discrepancy: update.verification.discrepancy,
  };
}

/**
 * Helper: Check if address has pending updates
 */
export function hasPendingUpdates(address: string): boolean {
  return optimisticUpdateService.hasPendingUpdates(address);
}

/**
 * Helper: Get pending updates for address
 */
export function getPendingUpdates(address: string): OptimisticUpdate[] {
  return optimisticUpdateService.getPendingUpdates(address);
}

/**
 * Helper: Clear pending updates for address
 */
export function clearPendingUpdates(address: string): void {
  optimisticUpdateService.clearAddress(address);
}
