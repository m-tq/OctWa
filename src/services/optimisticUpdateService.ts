/**
 * Optimistic Update Service
 * 
 * Provides instant UI updates before blockchain confirmation
 * Verifies updates in background and handles discrepancies
 * 
 * Flow:
 * 1. User action → Apply optimistic update (instant)
 * 2. Submit to blockchain (background)
 * 3. Verify from node (background)
 * 4. Silent update if match, notify if mismatch
 */

import { cacheService } from './cacheService';
import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

export type UpdateType = 'send' | 'encrypt' | 'decrypt' | 'stealth' | 'claim' | 'contract';

export interface OptimisticUpdate {
  id: string;
  address: string;
  type: UpdateType;
  timestamp: number;
  
  // Optimistic values
  optimisticBalance: {
    public: number;
    encrypted: number;
  };
  
  // Transaction info
  transaction: {
    hash?: string;
    amount: number;
    fee?: number;
    status: 'pending' | 'confirming' | 'confirmed' | 'failed';
  };
  
  // Verification
  verification: {
    verified: boolean;
    actualBalance?: {
      public: number;
      encrypted: number;
    };
    discrepancy?: boolean;
    discrepancyAmount?: number;
  };
}

export interface BalanceUpdate {
  public?: number;
  encrypted?: number;
}

// ============================================================================
// Optimistic Update Service Class
// ============================================================================

class OptimisticUpdateService {
  private updates: Map<string, OptimisticUpdate> = new Map();
  private listeners: Set<(updates: OptimisticUpdate[]) => void> = new Set();

