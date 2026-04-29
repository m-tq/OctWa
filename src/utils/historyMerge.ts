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
type HistoryItemType = 'transfer' | 'contract';

interface UnifiedHistoryItem {
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
function mergeHistory(
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
function sortHistoryByTimestamp(items: UnifiedHistoryItem[]): UnifiedHistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Filters history items by type.
 * 
 * @param items - Array of unified history items
 * @param filter - Filter to apply ('all', 'public', 'private', 'sent', 'received', or 'contract')
 * @returns Filtered array
 */
function filterHistory(
  items: UnifiedHistoryItem[],
  filter: HistoryFilter
): UnifiedHistoryItem[] {
  if (filter === 'all') {
    return items;
  }

  if (filter === 'public') {
    return items.filter(item =>
      item.type === 'transfer' &&
      item.transaction &&
      !isPrivateTransfer(item.transaction) &&
      !isBalanceStateChange(item.transaction) &&
      !isContractCall(item.transaction)
    );
  }

  if (filter === 'private') {
    return items.filter(item =>
      item.type === 'transfer' &&
      item.transaction &&
      (isPrivateTransfer(item.transaction) || isBalanceStateChange(item.transaction))
    );
  }

  if (filter === 'sent') {
    return items.filter(item =>
      item.type === 'transfer' &&
      item.transaction?.type === 'sent' &&
      !isPrivateTransfer(item.transaction) &&
      !isBalanceStateChange(item.transaction) &&
      !isContractCall(item.transaction)
    );
  }

  if (filter === 'received') {
    return items.filter(item =>
      item.type === 'transfer' &&
      item.transaction?.type === 'received' &&
      !isPrivateTransfer(item.transaction) &&
      !isBalanceStateChange(item.transaction) &&
      !isContractCall(item.transaction)
    );
  }

  if (filter === 'contract') {
    return items.filter(item =>
      item.type === 'contract' ||
      (item.type === 'transfer' && item.transaction && isContractCall(item.transaction))
    );
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
 * Checks if a transaction is a private transfer (stealth send or claim).
 * Does NOT include encrypt/decrypt — those are balance state changes, not transfers.
 */
export function isPrivateTransfer(tx: Transaction): boolean {
  if (tx.op_type) {
    return tx.op_type === 'stealth' ||
           tx.op_type === 'claim' ||
           tx.op_type === 'private'; // legacy alias
  }
  return (
    tx.message === 'PRIVATE_TRANSFER' ||
    tx.message === '505249564154455f5452414e53464552'
  );
}

/**
 * Checks if a transaction is a balance state change (encrypt or decrypt).
 * These are self-to-self operations that move funds between public and private balance.
 */
export function isBalanceStateChange(tx: Transaction): boolean {
  return tx.op_type === 'encrypt' || tx.op_type === 'decrypt';
}

/**
 * Checks if a transaction is a contract call or deploy.
 */
export function isContractCall(tx: Transaction): boolean {
  return tx.op_type === 'call' || tx.op_type === 'deploy';
}
