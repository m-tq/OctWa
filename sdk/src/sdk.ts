/**
 * @octwa/sdk — Main SDK Class (RFC-O-1 Compliant)
 *
 * Thin, ergonomic wrapper around window.octra.request().
 * All methods map directly to RFC-O-1 provider methods.
 */

import type {
  OctraProvider,
  OctraProviderEvent,
  OctraSDKOptions,
  ConnectOptions,
  OctraPermission,
  OctraNetworkInfo,
  OctraTransactionResult,
  SendTransactionParams,
  SignTransactionParams,
  SignedOctraTransaction,
  SignMessageResult,
  CallContractParams,
  SendContractTransactionParams,
  EncryptedBalanceInfo,
  PrivateTransferParams,
  WatchTransactionOptions,
  BalanceChangedPayload,
  TransactionChangedPayload,
} from './types';

import {
  NotInstalledError,
  DisconnectedError,
  TimeoutError,
  wrapProviderError,
} from './errors';

import { detectProvider } from './utils';

import { EvmBridge } from './evm';

export class OctraSDK {
  private provider: OctraProvider | null = null;
  private accounts: string[] = [];
  private connected = false;

  /** EVM bridge — access via `sdk.evm.*`. Lazily initialized on first access. */
  private _evm: EvmBridge | null = null;

  private constructor() {}

  /**
   * Initialize the SDK. Detects the provider (window.octra) or times out.
   */
  static async init(options: OctraSDKOptions = {}): Promise<OctraSDK> {
    const sdk = new OctraSDK();
    sdk.provider = await detectProvider(options.timeout ?? 3000);
    return sdk;
  }

  /**
   * EVM bridge — typed access to all evm_* methods.
   * The bridge is lazy-initialized and shares the same provider session.
   */
  get evm(): EvmBridge {
    if (!this._evm) {
      this._evm = new EvmBridge(this.provider, () => this.isConnected());
    }
    return this._evm;
  }

  // ── Provider State ─────────────────────────────────────────────────────────

  /** Check if the Octra wallet extension is installed. */
  isInstalled(): boolean {
    return this.provider !== null && this.provider.isOctra === true;
  }

  /** Check if the dApp is connected (has exposed accounts). */
  isConnected(): boolean {
    return this.connected && this.accounts.length > 0;
  }

  /** Get the raw provider for advanced usage. */
  getProvider(): OctraProvider | null {
    return this.provider;
  }

  /** Get currently exposed accounts. */
  getAccounts(): string[] {
    return [...this.accounts];
  }

  // ── Account & Permission Methods ───────────────────────────────────────────

