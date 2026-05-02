// Merges, sorts, and filters transactions and contract interactions into a unified history view.

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

export interface ContractInteraction {
  type: 'view' | 'call';
  contractAddress: string;
  methodName: string;
  params: string[];
  result?: unknown;
  txHash?: string;
  error?: string;
  timestamp: number;
  success: boolean;
  walletAddress: string;
}

type HistoryItemType = 'transfer' | 'contract';

interface UnifiedHistoryItem {
  id: string;
  type: HistoryItemType;
  timestamp: number;
  transaction?: Transaction;
  contractInteraction?: ContractInteraction;
}

export type HistoryFilter = 'all' | 'public' | 'private' | 'sent' | 'received' | 'contract';

function mergeHistory(
  transactions: Transaction[],
  contracts: ContractInteraction[],
): UnifiedHistoryItem[] {
  const txItems: UnifiedHistoryItem[] = transactions.map((tx, index) => ({
    id: tx.hash || `tx-${index}-${tx.timestamp}`,
    type: 'transfer' as const,
    timestamp: tx.timestamp,
    transaction: tx,
  }));

  const contractItems: UnifiedHistoryItem[] = contracts.map((contract, index) => ({
    id: contract.txHash || `contract-${index}-${contract.timestamp}`,
    type: 'contract' as const,
    timestamp: contract.timestamp,
    contractInteraction: contract,
  }));

  return [...txItems, ...contractItems];
}

function sortByTimestampDesc(items: UnifiedHistoryItem[]): UnifiedHistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

function applyFilter(items: UnifiedHistoryItem[], filter: HistoryFilter): UnifiedHistoryItem[] {
  if (filter === 'all') return items;

  if (filter === 'public') {
    return items.filter(
      (item) =>
        item.type === 'transfer' &&
        item.transaction &&
        !isPrivateTransfer(item.transaction) &&
        !isBalanceStateChange(item.transaction) &&
        !isContractCall(item.transaction),
    );
  }

  if (filter === 'private') {
    return items.filter(
      (item) =>
        item.type === 'transfer' &&
        item.transaction &&
        (isPrivateTransfer(item.transaction) || isBalanceStateChange(item.transaction)),
    );
  }

  if (filter === 'sent') {
    return items.filter(
      (item) =>
        item.type === 'transfer' &&
        item.transaction?.type === 'sent' &&
        !isPrivateTransfer(item.transaction) &&
        !isBalanceStateChange(item.transaction) &&
        !isContractCall(item.transaction),
    );
  }

  if (filter === 'received') {
    return items.filter(
      (item) =>
        item.type === 'transfer' &&
        item.transaction?.type === 'received' &&
        !isPrivateTransfer(item.transaction) &&
        !isBalanceStateChange(item.transaction) &&
        !isContractCall(item.transaction),
    );
  }

  if (filter === 'contract') {
    return items.filter(
      (item) =>
        item.type === 'contract' ||
        (item.type === 'transfer' && item.transaction && isContractCall(item.transaction)),
    );
  }

  return items;
}

export function getUnifiedHistory(
  transactions: Transaction[],
  contracts: ContractInteraction[],
  filter: HistoryFilter = 'all',
): UnifiedHistoryItem[] {
  const merged = mergeHistory(transactions, contracts);
  const sorted = sortByTimestampDesc(merged);
  return applyFilter(sorted, filter);
}

/** Returns true if the transaction is a stealth send or claim (not encrypt/decrypt). */
export function isPrivateTransfer(tx: Transaction): boolean {
  if (tx.op_type) {
    return tx.op_type === 'stealth' || tx.op_type === 'claim' || tx.op_type === 'private';
  }
  return (
    tx.message === 'PRIVATE_TRANSFER' ||
    tx.message === '505249564154455f5452414e53464552'
  );
}

/** Returns true if the transaction moves funds between public and private balance. */
export function isBalanceStateChange(tx: Transaction): boolean {
  return tx.op_type === 'encrypt' || tx.op_type === 'decrypt';
}

/** Returns true if the transaction is a contract call or deploy. */
export function isContractCall(tx: Transaction): boolean {
  return tx.op_type === 'call' || tx.op_type === 'deploy';
}
