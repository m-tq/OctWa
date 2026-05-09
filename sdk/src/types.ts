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
  /** Octra address (same as walletPubKey for Octra) */
  address: string;
  evmAddress: string;
  /** Active EVM network ID from wallet settings, e.g. 'eth-mainnet', 'base-mainnet' */
  evmNetworkId: string;
  network: 'mainnet' | 'devnet';
  epoch: number;
  branchId: string;
  /** Curve25519 view public key (base64) — safe to share, no signing power */
  viewPublicKey?: string;
  /** Whether PVAC/FHE public key is registered on the active node */
  pvacRegistered?: boolean;
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

// ============================================================================
// Phase 9 — Reads: transactions, epoch, fees, contract view, stealth lookups
// ============================================================================

/** Transaction status, as returned by `octra_transaction`. */
export type TransactionStatus = 'pending' | 'confirmed' | 'rejected' | 'dropped';

/** Snapshot of an Octra transaction. */
export interface TransactionInfo {
  /** 64-char hex transaction hash */
  hash: string;
  from: string;
  to: string;
  /** Raw units (ou) as a decimal string */
  amountRaw: string;
  /** Octra op_type (standard/encrypt/decrypt/stealth/claim/call/deploy/key_switch) */
  opType: string;
  nonce: number;
  ou: string;
  timestamp: number;
  status: TransactionStatus;
  /** Epoch id — present only once confirmed */
  epoch?: number;
  blockHeight?: number;
  rejectReason?: string;
  rejectType?: string;
  /** Only populated when the tx carries a message */
  message?: string;
  /** Only populated when the tx carries encrypted_data (call method name, stealth payload, etc.) */
  encryptedData?: string;
  signature?: string;
  publicKey?: string;
}

/** Options for `waitForConfirmation`. */
export interface WaitForConfirmationOptions {
  /** Total wait budget (default 120 000 ms — ≥ 12 epochs). */
  timeoutMs?: number;
  /** Poll interval (default 3 000 ms). */
  pollIntervalMs?: number;
  /** Called on every poll tick with the most recent status. */
  onTick?: (info: TransactionInfo | null) => void;
}

/** Shape returned by `octra_recommendedFee`. */
export interface RecommendedFee {
  /** Minimum fee in OU as a string */
  minimum: string;
  /** Base fee in OU as a string */
  base: string;
  /** Recommended fee in OU as a string — this is the value users should default to */
  recommended: string;
  /** Fast fee in OU as a string */
  fast: string;
}

/** Current epoch info. */
export interface EpochInfo {
  /** Current epoch id */
  epochId: number;
  /** Optional — only for `epoch_get` responses */
  validator?: string;
  timestamp?: number;
  rootCount?: number;
}

/** Result of a read-only contract view call. */
export interface ContractViewResult {
  /** The raw `result` as returned by `contract_call` */
  result: unknown;
}

/** Input for a view-only contract call. */
export interface ContractViewPayload {
  contract: string;
  method: string;
  params?: unknown[];
}

// ============================================================================
// PVAC / HFHE Crypto Identity  (Phase 7)
// ============================================================================

/**
 * Wallet crypto identity exposed to dApps.
 * Contains only public/derived data — private keys never leave the wallet.
 */
export interface CryptoIdentity {
  /** Ed25519 public key (hex, 32 bytes) — same as walletPubKey */
  ed25519PublicKey: string;
  /** Curve25519 view public key (base64, 32 bytes) — safe to share, no signing power */
  viewPublicKey: string;
  /** Whether PVAC/FHE public key is registered on the active node */
  pvacRegistered: boolean;
  /** Current HFHE cipher from node — "hfhe_v1|..." or "0" */
  currentCipher: string;
}

/** Result of a client-side HFHE cipher decryption (no tx, no fee) */
export interface CipherDecryptResult {
  /** Decrypted value in raw units (1 OCT = 1_000_000) */
  valueRaw: bigint;
  /** Human-readable value in OCT */
  valueOct: number;
}

/** Result of a client-side HFHE value encryption (no tx, no fee) */
export interface CipherEncryptResult {
  /** HFHE cipher string — "hfhe_v1|..." — ready for use in contract calls */
  cipher: string;
}

