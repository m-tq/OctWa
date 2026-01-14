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
    op_type?: string;
  };
  epoch: number;
  tx_hash: string;
  data: string;
  source: string;
  op_type?: string;
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
  network?: 'mainnet' | 'testnet'; // Network this provider connects to
}

// DApp connection types (Legacy - kept for backward compatibility)
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

// =============================================================================
// Octra Capability-Based Model Types
// =============================================================================

/** Capability scope - defines the level of access */
export type CapabilityScope = 'read' | 'write' | 'compute';

/** Connection to a Circle (no authority granted) */
export interface CircleConnection {
  circle: string;
  appOrigin: string;
  appName: string;
  walletPubKey: string;
  network: 'testnet' | 'mainnet';
  connectedAt: number;
}

/** Capability - scoped, signed authorization */
export interface Capability {
  id: string;
  circle: string;
  methods: string[];
  scope: CapabilityScope;
  encrypted: boolean;
  issuedAt: number;
  expiresAt?: number;
  issuerPubKey: string;
  signature: string;
}

/** Request to connect to a Circle */
export interface CircleConnectRequest {
  circle: string;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
  requestedCapabilities?: {
    methods: string[];
    scope: CapabilityScope;
    encrypted: boolean;
  }[];
}

/** Request for a capability */
export interface CapabilityRequest {
  circle: string;
  methods: string[];
  scope: CapabilityScope;
  encrypted: boolean;
  ttlSeconds?: number;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
}

/** Request to invoke a method */
export interface InvokeRequest {
  capabilityId: string;
  method: string;
  payload?: Uint8Array | EncryptedBlob;
  nonce: number;
  timestamp: number;
}

/** Encrypted data blob */
export interface EncryptedBlob {
  scheme: 'HFHE';
  data: Uint8Array;
  metadata?: Uint8Array;
}

/** Result from an invocation */
export interface InvocationResult {
  success: boolean;
  data?: Uint8Array | EncryptedBlob;
  error?: string;
}