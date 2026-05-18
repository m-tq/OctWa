/**
 * @octwa/sdk — EVM Bridge
 *
 * Typed wrapper for the evm_* methods exposed by OctWa. All signing happens
 * inside the wallet's trusted popup — the SDK never touches private keys.
 *
 * Usage:
 *   const sdk = await OctraSDK.init();
 *   const addr = await sdk.evm.getDerivedAddress();
 *   const bal  = await sdk.evm.getBalance();
 */

import type { OctraProvider } from './types';
import type {
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
import { wrapProviderError, DisconnectedError } from './errors';

export class EvmBridge {
  private provider: OctraProvider | null;
  private connected: () => boolean;

  /** @internal — instantiated by OctraSDK, not by consumers directly. */
  constructor(provider: OctraProvider | null, isConnected: () => boolean) {
    this.provider = provider;
    this.connected = isConnected;
  }

  // ── Network & Account ────────────────────────────────────────────────────

  /**
   * Get the EVM address derived from the currently active Octra wallet.
   * No popup — the address is public data.
   */
  async getDerivedAddress(): Promise<string> {
    this.ensureConnected();
    return this.request<string>('evm_getDerivedAddress');
  }

  /** Active EVM chain ID. */
  async getChainId(): Promise<number> {
    return this.request<number>('evm_getChainId');
  }

  /** Full network info for the active EVM chain. */
  async getNetworkInfo(): Promise<EvmNetworkInfo> {
    return this.request<EvmNetworkInfo>('evm_getNetworkInfo');
  }

  /**
   * Get the ETH (native) balance for an address.
   * Defaults to the derived EVM address when `address` is omitted.
   */
  async getBalance(address?: string, networkId?: string): Promise<EvmBalanceResult> {
    this.ensureConnected();
    return this.request<EvmBalanceResult>('evm_getBalance', [{ address, networkId }]);
  }

  /** Switch the active EVM chain. Opens a popup for user approval. */
  async switchChain(chainId: number): Promise<EvmNetworkInfo> {
    this.ensureConnected();
    return this.request<EvmNetworkInfo>('evm_switchChain', [{ chainId }]);
  }

  // ── Transactions ─────────────────────────────────────────────────────────

  /**
   * Send an EVM transaction (native ETH transfer or arbitrary contract call).
   * Opens the wallet popup for user approval.
   */
  async sendTransaction(params: EvmSendTransactionParams): Promise<EvmTransactionResult> {
    this.ensureConnected();
    return this.request<EvmTransactionResult>('evm_sendTransaction', [params]);
  }

  /**
   * Sign a plaintext message using `personal_sign`.
   * Opens the wallet popup for user approval.
   */
  async signMessage(message: string): Promise<EvmSignMessageResult> {
    this.ensureConnected();
    return this.request<EvmSignMessageResult>('evm_signMessage', [{ message }]);
  }

  /**
   * Sign EIP-712 structured data.
   * Opens the wallet popup for user approval.
   */
  async signTypedData(params: EvmSignTypedDataParams): Promise<EvmSignMessageResult> {
    this.ensureConnected();
    return this.request<EvmSignMessageResult>('evm_signTypedData', [params]);
  }

  // ── ERC-20 Tokens ────────────────────────────────────────────────────────

  /**
   * Get ERC-20 token balance. Defaults to derived address when `owner` is omitted.
   */
  async getTokenBalance(token: string, owner?: string): Promise<EvmTokenBalanceResult> {
    this.ensureConnected();
    return this.request<EvmTokenBalanceResult>('evm_getTokenBalance', [{ token, owner }]);
  }

  /** Get ERC-20 token metadata (name, symbol, decimals). */
  async getTokenInfo(token: string): Promise<EvmTokenInfo> {
    return this.request<EvmTokenInfo>('evm_getTokenInfo', [{ token }]);
  }

  /**
   * Transfer ERC-20 tokens. Opens the wallet popup for approval.
   * Amount is in the token's smallest unit.
   */
  async transferToken(params: EvmTransferTokenParams): Promise<EvmTransactionResult> {
    this.ensureConnected();
    return this.request<EvmTransactionResult>('evm_transferToken', [params]);
  }

  /**
   * Approve a spender to transfer tokens on your behalf.
   * Opens the wallet popup for approval. Omit `amount` for unlimited.
   */
  async approveToken(params: EvmApproveTokenParams): Promise<EvmTransactionResult> {
    this.ensureConnected();
    return this.request<EvmTransactionResult>('evm_approveToken', [params]);
  }

  /** Check the current ERC-20 allowance. No popup. */
  async getAllowance(params: EvmAllowanceParams): Promise<EvmAllowanceResult> {
    return this.request<EvmAllowanceResult>('evm_getAllowance', [params]);
  }

  // ── Low-level reads ──────────────────────────────────────────────────────

  /** Execute a read-only `eth_call`. No popup, no transaction. */
  async call(params: EvmCallParams): Promise<string> {
    return this.request<string>('evm_call', [params]);
  }

  /** Estimate gas for a transaction. */
  async estimateGas(params: EvmEstimateGasParams): Promise<EvmGasEstimate> {
    return this.request<EvmGasEstimate>('evm_estimateGas', [params]);
  }

  /** Get current gas price. */
  async getGasPrice(): Promise<EvmGasPrice> {
    return this.request<EvmGasPrice>('evm_getGasPrice');
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async request<T>(method: string, params?: readonly unknown[]): Promise<T> {
    if (!this.provider) throw new DisconnectedError('Provider not available');
    try {
      const result = await this.provider.request({ method, params });
      return result as T;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  private ensureConnected(): void {
    if (!this.provider) throw new DisconnectedError('Provider not available');
    if (!this.connected()) {
      throw new DisconnectedError('Not connected. Call sdk.connect() first.');
    }
  }
}