/** A raw stealth output as returned by the node RPC */
export interface RawStealthOutput {
  /** Unique output ID */
  id: string | number;
  /** Ephemeral public key (base64, Curve25519) */
  eph_pub: string;
  /** Stealth tag for output matching (hex, 16 bytes) */
  stealth_tag: string;
  /** AES-256-GCM encrypted amount+blinding (base64) */
  enc_amount: string;
  /** Whether this output has been claimed (0 = unclaimed) */
  claimed?: number;
  /** Epoch when the output was created */
  epoch_id?: number;
  /** Sender address */
  sender_addr?: string;
  /** Transaction hash of the stealth send */
  tx_hash?: string;
  [key: string]: unknown;
}

/** A stealth output that belongs to this wallet (after ECDH scan) */
export interface ScannedOutput {
  /** Unique output ID */
  id: string;
  /** Amount in raw units (1 OCT = 1_000_000) */
  amountRaw: bigint;
  /** Human-readable amount in OCT */
  amountOct: number;
  /** Epoch when the output was created */
  epochId: number;
  /** Sender address */
  senderAddress: string;
  /** Transaction hash of the stealth send */
  txHash: string;
  /** Claim secret (base64) — needed to claim this output */
  claimSecret: string;
  /** Blinding factor (base64) — needed for range proof */
  blinding: string;
  /** Full raw output for passing back to stealthClaim */
  rawOutput: RawStealthOutput;
}

/** Result of scanning stealth outputs */
export interface ScanOutputsResult {
  /** Outputs belonging to this wallet */
  outputs: ScannedOutput[];
  /** Total number of outputs scanned */
  totalScanned: number;
  /** Number of outputs that matched this wallet */
  matched: number;
}

/** Result of computing an ECDH shared secret */
export interface SharedSecretResult {
  /** Shared secret (base64, 32 bytes) */
  sharedSecret: string;
  /** Stealth tag derived from shared secret (hex, 16 bytes) */
  stealthTag: string;
  /** Claim secret derived from shared secret (base64, 32 bytes) */
  claimSecret: string;
}

/** Input for ZK proof signing */
export interface ZkSignInput {
  /** Raw data to sign as public input for ZK circuit */
  data: Uint8Array;
  /** Optional domain string for domain separation */
  domain?: string;
}

/** Result of signing data for ZK proof */
export interface ZkSignResult {
  /** Ed25519 signature (hex) */
  signature: string;
  /** Ed25519 public key (hex) */
  publicKey: string;
  /** SHA-256 hash of the data (hex) — use as public input */
  dataHash: string;
}

/** Progress event for long-running PVAC operations */
export interface PvacProgress {
  step: PvacOperationStep;
  label: string;
  percent: number;
}

export type PvacOperationStep =
  | 'initializing'
  | 'keygen'
  | 'encrypting'
  | 'decrypting'
  | 'scanning'
  | 'ecdh'
  | 'building_proof'
  | 'done';

export type PvacProgressCallback = (progress: PvacProgress) => void;

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

  // ── PVAC / HFHE Crypto (Phase 7) ──────────────────────────────────────────
  /** Get wallet's Curve25519 view public key (safe to share) */
  getCryptoIdentity(): Promise<CryptoIdentity>;
  /** Compute ECDH shared secret + derived stealth primitives */
  computeSharedSecret(theirViewPubkey: string): Promise<SharedSecretResult>;
  /** Decrypt an HFHE cipher client-side — no tx, no fee */
  decryptCipher(cipher: string): Promise<CipherDecryptResult>;
  /** Encrypt a value client-side — returns cipher for contract calls */
  encryptValue(valueRaw: bigint): Promise<CipherEncryptResult>;
  /** Scan stealth outputs and return ones belonging to this wallet */
  scanOutputs(outputs: RawStealthOutput[], onProgress?: PvacProgressCallback): Promise<ScanOutputsResult>;
  /** Sign data for use as ZK proof public input */
  signForZK(input: ZkSignInput): Promise<ZkSignResult>;

  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

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
  | 'encryptedBalanceChanged'
  | 'stealthOutputFound';

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
  E extends 'stealthOutputFound'        ? (data: ScannedOutput) => void :
  never;

// ============================================================================
// Global Window Extension
// ============================================================================

declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
