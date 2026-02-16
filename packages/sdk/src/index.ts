/**
 * Octra Web Wallet SDK
 */

export { OctraSDK } from './sdk';
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
  CapabilityRevokedError,
  OriginMismatchError,
  BranchMismatchError,
  EpochMismatchError,
  NonceViolationError,
  DomainSeparationError,
} from './errors';

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
  domainSeparator,
  verifyDomainSeparation,
  deriveSessionKey,
} from './crypto';

export {
  canonicalize,
  canonicalizeCapability,
  canonicalizeInvocation,
  hashCapabilityWithDomain,
  hashInvocationWithDomain,
  hashPayload,
  applyDomainSeparation,
  OCTRA_DOMAIN_PREFIX,
  OCTRA_CAPABILITY_PREFIX,
  OCTRA_INVOCATION_PREFIX,
} from './canonical';

export type {
  ConnectRequest,
  Connection,
  CapabilityScope,
  CapabilityState,
  CapabilityTemplate,
  CapabilityRequest,
  CapabilityPayload,
  Capability,
  InvocationRequest,
  InvocationResult,
  SignedInvocation,
  InvocationHeader,
  InvocationBody,
  EncryptedPayload,
  EncryptedBlob,
  ComputeRequest,
  ComputeProfile,
  ComputeResult,
  BranchInfo,
  BranchProof,
  GasEstimate,
  SessionState,
  EVMNetworkId,
  BalanceResponse,
  InitOptions,
  EventName,
  EventCallback,
  ErrorCode,
} from './types';

export {
  decodeResponseData,
  decodeBalanceResponse,
} from './response-utils';

// NOTE: Intent-based swaps feature is currently disabled
// Uncomment when ready for production
/*
export {
  IntentsClient,
  deriveEvmAddress,
} from './intents';

export type {
  SwapIntentPayload,
  Quote,
  SwapResult,
  IntentStatus,
  TargetChain,
} from './intents';
*/
