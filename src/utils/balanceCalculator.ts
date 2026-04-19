/**
 * Balance Calculator Utility
 * 
 * Provides functions to calculate balance changes for different transaction types
 */

export interface Balance {
  public: number;
  encrypted: number;
}

export type TransactionType = 'send' | 'encrypt' | 'decrypt' | 'stealth' | 'claim' | 'contract';

/**
 * Calculate balance after SEND transaction
 */
export function calculateSendBalance(
  currentBalance: Balance,
  amount: number,
  fee: number
): Balance {
  return {
    public: Math.max(0, currentBalance.public - amount - fee),
    encrypted: currentBalance.encrypted,
  };
}

/**
 * Calculate balance after ENCRYPT transaction
 */
export function calculateEncryptBalance(
  currentBalance: Balance,
  amount: number
): Balance {
  return {
    public: Math.max(0, currentBalance.public - amount),
    encrypted: currentBalance.encrypted + amount,
  };
}

/**
 * Calculate balance after DECRYPT transaction
 */
export function calculateDecryptBalance(
  currentBalance: Balance,
  amount: number
): Balance {
  return {
    public: currentBalance.public + amount,
    encrypted: Math.max(0, currentBalance.encrypted - amount),
  };
}

/**
 * Calculate balance after STEALTH SEND transaction
 */
export function calculateStealthSendBalance(
  currentBalance: Balance,
  amount: number,
  fee: number
): Balance {
  return {
    public: currentBalance.public,
    encrypted: Math.max(0, currentBalance.encrypted - amount - fee),
  };
}

/**
 * Calculate balance after CLAIM transaction
 */
export function calculateClaimBalance(
  currentBalance: Balance,
  amount: number
): Balance {
  return {
    public: currentBalance.public,
    encrypted: currentBalance.encrypted + amount,
  };
}

/**
 * Calculate balance after CONTRACT CALL transaction
 */
export function calculateContractCallBalance(
  currentBalance: Balance,
  fee: number
): Balance {
  return {
    public: Math.max(0, currentBalance.public - fee),
    encrypted: currentBalance.encrypted,
  };
}

/**
 * Calculate balance change for any transaction type
 */
export function calculateBalanceChange(
  type: TransactionType,
  currentBalance: Balance,
  amount: number,
  fee: number = 0
): Balance {
  switch (type) {
    case 'send':
      return calculateSendBalance(currentBalance, amount, fee);
    case 'encrypt':
      return calculateEncryptBalance(currentBalance, amount);
    case 'decrypt':
      return calculateDecryptBalance(currentBalance, amount);
    case 'stealth':
      return calculateStealthSendBalance(currentBalance, amount, fee);
    case 'claim':
      return calculateClaimBalance(currentBalance, amount);
    case 'contract':
      return calculateContractCallBalance(currentBalance, fee);
    default:
      return currentBalance;
  }
}

/**
 * Calculate total balance (public + encrypted)
 */
export function calculateTotalBalance(balance: Balance): number {
  return balance.public + balance.encrypted;
}

/**
 * Calculate balance percentage distribution
 */
export function calculateBalancePercentage(balance: Balance): {
  publicPercent: number;
  encryptedPercent: number;
} {
  const total = calculateTotalBalance(balance);
  
  if (total === 0) {
    return { publicPercent: 0, encryptedPercent: 0 };
  }

  return {
    publicPercent: (balance.public / total) * 100,
    encryptedPercent: (balance.encrypted / total) * 100,
  };
}

/**
 * Format balance for display
 */
export function formatBalance(amount: number, decimals: number = 4): string {
  return amount.toFixed(decimals);
}

/**
 * Check if balance is sufficient for transaction
 */
export function isSufficientBalance(
  type: TransactionType,
  currentBalance: Balance,
  amount: number,
  fee: number = 0
): boolean {
  switch (type) {
    case 'send':
    case 'contract':
      return currentBalance.public >= amount + fee;
    case 'encrypt':
      return currentBalance.public >= amount;
    case 'decrypt':
      return currentBalance.encrypted >= amount;
    case 'stealth':
      return currentBalance.encrypted >= amount + fee;
    case 'claim':
      return true; // Claim doesn't require balance
    default:
      return false;
  }
}

/**
 * Get maximum sendable amount for transaction type
 */
export function getMaxSendableAmount(
  type: TransactionType,
  currentBalance: Balance,
  fee: number = 0
): number {
  switch (type) {
    case 'send':
    case 'contract':
      return Math.max(0, currentBalance.public - fee);
    case 'encrypt':
      return currentBalance.public;
    case 'decrypt':
      return currentBalance.encrypted;
    case 'stealth':
      return Math.max(0, currentBalance.encrypted - fee);
    case 'claim':
      return 0; // Claim doesn't send
    default:
      return 0;
  }
}

/**
 * Validate balance change
 */
export function validateBalanceChange(
  before: Balance,
  after: Balance,
  tolerance: number = 0.000001
): {
  valid: boolean;
  publicDiff: number;
  encryptedDiff: number;
  totalDiff: number;
} {
  const publicDiff = after.public - before.public;
  const encryptedDiff = after.encrypted - before.encrypted;
  const totalDiff = calculateTotalBalance(after) - calculateTotalBalance(before);

  // Check if differences are within tolerance
  const valid = Math.abs(totalDiff) <= tolerance;

  return {
    valid,
    publicDiff,
    encryptedDiff,
    totalDiff,
  };
}
