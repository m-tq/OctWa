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
  // Connect
  ConnectRequest,
  Connection,
  // Capabilities
  CapabilityScope,
  CapabilityState,
  CapabilityTemplate,
  CapabilityRequest,
  CapabilityPayload,
  Capability,
  // Invocations
  InvocationRequest,
  InvocationResult,
  SignedInvocation,
  InvocationHeader,
  InvocationBody,
  // Encryption (HFHE payload)
  EncryptedPayload,
  EncryptedBlob,
  // Gas
  GasEstimate,
  // Session
  SessionState,
  // Balance
  BalanceResponse,
  // Sign Message (Phase 1)
  SignMessageResult,
  // EVM Operations (Phase 3)
  EvmTransactionPayload,
  EvmTransactionResult,
  Erc20TransactionPayload,
  // Encrypted Balance (Phase 4)
  EncryptedBalanceInfo,
  EncryptBalanceResult,
  DecryptBalanceResult,
  // Stealth Transfers (Phase 5)
  ClaimableOutput,
  StealthSendPayload,
  StealthSendResult,
  StealthClaimResult,
  // Contract Interactions (Phase 6)
  ContractCallPayload,
  ContractCallResult,
  // EVM Token Balances (Phase 8)
  Erc20TokenBalance,
  GetEvmTokensResult,
  // Config
  InitOptions,
  // Events
  EventName,
  EventCallback,
  // Errors
  ErrorCode,
  // Provider
  OctraProvider,
} from './types';
