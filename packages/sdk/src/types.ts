/**
 * SDK initialization options
 */
export interface InitOptions {
  /** Provider detection timeout in milliseconds (default: 3000) */
  timeout?: number;
}

/**
 * Permission types that can be requested during connection
 */
export type Permission = 'view_address' | 'view_balance' | 'sign_transaction' | 'sign_message';

/**
 * Result returned from successful wallet connection
 */
export interface ConnectResult {
  /** Connected wallet address */
  address: string;
  /** Granted permissions */
  permissions: Permission[];
}

/**
 * Transaction request parameters
 */
export interface TransactionRequest {
  /** Recipient address */
  to: string;
  /** Amount to send (as string or number) */
  amount: string | number;
  /** Optional transaction message/memo */
  message?: string;
}

/**
 * Result returned from successful transaction
 */
export interface TransactionResult {
  /** Transaction hash */
  hash: string;
}

/**
 * Contract method parameters
 */
export interface ContractParams {
  [key: string]: string | number | boolean;
}

/**
 * Options for contract invocation
 */
export interface InvokeOptions {
  /** Gas limit for the transaction */
  gasLimit?: number;
  /** Gas price */
  gasPrice?: string;
  /** Value to send with the transaction */
  value?: string;
}

/**
 * Result returned from contract invocation
 */
export interface ContractResult {
  /** Transaction hash */
  hash: string;
  /** Result data from contract call */
  result?: unknown;
}

/**
 * Balance query result
 */
export interface BalanceResult {
  /** Account balance */
  balance: number;
  /** Address queried */
  address: string;
}

/**
 * Network information
 */
export interface NetworkInfo {
  /** Chain ID in hex format */
  chainId: string;
  /** Network identifier */
  networkId: string;
  /** Human-readable network name */
  name: string;
}

/**
 * Message signing result
 */
export interface SignatureResult {
  /** Cryptographic signature */
  signature: string;
  /** Original message that was signed */
  message: string;
}

/**
 * Supported event names
 */
export type EventName = 'connect' | 'disconnect' | 'accountChanged' | 'transaction' | 'extensionReady';

/**
 * Event callback type mapping
 */
export type EventCallback<E extends EventName> = 
  E extends 'connect' ? (data: { address: string }) => void :
  E extends 'disconnect' ? () => void :
  E extends 'accountChanged' ? (data: { address: string }) => void :
  E extends 'transaction' ? (data: { hash: string }) => void :
  E extends 'extensionReady' ? () => void :
  never;

/**
 * Internal provider interface (matches window.octra)
 */
export interface OctraProvider {
  isOctra: boolean;
  isConnected: boolean;
  selectedAddress: string | null;
  networkId: string;
  chainId: string;
  version: string;
  
  connect(permissions?: string[]): Promise<{ address: string; permissions: string[] }>;
  disconnect(): Promise<void>;
  getAccount(): Promise<string>;
  getBalance(address?: string): Promise<{ balance: number; address: string }>;
  getNetwork(): Promise<{ chainId: string; networkId: string; name: string }>;
  sendTransaction(tx: { to: string; amount: string; message?: string }): Promise<{ hash: string }>;
  signMessage(message: string): Promise<{ signature: string }>;
  callContract(address: string, method: string, params?: object): Promise<unknown>;
  invokeContract(address: string, method: string, params?: object, options?: object): Promise<{ hash: string; result?: unknown }>;
  
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

/**
 * Error codes used by the SDK
 */
export type ErrorCode = 
  | 'NOT_INSTALLED'
  | 'NOT_CONNECTED'
  | 'USER_REJECTED'
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'CONTRACT_ERROR';

/**
 * Global window extension for TypeScript
 */
declare global {
  interface Window {
    octra?: OctraProvider;
  }
}