  /**
   * Request access to wallet accounts (octra_requestAccounts).
   * Opens a popup for user consent.
   */
  async connect(options: ConnectOptions = {}): Promise<string[]> {
    this.ensureInstalled();

    try {
      const accounts = await this.request<string[]>('octra_requestAccounts', [{
        permissions: options.permissions || ['read_address', 'read_balance', 'send_transactions'],
        networkId: options.networkId,
      }]);

      this.accounts = accounts;
      this.connected = true;
      return accounts;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Get accounts currently exposed to this dApp (octra_accounts).
   * Returns empty array if not authorized.
   */
  async fetchAccounts(): Promise<string[]> {
    this.ensureInstalled();
    try {
      const accounts = await this.request<string[]>('octra_accounts');
      this.accounts = accounts;
      this.connected = accounts.length > 0;
      return accounts;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Revoke this dApp's session (octra_disconnect).
   *
   * Removes the connection from the wallet's `connectedDApps` map and
   * clears any per-origin EVM chain override. The next `connect()` call
   * will trigger a fresh approval popup, letting the user pick a
   * different wallet if needed.
   *
   * Local SDK state is also reset, so `isConnected()` returns false
   * immediately even if the wallet's `disconnect` event has not yet
   * propagated back through the message bridge.
   */
  async disconnect(): Promise<void> {
    if (!this.provider) {
      // Nothing to disconnect from — clear local state and return.
      this.accounts = [];
      this.connected = false;
      return;
    }
    try {
      await this.request<{ disconnected: boolean }>('octra_disconnect');
    } catch (error) {
      // Surface unexpected errors but never block the local cleanup.
      // A 4900 (DisconnectedError) here means the wallet had already
      // dropped the session — that's a no-op success for us.
      const wrapped = wrapProviderError(error);
      if (wrapped.code !== 4900) {
        this.accounts = [];
        this.connected = false;
        throw wrapped;
      }
    } finally {
      this.accounts = [];
      this.connected = false;
    }
  }

  /** Get the active network ID (octra_networkId). */
  async getNetworkId(): Promise<string> {
    this.ensureInstalled();
    return this.request<string>('octra_networkId');
  }

  /** Get full network info (octra_networkInfo). */
  async getNetworkInfo(): Promise<OctraNetworkInfo> {
    this.ensureInstalled();
    return this.request<OctraNetworkInfo>('octra_networkInfo');
  }

  /** Get permissions granted to this dApp (octra_permissions). */
  async getPermissions(): Promise<OctraPermission[]> {
    this.ensureInstalled();
    return this.request<OctraPermission[]>('octra_permissions');
  }

  /** Request a network switch (octra_switchNetwork). */
  async switchNetwork(networkId: string): Promise<OctraNetworkInfo> {
    this.ensureInstalled();
    return this.request<OctraNetworkInfo>('octra_switchNetwork', [{ networkId }]);
  }

  // ── Transaction Methods ────────────────────────────────────────────────────

  /**
   * Sign an arbitrary message (octra_signMessage).
   * Requires sign_messages permission. Opens popup.
   */
  async signMessage(message: string, address?: string): Promise<SignMessageResult> {
    this.ensureConnected();
    return this.request<SignMessageResult>('octra_signMessage', [{ message, address }]);
  }

  /**
   * Create, sign, and submit a transaction (octra_sendTransaction).
   * Requires send_transactions permission. Opens popup.
   */
  async sendTransaction(params: SendTransactionParams): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_sendTransaction', [params]);
  }

  /**
   * Sign a transaction without submitting (octra_signTransaction).
   * Requires send_transactions permission. Opens popup.
   */
  async signTransaction(params: SignTransactionParams): Promise<SignedOctraTransaction> {
    this.ensureConnected();
    return this.request<SignedOctraTransaction>('octra_signTransaction', [params]);
  }

  /**
   * Submit a pre-signed transaction (octra_submitTransaction).
   * Requires send_transactions permission.
   */
  async submitTransaction(tx: SignedOctraTransaction): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_submitTransaction', [{ tx }]);
  }

  // ── Contract Methods ───────────────────────────────────────────────────────

  /**
   * Execute a read-only contract call (octra_callContract).
   * Maps to native RPC contract_call. No permission required.
   */
  async callContract(params: CallContractParams): Promise<unknown> {
    this.ensureInstalled();
    return this.request<unknown>('octra_callContract', [params]);
  }

  /**
   * Send a contract transaction (octra_sendContractTransaction).
   * Requires contract_calls permission. Opens popup.
   */
  async sendContractTransaction(params: SendContractTransactionParams): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_sendContractTransaction', [params]);
  }

  /**
   * Get a contract execution receipt (octra_getContractReceipt).
   */
  async getContractReceipt(hash: string): Promise<unknown> {
    this.ensureInstalled();
    return this.request<unknown>('octra_getContractReceipt', [{ hash }]);
  }

  // ── Privacy Methods ────────────────────────────────────────────────────────

  /**
   * Get encrypted balance info (octra_getEncryptedBalance).
   * Requires view_encrypted_balance permission.
   */
  async getEncryptedBalance(address?: string): Promise<EncryptedBalanceInfo> {
    this.ensureConnected();
    return this.request<EncryptedBalanceInfo>('octra_getEncryptedBalance', [{ address }]);
  }

  /**
   * Encrypt public balance into private (octra_encryptBalance).
   * Requires encrypt_balance permission. Opens popup.
   */
  async encryptBalance(amount: string, fee?: string): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_encryptBalance', [{ amount, fee }]);
  }

