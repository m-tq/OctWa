/**
 * @octwa/sdk — Type Definitions (RFC-O-1 Compliant)
 *
 * Implements the Octra Provider JavaScript API as defined in RFC-O-1.
 */

// ============================================================================
// Provider Interface (RFC-O-1 Core)
// ============================================================================

export interface OctraRequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface OctraProvider {
  readonly isOctra: true;
  readonly providerId?: string;
  readonly version?: string;

  request(args: OctraRequestArguments): Promise<unknown>;
  on(event: OctraProviderEvent, listener: (...args: unknown[]) => void): OctraProvider;
  removeListener(event: OctraProviderEvent, listener: (...args: unknown[]) => void): OctraProvider;
}

// ============================================================================
// Network
// ============================================================================

export interface OctraNetworkInfo {
  id: string;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  supportsPrivacy: boolean;
  isTestnet: boolean;
}

// ============================================================================
// Permissions (RFC-O-1)
// ============================================================================

export type OctraPermission =
  | 'read_address'
  | 'read_balance'
  | 'read_public_key'
  | 'sign_messages'
  | 'send_transactions'
  | 'contract_calls'
  | 'view_encrypted_balance'
  | 'encrypt_balance'
  | 'decrypt_balance'
  | 'private_transfers'
  | 'stealth_scan'
  | 'stealth_claim';

// ============================================================================
// Transaction Types
// ============================================================================

export interface SendTransactionParams {
  to: string;
  amount: string;
  fee?: string;
  message?: string;
}

export interface SignTransactionParams {
  to: string;
  amount: string;
  fee: string;
  nonce?: string;
  message?: string;
}

export interface SignedOctraTransaction {
  from: string;
  to_: string;
  amount: string;
  nonce: number;
  ou: string;
  timestamp: number;
  op_type: string;
  signature: string;
  public_key: string;
  encrypted_data?: string;
  message?: string;
}

export interface OctraTransactionResult {
  hash: string;
  accepted: boolean;
  status: 'pending' | 'confirmed' | 'rejected' | 'dropped';
  nonce?: number;
  ouCost?: string;
  explorerUrl?: string;
}

// ============================================================================
// Contract Types
// ============================================================================

export interface CallContractParams {
  address: string;
  method: string;
  params?: unknown[];
  caller?: string;
}

export interface SendContractTransactionParams {
  address: string;
  method: string;
  params?: unknown[];
  amount?: string;
  fee?: string;
}

// ============================================================================
// Privacy Types
// ============================================================================

export interface EncryptedBalanceInfo {
  address: string;
  cipher?: string;
  cipherType?: string;
  decryptedAmount?: string;
  hasPvacPubkey: boolean;
}

export interface PrivateTransferParams {
  to: string;
  amount: string;
  fee?: string;
}

// ============================================================================
// Sign Message
// ============================================================================

export interface SignMessageParams {
  message: string;
  address?: string;
}

export interface SignMessageResult {
  address: string;
  publicKey: string;
  signature: string;
}

// ============================================================================
// Events (RFC-O-1)
// ============================================================================

export type OctraProviderEvent =
  | 'connect'
  | 'disconnect'
  | 'networkChanged'
  | 'accountsChanged'
  | 'permissionsChanged'
  | 'balanceChanged'
  | 'transactionChanged'
  | 'message';

export interface ConnectEventPayload {
  networkId: string;
  networkInfo: OctraNetworkInfo;
}

export interface BalanceChangedPayload {
  address: string;
  public?: string;
  encrypted?: string;
}

export interface TransactionChangedPayload {
  hash: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'dropped';
  receipt?: unknown;
}

export interface ProviderMessage {
  type: string;
  data: unknown;
}

// ============================================================================
// Errors (RFC-O-1)
// ============================================================================

export interface OctraProviderError extends Error {
  code: number;
  data?: unknown;
}

/** Standard RFC-O-1 error codes */
export enum OctraErrorCode {
  UserRejected = 4001,
  Unauthorized = 4100,
  UnsupportedMethod = 4200,
  Disconnected = 4900,
  NetworkUnavailable = 4901,
}

/** Octra-specific error reasons (in error.data.reason) */
export type OctraErrorReason =
  | 'wallet_locked'
  | 'invalid_address'
  | 'invalid_amount'
  | 'invalid_nonce'
  | 'insufficient_balance'
  | 'fee_too_low'
  | 'staging_full'
  | 'duplicate_transaction'
  | 'invalid_signature'
  | 'proof_generation_failed'
  | 'privacy_not_supported'
  | 'recipient_view_pubkey_missing';

// ============================================================================
// SDK Configuration
// ============================================================================

export interface OctraSDKOptions {
  /** Timeout in ms to wait for provider detection (default: 3000) */
  timeout?: number;
  /** Default permissions to request on connect */
  defaultPermissions?: OctraPermission[];
}

export interface ConnectOptions {
  /** Permissions to request */
  permissions?: OctraPermission[];
  /** Target network ID */
  networkId?: string;
}

// ============================================================================
// Transaction Watching
// ============================================================================

export interface WatchTransactionOptions {
  /** Total wait budget in ms (default: 120_000) */
  timeoutMs?: number;
  /** Poll interval in ms (default: 3_000) */
  pollIntervalMs?: number;
  /** Called on every poll tick */
  onTick?: (status: OctraTransactionResult | null) => void;
}

// ============================================================================
// Global Window Extension
// ============================================================================

declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
