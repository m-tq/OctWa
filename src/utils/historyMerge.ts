/**
 * History Merge Utility
 * Handles merging, sorting, and filtering of transactions and contract interactions
 * into a unified history view.
 */

// Transaction interface (from existing codebase)
export interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
  message?: string;
  op_type?: string;
}

// Contract interaction interface (from existing codebase)
export interface ContractInteraction {
  type: 'view' | 'call';
  contractAddress: string;
  methodName: string;
  params: string[];
  result?: any;
  txHash?: string;
  error?: string;
  timestamp: number;
  success: boolean;
  walletAddress: string;
}

// Unified history item type
export type HistoryItemType = 'transfer' | 'contract';

export interface UnifiedHistoryItem {
  id: string;
  type: HistoryItemType;
  timestamp: number;
  // Original data reference
  transaction?: Transaction;
  contractInteraction?: ContractInteraction;
}

// Filter type for history
export type HistoryFilter = 'all' | 'public' | 'private' | 'sent' | 'received' | 'contract';

/**
 * Merges transactions and contract interactions into a unified history list.
 * Each item is tagged with its type for badge display.
 * 
 * @param transactions - Array of transactions
 * @param contracts - Array of contract interactions
 * @returns Merged array of unified history items (unsorted)
 */
export function mergeHistory(
  transactions: Transaction[],
  contracts: ContractInteraction[]
): UnifiedHistoryItem[] {
  const mergedItems: UnifiedHistoryItem[] = [];

  // Add transactions
  transactions.forEach((tx, index) => {
    mergedItems.push({
      id: tx.hash || `tx-${index}-${tx.timestamp}`,
      type: 'transfer',
      timestamp: tx.timestamp,
      transaction: tx,
    });
  });

  // Add contract interactions
  contracts.forEach((contract, index) => {
    mergedItems.push({
      id: contract.txHash || `contract-${index}-${contract.timestamp}`,
      type: 'contract',
      timestamp: contract.timestamp,
      contractInteraction: contract,
    });
  });

  return mergedItems;
}

/**
 * Sorts history items by timestamp in descending order (newest first).
 * 
 * @param items - Array of unified history items
 * @returns Sorted array (newest first)
 */
export function sortHistoryByTimestamp(items: UnifiedHistoryItem[]): UnifiedHistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Filters history items by type.
 * 
 * @param items - Array of unified history items
 * @param filter - Filter to apply ('all', 'public', 'private', 'sent', 'received', or 'contract')
 * @returns Filtered array
 */
export function filterHistory(
  items: UnifiedHistoryItem[],
  filter: HistoryFilter
): UnifiedHistoryItem[] {
  if (filter === 'all') {
    return items;
  }

  if (filter === 'public') {
    return items.filter(item => item.type === 'transfer' && item.transaction && !isPrivateTransfer(item.transaction));
  }

  if (filter === 'private') {
    return items.filter(item => item.type === 'transfer' && item.transaction && isPrivateTransfer(item.transaction));
  }

  if (filter === 'sent') {
    return items.filter(item => item.type === 'transfer' && item.transaction?.type === 'sent');
  }

  if (filter === 'received') {
    return items.filter(item => item.type === 'transfer' && item.transaction?.type === 'received');
  }

  if (filter === 'contract') {
    return items.filter(item => item.type === 'contract');
  }

  return items;
}

/**
 * Convenience function that merges, sorts, and optionally filters history.
 * 
 * @param transactions - Array of transactions
 * @param contracts - Array of contract interactions
 * @param filter - Optional filter to apply (defaults to 'all')
 * @returns Merged, sorted, and filtered array
 */
export function getUnifiedHistory(
  transactions: Transaction[],
  contracts: ContractInteraction[],
  filter: HistoryFilter = 'all'
): UnifiedHistoryItem[] {
  const merged = mergeHistory(transactions, contracts);
  const sorted = sortHistoryByTimestamp(merged);
  return filterHistory(sorted, filter);
}

/**
 * Checks if a transaction is a private transfer based on its op_type or message.
 * Includes: private transfers, encrypt balance, decrypt balance
 * 
 * @param tx - Transaction to check
 * @returns true if the transaction is a private/encrypted activity
 */
export function isPrivateTransfer(tx: Transaction): boolean {
  // Check op_type first (most reliable)
  if (tx.op_type) {
    return tx.op_type === 'private' || tx.op_type === 'encrypt' || tx.op_type === 'decrypt';
  }
  
  // Fallback to message-based detection for older transactions
  return (
    tx.message === 'PRIVATE_TRANSFER' ||
    tx.message === '505249564154455f5452414e53464552' || // hex encoded PRIVATE_TRANSFER
    tx.message === 'ENCRYPT_BALANCE' ||
    tx.message === 'DECRYPT_BALANCE' ||
    tx.message === '454e43525950545f42414c414e4345' || // hex encoded ENCRYPT_BALANCE
    tx.message === '444543525950545f42414c414e4345' || // hex encoded DECRYPT_BALANCE
    (tx.amount === 0 && !!tx.message)
  );
}

/**
 * Checks if a transaction is a contract call based on its op_type.
 * 
 * @param tx - Transaction to check
 * @returns true if the transaction is a contract call
 */
export function isContractCall(tx: Transaction): boolean {
  return tx.op_type === 'call';
}
