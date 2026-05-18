export interface Wallet {
  address: string;
  privateKey: string;
  mnemonic?: string;
  publicKey?: string;
  type?: 'generated' | 'imported-mnemonic' | 'imported-private-key';
}

export interface WalletData {
  address: string;
  privateKey: string;
  publicKey: string;
  balance: number;
  nonce: number;
  mnemonic?: string;
}

export interface MultiSendRecipient {
  address: string;
  amount: number;
}

export interface TransactionData {
  from: string;
  to: string;
  amount: number;
  gasPrice: number;
  gasLimit: number;
  privateKey: string;
}

export interface WalletBalance {
  balance: number;
  currency: string;
}

// New interfaces for the actual API
export interface BalanceResponse {
  balance: number;
  nonce: number;
}

export interface EncryptedBalanceResponse {
  public: number;
  public_raw: number;
  encrypted: number;
  encrypted_raw: number;
  total: number;
  cipher?: string; // PVAC encrypted balance cipher
}

export interface Transaction {
  from: string;
  to_: string;
  amount: string;
  nonce: number;
  ou: string;
  timestamp: number;
  message?: string;
  signature?: string;
  public_key?: string;
  op_type?: string;
  encrypted_data?: string;
}

export interface AddressHistoryResponse {
  transactions: TransactionHistoryItem[];
  balance: number;
}

export interface TransactionHistoryItem {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
  op_type?: string;
  message?: string;
}

// New interface for transaction details
// octra_transaction returns flat fields (no parsed_tx wrapper)
export interface TransactionDetails {
  tx_hash: string;
  status: string;
  epoch: number | null;
  from: string;
  to: string;
  amount: string;
  amount_raw: string;
  nonce: number;
  ou: string;
  timestamp: number;
  op_type: string;
  message: string | null;
  // Legacy compat shim — always populated by fetchTransactionDetails
  parsed_tx: {
    from: string;
    to: string;
    to_?: string;
    amount: string;
    amount_raw: string;
    nonce: number;
    ou: string;
    timestamp: number;
    message: string | null;
    op_type?: string;
  };
  data?: string;
  source?: string;
}

// New interface for pending transactions from staging
export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  amount: string;
  nonce: number;
  ou: string;
  timestamp: number;
  stage_status: string;
  has_public_key: boolean;
  message: string | null;
  priority: string;
  op_type?: string;
  encrypted_data?: string;
}

export interface StagingResponse {
  count: number;
  transactions: PendingTransaction[]; // staging_view returns 'transactions' not 'staged_transactions'
  message?: string;
}

// Transaction send response with finality
export interface TransactionSendResponse {
  status: 'accepted' | 'rejected';
  hash?: string;
  finality: 'pending' | 'confirmed' | 'rejected';
  reason?: string; // Rejection reason if finality is 'rejected'
  error?: string; // For backward compatibility
}

// Transaction error types
export type TransactionErrorType =
  | 'malformed_transaction'
  | 'invalid_address'
  | 'self_transfer'
  | 'sender_not_found'
  | 'invalid_signature'
  | 'duplicate_transaction'
  | 'nonce_too_far'
  | 'insufficient_balance'
  | 'internal_error'
  | 'unknown_error';

// New interfaces for private transfers
export interface PendingPrivateTransfer {
  id: string;
  sender: string;
  recipient: string;
  encrypted_data: string;
  ephemeral_key: string;
  epoch_id: number;
  created_at: string;
}

export interface PrivateTransferResult {
  success: boolean;
  tx_hash?: string;
  ephemeral_key?: string;
  error?: string;
}

export interface ClaimResult {
  success: boolean;
  amount?: string;
  error?: string;
}

// Password protection types
export interface WalletPassword {
  hashedPassword: string;
  salt: string;
}

// RPC Provider types
export interface RPCProvider {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  priority: number;
  isActive: boolean;
  createdAt: number;
  network?: 'mainnet' | 'devnet'; // Network this provider connects to
}