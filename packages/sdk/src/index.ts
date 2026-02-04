/**
 * Octra Web Wallet SDK
 * 
 * Capability-based authorization for Octra dApps.
 * Does NOT follow EVM/MetaMask patterns.
 * 
 * Features:
 * - ed25519 cryptographic signing
 * - Deterministic canonicalization
 * - Origin binding
 * - Replay protection via nonce
 * - Expiry enforcement
 */

// Main SDK class
export { OctraSDK } from './sdk';

// Error classes
export {
  OctraError,
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  TimeoutError,
  ValidationError,
  CapabilityError,
  ScopeViolationError,
  SignatureInvalidError,
  CapabilityExpiredError,
  OriginMismatchError,
} from './errors';

// Crypto utilities (for advanced use cases)
export {
  canonicalizeCapabilityPayload,
  hashCapabilityPayload,
  verifyCapabilitySignature,
  verifyEd25519Signature,
  isCapabilityExpired,
  isOriginValid,
  validateCapability,
  generateNonce,
  hexToBytes,
  bytesToHex,
  sha256,
} from './crypto';

// Types - Connect Flow
export type {
  ConnectRequest,
  Connection,
} from './types';

// Types - Capability System
export type {
  CapabilityScope,
  CapabilityTemplate,
  CapabilityRequest,
  CapabilityPayload,
  Capability,
} from './types';

// Types - Invocation
export type {
  InvocationRequest,
  InvocationResult,
  SignedInvocation,
} from './types';

// Types - Encryption
export type {
  EncryptedBlob,
} from './types';

// Types - Session
export type {
  SessionState,
} from './types';

// Types - Balance
export type {
  EVMNetworkId,
  BalanceResponse,
} from './types';

// Types - Configuration
export type {
  InitOptions,
} from './types';

// Types - Events
export type {
  EventName,
  EventCallback,
} from './types';

// Types - Errors
export type {
  ErrorCode,
} from './types';

// Intents SDK
export {
  IntentsClient,
  deriveEvmAddress,
} from './intents';

// Response utilities
export {
  decodeResponseData,
  decodeBalanceResponse,
} from './response-utils';

export type {
  SwapIntentPayload,
  Quote,
  SwapResult,
  IntentStatus,
  TargetChain,
} from './intents';
