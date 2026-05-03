/**
 * Octra Web Wallet SDK — Type Definitions
 */

// ============================================================================
// Connect Flow
// ============================================================================

export interface ConnectRequest {
  circle: string;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
  requestedCapabilities?: CapabilityTemplate[];
}

export interface Connection {
  circle: string;
  sessionId: string;
  walletPubKey: string;
  evmAddress: string;
  /** Active EVM network ID from wallet settings, e.g. 'eth-mainnet', 'base-mainnet' */
  evmNetworkId: string;
  network: 'mainnet' | 'devnet';
  epoch: number;
  branchId: string;
}

// ============================================================================
// Capability
// ============================================================================

export type CapabilityScope = 'read' | 'write' | 'compute';

export type CapabilityState =
  | 'REQUESTED'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED';

export interface CapabilityTemplate {
  methods: string[];
  scope: CapabilityScope;
  encrypted: boolean;
}

export interface CapabilityRequest {
  circle: string;
  methods: string[];
  scope: CapabilityScope;
  encrypted: boolean;
  ttlSeconds?: number;
  branchId?: string;
}

export interface CapabilityPayload {
  readonly version: 2;
  readonly circle: string;
  readonly methods: readonly string[];
  readonly scope: CapabilityScope;
  readonly encrypted: boolean;
  readonly appOrigin: string;
  readonly branchId: string;
  readonly epoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonceBase: number;
}

export interface Capability extends CapabilityPayload {
  readonly id: string;
  readonly walletPubKey: string;
  readonly signature: string;
  state: CapabilityState;
  lastNonce: number;
}

// ============================================================================
// Invocation
// ============================================================================

export interface InvocationRequest {
  capabilityId: string;
  method: string;
  payload?: Uint8Array | EncryptedPayload;
  branchId?: string;
}

export interface SignedInvocation {
  header: InvocationHeader;
  body: InvocationBody;
  payload?: Uint8Array | { _type: 'Uint8Array'; data: number[] };
  signature?: string;
}

export interface InvocationHeader {
  version: 2;
  circleId: string;
  branchId: string;
  epoch: number;
  nonce: number;
  timestamp: number;
  originHash: string;
}

export interface InvocationBody {
  capabilityId: string;
  method: string;
  payloadHash: string;
}

export interface InvocationResult {
  success: boolean;
  data?: Uint8Array | EncryptedPayload;
  error?: string;
  branchProofHash?: string;
  merkleRoot?: string;
  epochTag?: number;
}

// ============================================================================
// Encryption
// ============================================================================

export interface EncryptedPayload {
  scheme: 'HFHE';
  data: Uint8Array;
  metadata?: Uint8Array;
  associatedData: string;
}

export interface EncryptedBlob extends EncryptedPayload {}

// ============================================================================
// Gas
// ============================================================================

export interface GasEstimate {
  gasUnits: number;
  tokenCost: number;
  latencyEstimate: number;
  epoch: number;
}

// ============================================================================
// Balance
// ============================================================================

export interface BalanceResponse {
  octAddress: string;
  octBalance: number;
  /** Decrypted encrypted balance in OCT (0 if not decrypted or no PVAC) */
  encryptedBalance: number;
  /** Raw HFHE cipher string from node — "hfhe_v1|..." or "0" */
  cipher: string;
  /** Whether a PVAC/FHE public key is registered for this address */
  hasPvacPubkey: boolean;
  network: 'mainnet' | 'devnet';
}

// ============================================================================
// Sign Message
// ============================================================================

export interface SignMessageResult {
  /** Ed25519 signature of the message, hex-encoded */
  signature: string;
  /** The original message that was signed */
  message: string;
  /** Octra address (public key) that signed */
  address: string;
}

// ============================================================================
// EVM Operations
// ============================================================================

export interface EvmTransactionPayload {
  /** EVM recipient address (0x...) */
  to: string;
  /** Amount in ETH as decimal string, e.g. "0.01" */
  amount?: string;
  /** Optional calldata hex string */
  data?: string;
  /** Network ID, e.g. 'eth-mainnet', 'base-mainnet' */
  network?: string;
}

export interface Erc20TransactionPayload {
  /** ERC-20 contract address */
  tokenContract: string;
  /** Recipient EVM address */
  to: string;
  /** Amount in smallest token units as string */
  amount: string;
  /** Token decimals */
  decimals: number;
  /** Token symbol for display, e.g. "USDC" */
  symbol: string;
  /** Network ID */
  network?: string;
}

export interface EvmTransactionResult {
  /** EVM transaction hash */
  txHash: string;
  /** Network the tx was sent on */
  network: string;
}

// ============================================================================
// Encrypted Balance
// ============================================================================

export interface EncryptedBalanceInfo {
  /** Decrypted encrypted balance in OCT (0 if PVAC not available) */
  encryptedBalance: number;
  /** Raw HFHE cipher string — "hfhe_v1|..." or "0" */
  cipher: string;
  /** Whether a PVAC/FHE public key is registered */
  hasPvacPubkey: boolean;
}

export interface EncryptBalanceResult {
  /** Transaction hash of the encrypt operation */
  txHash: string;
  /** Amount encrypted in OCT */
  amount: number;
}

