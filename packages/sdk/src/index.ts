/**
 * Octra Web Wallet SDK
 * @octwa/sdk
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
  isUserRejectionError,
  wrapProviderError,
} from './errors';

export {
  canonicalize,
  canonicalizeCapability,
  canonicalizeInvocation,
  hashCapabilityWithDomain,
  hashInvocationWithDomain,
  hashPayload,
  applyDomainSeparation,
  sha256Bytes,
  sha256String,
  bytesToHex,
  OCTRA_DOMAIN_PREFIX,
  OCTRA_CAPABILITY_PREFIX,
  OCTRA_INVOCATION_PREFIX,
} from './canonical';

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
  sha256,
  domainSeparator,
  verifyDomainSeparation,
  deriveSessionKey,
} from './crypto';

export {
  decodeResponseData,
  decodeBalanceResponse,
} from './response-utils';

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
  GasEstimate,
  SessionState,
  BalanceResponse,
  InitOptions,
  EventName,
  EventCallback,
  ErrorCode,
  OctraProvider,
} from './types';
