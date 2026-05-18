/**
 * @octwa/sdk — RFC-O-1 Compliant Octra Wallet SDK
 *
 * Thin wrapper around window.octra.request() providing
 * typed, ergonomic access to all RFC-O-1 provider methods.
 */

export { OctraSDK } from './sdk';

export { EvmBridge } from './evm';

export {
  OctraProviderError,
  UserRejectedError,
  UnauthorizedError,
  UnsupportedMethodError,
  DisconnectedError,
  NetworkUnavailableError,
  NotInstalledError,
  TimeoutError,
  isUserRejection,
  wrapProviderError,
} from './errors';

export { detectProvider, getProvider, isProviderInstalled } from './utils';

export type {
  // Provider
  OctraProvider,
  OctraRequestArguments,
  // Network
  OctraNetworkInfo,
  // Permissions
  OctraPermission,
  // Transactions
  SendTransactionParams,
  SignTransactionParams,
  SignedOctraTransaction,
  OctraTransactionResult,
  // Contracts
  CallContractParams,
  SendContractTransactionParams,
  // Privacy
  EncryptedBalanceInfo,
  PrivateTransferParams,
  // Sign Message
  SignMessageParams,
  SignMessageResult,
  // Events
  OctraProviderEvent,
  ConnectEventPayload,
  BalanceChangedPayload,
  TransactionChangedPayload,
  ProviderMessage,
  // Errors
  OctraErrorCode,
  OctraErrorReason,
  // Config
  OctraSDKOptions,
  ConnectOptions,
  WatchTransactionOptions,
} from './types';

export type {
  EvmNetworkInfo,
  EvmBalanceResult,
  EvmTokenBalanceResult,
  EvmTokenInfo,
  EvmSendTransactionParams,
  EvmTransactionResult,
  EvmTransferTokenParams,
  EvmApproveTokenParams,
  EvmAllowanceParams,
  EvmAllowanceResult,
  EvmSignMessageResult,
  EvmSignTypedDataParams,
  EvmCallParams,
  EvmEstimateGasParams,
  EvmGasEstimate,
  EvmGasPrice,
} from './evm-types';
