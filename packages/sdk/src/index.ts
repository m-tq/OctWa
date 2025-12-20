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
  ContractError,
} from './errors';

// Types
export type {
  InitOptions,
  Permission,
  ConnectResult,
  TransactionRequest,
  TransactionResult,
  ContractParams,
  InvokeOptions,
  ContractResult,
  BalanceResult,
  NetworkInfo,
  SignatureResult,
  EventName,
  EventCallback,
  ErrorCode,
} from './types';

// Utility functions (for advanced usage)
export { isProviderInstalled, detectProvider } from './utils';
