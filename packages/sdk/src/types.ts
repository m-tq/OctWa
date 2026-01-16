/**
 * Octra Web Wallet SDK Types
 * 
 * This SDK implements Octra's capability-based authorization model.
 * It does NOT follow EVM/MetaMask patterns.
 */

// ============================================================================
// Connect Flow Types
// ============================================================================

/**
 * Request to connect to a Circle
 */
export interface ConnectRequest {
  /** Target Circle ID */
  circle: string;
  /** Application origin (window.origin) */
  appOrigin: string;
  /** Optional capability templates to request during connection */
  requestedCapabilities?: CapabilityTemplate[];
}

/**
 * Connection result - no authority granted yet
 */
export interface Connection {
  /** Connected Circle ID */
  circle: string;
  /** Unique session identifier */
  sessionId: string;
  /** Wallet's public key (Octra address) */
  walletPubKey: string;
  /** Derived EVM address (from same key) */
  evmAddress?: string;
  /** Network type */
  network: 'testnet' | 'mainnet';
}

// ============================================================================
// Capability Types
// ============================================================================

/**
 * Capability scope - defines the level of access
 */
export type CapabilityScope = 'read' | 'write' | 'compute';

/**
 * Template for requesting capabilities during connection
 */
export interface CapabilityTemplate {
  /** Methods to request access to */
  methods: string[];
  /** Access scope level */
  scope: CapabilityScope;
  /** Whether payloads should be encrypted */
  encrypted: boolean;
}

/**
 * Request for a new capability
 */
export interface CapabilityRequest {
  /** Target Circle ID */
  circle: string;
  /** Methods to request access to */
  methods: string[];
  /** Access scope level */
  scope: CapabilityScope;
  /** Whether payloads should be encrypted */
  encrypted: boolean;
  /** Time-to-live in seconds (optional) */
  ttlSeconds?: number;
}

/**
 * Capability payload for signing (without signature fields)
 * This is the cryptographic artifact that gets signed
 */
export interface CapabilityPayload {
  /** Version of capability format */
  readonly version: 1;
  /** Circle this capability is scoped to */
  readonly circle: string;
  /** Allowed methods (sorted lexicographically) */
  readonly methods: readonly string[];
  /** Access scope level */
  readonly scope: CapabilityScope;
  /** Whether payloads are encrypted */
  readonly encrypted: boolean;
  /** Application origin - cryptographically bound */
  readonly appOrigin: string;
  /** Timestamp when capability was issued (Unix ms) */
  readonly issuedAt: number;
  /** Timestamp when capability expires (Unix ms) */
  readonly expiresAt: number;
  /** Unique nonce for replay protection */
  readonly nonce: string;
}

/**
 * Signed capability - grants scoped authority
 * This is an immutable cryptographic artifact
 */
export interface Capability extends CapabilityPayload {
  /** Unique capability identifier */
  readonly id: string;
  /** Public key of the issuer (wallet) */
  readonly issuerPubKey: string;
  /** Cryptographic signature (ed25519) */
  readonly signature: string;
}

// ============================================================================
// Invocation Types
// ============================================================================

/**
 * Request to invoke a method within a Circle
 */
export interface InvocationRequest {
  /** Capability ID authorizing this invocation */
  capabilityId: string;
  /** Method to invoke */
  method: string;
  /** Optional payload (can be encrypted) */
  payload?: Uint8Array | EncryptedBlob;
}

/**
 * Signed invocation sent to wallet
 */
export interface SignedInvocation {
  /** Capability ID authorizing this invocation */
  capabilityId: string;
  /** Method to invoke */
  method: string;
  /** Optional payload */
  payload?: Uint8Array | EncryptedBlob;
  /** Monotonically increasing nonce per capability */
  nonce: number;
  /** Timestamp of invocation (Unix ms) */
  timestamp: number;
}

/**
 * Result from an invocation
 */
export interface InvocationResult {
  /** Whether the invocation succeeded */
  success: boolean;
  /** Result data (can be encrypted) */
  data?: Uint8Array | EncryptedBlob;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Encrypted data blob using HFHE scheme
 */
export interface EncryptedBlob {
  /** Encryption scheme identifier */
  scheme: 'HFHE';
  /** Encrypted data */
  data: Uint8Array;
  /** Optional metadata */
  metadata?: Uint8Array;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Current session state
 */
export interface SessionState {
  /** Whether connected to a Circle */
  connected: boolean;
  /** Current Circle ID (if connected) */
  circle?: string;
  /** List of active (non-expired) capabilities */
  activeCapabilities: Capability[];
}

// ============================================================================
// SDK Configuration
// ============================================================================

/**
 * SDK initialization options
 */
export interface InitOptions {
  /** Provider detection timeout in milliseconds (default: 3000) */
  timeout?: number;
  /** 
   * Skip cryptographic signature verification on capabilities.
   * WARNING: Only use for testing! Never enable in production.
   * @default false
   */
  skipSignatureVerification?: boolean;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Wallet provider interface (window.octra)
 */
export interface OctraProvider {
  /** Identifies this as an Octra provider */
  isOctra: boolean;
  /** Provider version */
  version: string;

  // Connection
  connect(request: ConnectRequest): Promise<Connection>;
  disconnect(): Promise<void>;

  // Capabilities
  requestCapability(req: CapabilityRequest): Promise<Capability>;

  // Invocation
  invoke(call: SignedInvocation): Promise<InvocationResult>;

  // Events
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes used by the SDK
 */
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
  | 'ORIGIN_MISMATCH';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Supported event names
 */
export type EventName = 'connect' | 'disconnect' | 'capabilityGranted' | 'capabilityRevoked' | 'extensionReady';

/**
 * Event callback type mapping
 */
export type EventCallback<E extends EventName> =
  E extends 'connect' ? (data: { connection: Connection }) => void :
  E extends 'disconnect' ? () => void :
  E extends 'capabilityGranted' ? (data: { capability: Capability }) => void :
  E extends 'capabilityRevoked' ? (data: { capabilityId: string }) => void :
  E extends 'extensionReady' ? () => void :
  never;

// ============================================================================
// Global Window Extension
// ============================================================================

declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
