/**
 * @octwa/sdk — EVM Types
 *
 * Type definitions for the EVM bridge surface. All amounts in ETH/token
 * smallest units unless otherwise noted.
 */

// =============================================================================
// Network
// =============================================================================

export interface EvmNetworkInfo {
  id: string;
  name: string;
  chainId: number;
  symbol: string;
  explorerUrl?: string;
  rpcUrl?: string;
}

// =============================================================================
// Balance
// =============================================================================

export interface EvmBalanceResult {
  address: string;
  balance: string;
  balanceWei: string;
  chainId: number;
}

export interface EvmTokenBalanceResult {
  token: string;
  owner: string;
  balance: string;
}

export interface EvmTokenInfo {
  token: string;
  name: string;
  symbol: string;
  decimals: number;
}

// =============================================================================
// Transactions
// =============================================================================

export interface EvmSendTransactionParams {
  to: string;
  /** Amount in ETH (decimal string, e.g. '0.1'). Omit or '0' for contract calls. */
  value?: string;
  /** Hex-encoded calldata. */
  data?: string;
  /** Gas limit override (decimal string). */
  gasLimit?: string;
}

export interface EvmTransactionResult {
  hash: string;
  chainId: number;
}

// =============================================================================
// Token operations
// =============================================================================

export interface EvmTransferTokenParams {
  token: string;
  to: string;
  /** Amount in the token's smallest unit (e.g. for USDC with 6 decimals: '1000000' = 1 USDC). */
  amount: string;
}

export interface EvmApproveTokenParams {
  token: string;
  spender: string;
  /** Amount in smallest unit. Omit for unlimited (max uint256). */
  amount?: string;
}

export interface EvmAllowanceParams {
  token: string;
  owner: string;
  spender: string;
}

export interface EvmAllowanceResult {
  allowance: string;
}

// =============================================================================
// Signing
// =============================================================================

export interface EvmSignMessageResult {
  signature: string;
  address: string;
}

export interface EvmSignTypedDataParams {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  value: Record<string, unknown>;
  primaryType?: string;
}

// =============================================================================
// Read-only calls
// =============================================================================

export interface EvmCallParams {
  to: string;
  data?: string;
  from?: string;
  value?: string;
}

export interface EvmEstimateGasParams {
  to: string;
  data?: string;
  from?: string;
  value?: string;
}

export interface EvmGasEstimate {
  gas: string;
  gasHex: string;
}

export interface EvmGasPrice {
  gasPriceWei: string;
  gasPriceGwei: string;
}
