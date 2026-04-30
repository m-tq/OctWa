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
  evmAddress: string;          // always present — derived from same key
  network: 'testnet' | 'mainnet';
  epoch: number;               // current epoch at connect time
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
  network: 'mainnet' | 'testnet';
}

// ============================================================================
// Session
// ============================================================================

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
  | 'extensionReady';

export type EventCallback<E extends EventName> =
  E extends 'connect'             ? (data: { connection: Connection }) => void :
  E extends 'disconnect'          ? () => void :
  E extends 'capabilityGranted'   ? (data: { capability: Capability }) => void :
  E extends 'capabilityExpired'   ? (data: { capabilityId: string }) => void :
  E extends 'capabilityRevoked'   ? (data: { capabilityId: string }) => void :
  E extends 'branchChanged'       ? (data: { branchId: string; epoch: number }) => void :
  E extends 'epochChanged'        ? (data: { epoch: number }) => void :
  E extends 'extensionReady'      ? () => void :
  never;

// ============================================================================
// Global Window Extension
// ============================================================================

declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
