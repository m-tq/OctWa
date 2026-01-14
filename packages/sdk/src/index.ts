/**
 * Octra Web Wallet SDK
 * 
 * Capability-based authorization for Octra dApps.
 * Does NOT follow EVM/MetaMask patterns.
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
} from './errors';

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
