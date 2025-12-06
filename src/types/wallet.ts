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
}

// New interface for transaction details
export interface TransactionDetails {
  parsed_tx: {
    from: string;
    to: string;
    amount: string;
    amount_raw: string;
    nonce: number;
    ou: string;
    timestamp: number;
    message: string | null;
  };
  epoch: number;
  tx_hash: string;
  data: string;
  source: string;
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
}

export interface StagingResponse {
  count: number;
  staged_transactions: PendingTransaction[];
  message: string;
}

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
}

// DApp connection types
export interface DAppConnectionRequest {
  origin: string;
  permissions: string[];
  appName?: string;
  appIcon?: string;
}

// Legacy transaction request interface - now handled by contract interactions
// Kept for backward compatibility
export interface DAppTransactionRequest {
  origin: string;
  to: string;
  amount: string;
  appName?: string;
  appIcon?: string;
  message?: string;
}

export interface ConnectedDApp {
  origin: string;
  appName: string;
  connectedAt: number;
  permissions: string[];
  selectedAddress: string;
}