  /**
   * Decrypt private balance into public (octra_decryptBalance).
   * Requires decrypt_balance permission. Opens popup.
   */
  async decryptBalance(amount: string, fee?: string): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_decryptBalance', [{ amount, fee }]);
  }

  /**
   * Send a private transfer (octra_sendPrivateTransfer).
   * Requires private_transfers permission. Opens popup.
   */
  async sendPrivateTransfer(params: PrivateTransferParams): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_sendPrivateTransfer', [params]);
  }

  /**
   * Scan stealth outputs (octra_scanStealth).
   * Requires stealth_scan permission.
   */
  async scanStealth(fromEpoch?: number): Promise<unknown[]> {
    this.ensureConnected();
    return this.request<unknown[]>('octra_scanStealth', [{ fromEpoch }]);
  }

  /**
   * Claim a stealth output (octra_claimStealth).
   * Requires stealth_claim permission. Opens popup.
   */
  async claimStealth(outputId: string, fee?: string): Promise<OctraTransactionResult> {
    this.ensureConnected();
    return this.request<OctraTransactionResult>('octra_claimStealth', [{ outputId, fee }]);
  }

  // ── Native RPC Pass-Through ────────────────────────────────────────────────

  /**
   * Call any native Octra RPC method directly.
   * Uses positional array params as per Octra JSON-RPC.
   *
   * @example
   * const balance = await sdk.rpc('octra_balance', ['oct...']);
   * const epoch = await sdk.rpc('epoch_current');
   */
  async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    this.ensureInstalled();
    return this.request<T>(method, params);
  }

  // ── Transaction Watching ───────────────────────────────────────────────────

  /**
   * Poll until a transaction reaches a terminal state.
   * Resolves with the final status or rejects on timeout.
   */
  async waitForConfirmation(
    hash: string,
    options: WatchTransactionOptions = {},
  ): Promise<OctraTransactionResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const tx = await this.rpc<{ status: string; hash: string } | null>(
          'octra_transaction', [hash],
        );

        const result: OctraTransactionResult = {
          hash,
          accepted: true,
          status: (tx?.status as OctraTransactionResult['status']) || 'pending',
        };

        options.onTick?.(result);

        if (result.status === 'confirmed' || result.status === 'rejected' || result.status === 'dropped') {
          return result;
        }
      } catch {
        options.onTick?.(null);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new TimeoutError(`waitForConfirmation(${hash})`);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to provider events.
   */
  on(event: OctraProviderEvent, listener: (...args: unknown[]) => void): this {
    this.provider?.on(event, listener);

    // Track account changes internally
    if (event === 'accountsChanged') {
      this.provider?.on('accountsChanged', (accounts: unknown) => {
        if (Array.isArray(accounts)) {
          this.accounts = accounts as string[];
          this.connected = accounts.length > 0;
        }
      });
    }

    return this;
  }

  /**
   * Unsubscribe from provider events.
   */
  removeListener(event: OctraProviderEvent, listener: (...args: unknown[]) => void): this {
    this.provider?.removeListener(event, listener);
    return this;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async request<T>(method: string, params?: readonly unknown[] | object): Promise<T> {
    if (!this.provider) throw new NotInstalledError();
    try {
      const result = await this.provider.request({ method, params });
      return result as T;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  private ensureInstalled(): void {
    if (!this.provider) throw new NotInstalledError();
  }

  private ensureConnected(): void {
    this.ensureInstalled();
    if (!this.connected || this.accounts.length === 0) {
      throw new DisconnectedError('Not connected. Call connect() first.');
    }
  }
}