  /**
   * Generate unique update ID
   */
  private generateId(): string {
    return `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Notify listeners of update changes
   */
  private notifyListeners(): void {
    const updates = Array.from(this.updates.values());
    this.listeners.forEach(listener => listener(updates));
  }

  /**
   * Subscribe to update changes
   */
  subscribe(listener: (updates: OptimisticUpdate[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Calculate optimistic balance for SEND transaction
   */
  private calculateSendBalance(
    currentBalance: { public: number; encrypted: number },
    amount: number,
    fee: number
  ): BalanceUpdate {
    return {
      public: Math.max(0, currentBalance.public - amount - fee),
    };
  }

  /**
   * Calculate optimistic balance for ENCRYPT transaction
   */
  private calculateEncryptBalance(
    currentBalance: { public: number; encrypted: number },
    amount: number
  ): BalanceUpdate {
    return {
      public: Math.max(0, currentBalance.public - amount),
      encrypted: currentBalance.encrypted + amount,
    };
  }

  /**
   * Calculate optimistic balance for DECRYPT transaction
   */
  private calculateDecryptBalance(
    currentBalance: { public: number; encrypted: number },
    amount: number
  ): BalanceUpdate {
    return {
      public: currentBalance.public + amount,
      encrypted: Math.max(0, currentBalance.encrypted - amount),
    };
  }

  /**
   * Calculate optimistic balance for STEALTH SEND transaction
   */
  private calculateStealthSendBalance(
    currentBalance: { public: number; encrypted: number },
    amount: number,
    fee: number
  ): BalanceUpdate {
    return {
      encrypted: Math.max(0, currentBalance.encrypted - amount - fee),
    };
  }

  /**
   * Calculate optimistic balance for CLAIM transaction
   */
  private calculateClaimBalance(
    currentBalance: { public: number; encrypted: number },
    amount: number
  ): BalanceUpdate {
    return {
      encrypted: currentBalance.encrypted + amount,
    };
  }

  /**
   * Apply optimistic update
   */
  applyUpdate(
    address: string,
    type: UpdateType,
    amount: number,
    currentBalance: { public: number; encrypted: number },
    fee: number = 0
  ): OptimisticUpdate {
    const id = this.generateId();
    
    // Calculate optimistic balance based on type
    let balanceUpdate: BalanceUpdate;
    
    switch (type) {
      case 'send':
        balanceUpdate = this.calculateSendBalance(currentBalance, amount, fee);
        break;
      case 'encrypt':
        balanceUpdate = this.calculateEncryptBalance(currentBalance, amount);
        break;
      case 'decrypt':
        balanceUpdate = this.calculateDecryptBalance(currentBalance, amount);
        break;
      case 'stealth':
        balanceUpdate = this.calculateStealthSendBalance(currentBalance, amount, fee);
        break;
      case 'claim':
        balanceUpdate = this.calculateClaimBalance(currentBalance, amount);
        break;
      case 'contract':
        // For contract calls, just deduct fee
        balanceUpdate = { public: Math.max(0, currentBalance.public - fee) };
        break;
      default:
        balanceUpdate = {};
    }

    const update: OptimisticUpdate = {
      id,
      address,
      type,
      timestamp: Date.now(),
      optimisticBalance: {
        public: balanceUpdate.public ?? currentBalance.public,
        encrypted: balanceUpdate.encrypted ?? currentBalance.encrypted,
      },
      transaction: {
        amount,
        fee,
        status: 'pending',
      },
      verification: {
        verified: false,
      },
    };

    this.updates.set(id, update);
    this.notifyListeners();

    logger.optimistic('apply', id, `${type} update: ${amount} (fee: ${fee})`);

    // Update cache with optimistic values
    this.updateCacheOptimistic(address, update.optimisticBalance);

    return update;
  }

  /**
   * Update cache with optimistic balance
   */
  private async updateCacheOptimistic(
    address: string,
    balance: { public: number; encrypted: number }
  ): Promise<void> {
    try {
      await cacheService.updateWalletCache(address, {
        publicBalance: balance.public,
        encryptedBalance: {
          encrypted: balance.encrypted,
          cipher: '', // Keep existing cipher
        },
      });
    } catch (error) {
      logger.error('Failed to update cache', error);
    }
  }

  /**
   * Update transaction hash
   */
  updateTransactionHash(updateId: string, hash: string): void {
    const update = this.updates.get(updateId);
    if (!update) {
      logger.warn(`Update not found: ${updateId}`);
      return;
    }

    update.transaction.hash = hash;
    update.transaction.status = 'confirming';
    this.updates.set(updateId, update);
    this.notifyListeners();

    logger.optimistic('tx_hash', updateId, hash.substring(0, 10) + '...');
  }

  /**
   * Verify update against actual blockchain data
   */
  async verifyUpdate(
    updateId: string,
    actualBalance: { public: number; encrypted: number }
  ): Promise<void> {
    const update = this.updates.get(updateId);
    if (!update) {
      logger.warn(`Update not found: ${updateId}`);
      return;
    }

    const optimistic = update.optimisticBalance;
    const tolerance = 0.000001; // 1 micro-OCT tolerance for floating point

    // Check for discrepancy
    const publicMatch = Math.abs(optimistic.public - actualBalance.public) < tolerance;
    const encryptedMatch = Math.abs(optimistic.encrypted - actualBalance.encrypted) < tolerance;
    const hasDiscrepancy = !publicMatch || !encryptedMatch;

    update.verification = {
      verified: true,
      actualBalance,
      discrepancy: hasDiscrepancy,
      discrepancyAmount: hasDiscrepancy
        ? Math.abs(
            (optimistic.public + optimistic.encrypted) -
            (actualBalance.public + actualBalance.encrypted)
          )
        : 0,
    };

    update.transaction.status = 'confirmed';
    this.updates.set(updateId, update);
    this.notifyListeners();

    if (hasDiscrepancy) {
      logger.warn(`Discrepancy detected in ${updateId}`, {
        optimistic,
        actual: actualBalance
      });

      // Update cache with actual values
      await this.updateCacheOptimistic(update.address, actualBalance);
    } else {
      logger.optimistic('verify', updateId, 'Verified successfully');
    }

    // Remove update after 30 seconds
    setTimeout(() => {
      this.updates.delete(updateId);
      this.notifyListeners();
    }, 30000);
  }

  /**
   * Mark update as failed
   */
  async failUpdate(updateId: string, reason?: string): Promise<void> {
    const update = this.updates.get(updateId);
    if (!update) {
      logger.warn(`Update not found: ${updateId}`);
      return;
    }

    update.transaction.status = 'failed';
    this.updates.set(updateId, update);
    this.notifyListeners();

    logger.optimistic('fail', updateId, reason || 'Unknown error');

    // Rollback: fetch fresh balance and update cache
    // This will be handled by the caller
  }

  /**
   * Rollback update (restore previous balance)
   */
  async rollbackUpdate(
    updateId: string,
    previousBalance: { public: number; encrypted: number }
  ): Promise<void> {
    const update = this.updates.get(updateId);
    if (!update) {
      logger.warn(`Update not found: ${updateId}`);
      return;
    }

    logger.optimistic('rollback', updateId, 'Rolling back update');

    // Update cache with previous balance
    await this.updateCacheOptimistic(update.address, previousBalance);

    // Remove update
    this.updates.delete(updateId);
    this.notifyListeners();
  }

  /**
   * Get pending updates for an address
   */
  getPendingUpdates(address?: string): OptimisticUpdate[] {
    const allUpdates = Array.from(this.updates.values());
    
    if (address) {
      return allUpdates.filter(u => u.address === address);
    }
    
    return allUpdates;
  }

  /**
   * Get update by ID
   */
  getUpdate(updateId: string): OptimisticUpdate | undefined {
    return this.updates.get(updateId);
  }

  /**
   * Check if there are pending updates for an address
   */
  hasPendingUpdates(address: string): boolean {
    return this.getPendingUpdates(address).length > 0;
  }

  /**
   * Get total pending amount for an address
   */
  getTotalPendingAmount(address: string): { public: number; encrypted: number } {
    const pending = this.getPendingUpdates(address);
    
    return pending.reduce(
      (acc, update) => ({
        public: acc.public + (update.transaction.amount || 0),
        encrypted: acc.encrypted + (update.transaction.amount || 0),
      }),
      { public: 0, encrypted: 0 }
    );
  }

  /**
   * Clear all updates (use with caution)
   */
  clearAll(): void {
    this.updates.clear();
    this.notifyListeners();
    logger.debug('Cleared all optimistic updates');
  }

  /**
   * Clear updates for specific address
   */
  clearAddress(address: string): void {
    const toDelete: string[] = [];
    
    this.updates.forEach((update, id) => {
      if (update.address === address) {
        toDelete.push(id);
      }
    });

    toDelete.forEach(id => this.updates.delete(id));
    this.notifyListeners();
    
    logger.debug(`Cleared ${toDelete.length} updates for ${address}`);
  }
}

// ============================================================================
// Export Singleton
// ============================================================================

export const optimisticUpdateService = new OptimisticUpdateService();