export interface DecryptBalanceResult {
  /** Transaction hash of the decrypt operation */
  txHash: string;
  /** Amount decrypted in OCT */
  amount: number;
}

// ============================================================================
// Stealth Transfers
// ============================================================================

export interface ClaimableOutput {
  /** Unique stealth output ID */
  id: string;
  /** Amount in OCT */
  amount: number;
  /** Sender Octra address */
  sender: string;
  /** Epoch when the output was created */
  epoch: number;
  /** Transaction hash of the stealth send */
  txHash: string;
}

export interface StealthSendPayload {
  /** Recipient Octra address */
  to: string;
  /** Amount in OCT to send from encrypted balance */
  amount: number;
}

export interface StealthSendResult {
  /** Transaction hash of the stealth send */
  txHash: string;
  /** Amount sent in OCT */
  amount: number;
}

export interface StealthClaimResult {
  /** Transaction hash of the claim */
  txHash: string;
  /** Amount claimed in OCT (added to encrypted balance) */
  amount: number;
  /** Output ID that was claimed */
  outputId: string;
}

// ============================================================================
// EVM Token Balances
// ============================================================================

export interface Erc20TokenBalance {
  /** Contract address */
  address: string;
  /** Token name */
  name: string;
  /** Token symbol, e.g. "wOCT", "USDC" */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** Human-readable balance string, e.g. "1.500000" */
  balance: string;
  /** EVM chain ID */
  chainId: number;
  /** Optional logo data URI or URL */
  logo?: string;
}

export interface GetEvmTokensResult {
  /** All token balances (common + custom) for the active EVM network */
  tokens: Erc20TokenBalance[];
  /** Active EVM network ID */
  networkId: string;
  /** EVM chain ID */
  chainId: number;
}

export interface ContractCallPayload {
  /** Contract address */
  contract: string;
  /** Method name to call */
  method: string;
  /** Method parameters as JSON-serializable array */
  params?: unknown[];
  /** OCT to attach to the call (default 0) */
  amount?: number;
  /** Custom fee in OU */
  ou?: number;
}

export interface ContractCallResult {
  /** Transaction hash */
  txHash: string;
  /** Contract address called */
  contract: string;
  /** Method called */
  method: string;
}

export interface SessionState {
  connected: boolean;
  circle?: string;
  branchId?: string;
  epoch?: number;
  activeCapabilities: Capability[];
}

// ============================================================================
// SDK Configuration
// ============================================================================

export interface InitOptions {
  timeout?: number;
  autoCleanupExpired?: boolean;
  skipSignatureVerification?: boolean;
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface OctraProvider {
  isOctra: true;
  version: string;

  connect(request: ConnectRequest): Promise<Connection>;
  disconnect(): Promise<{ disconnected: boolean }>;

  requestCapability(req: CapabilityRequest): Promise<Capability>;
  renewCapability(capabilityId: string): Promise<Capability>;
  revokeCapability(capabilityId: string): Promise<void>;
  listCapabilities(): Promise<Capability[]>;

  invoke(call: SignedInvocation): Promise<InvocationResult>;

  estimatePlainTx(payload: unknown): Promise<GasEstimate>;
  estimateEncryptedTx(payload: EncryptedPayload): Promise<GasEstimate>;

  signMessage(message: string): Promise<string>;

  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

// ============================================================================
// Error Codes
// ============================================================================

export type ErrorCode =
  | 'NOT_INSTALLED'
  | 'NOT_CONNECTED'
  | 'USER_REJECTED'
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'CAPABILITY_ERROR'
  | 'SCOPE_VIOLATION'
  | 'SIGNATURE_INVALID'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'ORIGIN_MISMATCH'
  | 'BRANCH_MISMATCH'
  | 'EPOCH_MISMATCH'
  | 'NONCE_VIOLATION'
  | 'DOMAIN_SEPARATION_ERROR';

// ============================================================================
// Events
// ============================================================================

export type EventName =
  | 'connect'
  | 'disconnect'
  | 'capabilityGranted'
  | 'capabilityExpired'
  | 'capabilityRevoked'
  | 'branchChanged'
  | 'epochChanged'
  | 'extensionReady'
  | 'balanceChanged'
  | 'encryptedBalanceChanged';

export type EventCallback<E extends EventName> =
  E extends 'connect'                   ? (data: { connection: Connection }) => void :
  E extends 'disconnect'                ? () => void :
  E extends 'capabilityGranted'         ? (data: { capability: Capability }) => void :
  E extends 'capabilityExpired'         ? (data: { capabilityId: string }) => void :
  E extends 'capabilityRevoked'         ? (data: { capabilityId: string }) => void :
  E extends 'branchChanged'             ? (data: { branchId: string; epoch: number }) => void :
  E extends 'epochChanged'              ? (data: { epoch: number }) => void :
  E extends 'extensionReady'            ? () => void :
  E extends 'balanceChanged'            ? (data: { octBalance: number }) => void :
  E extends 'encryptedBalanceChanged'   ? (data: EncryptedBalanceInfo) => void :
  never;

// ============================================================================
// Global Window Extension
// ============================================================================

declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
