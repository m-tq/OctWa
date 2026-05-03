// Octra Web Wallet SDK — main orchestration class.

import type {
  InitOptions,
  ConnectRequest,
  Connection,
  CapabilityRequest,
  Capability,
  InvocationRequest,
  InvocationResult,
  SessionState,
  SignedInvocation,
  OctraProvider,
  EventName,
  EventCallback,
  GasEstimate,
  EncryptedPayload,
  BalanceResponse,
  SignMessageResult,
  EvmTransactionPayload,
  EvmTransactionResult,
  Erc20TransactionPayload,
  EncryptedBalanceInfo,
  EncryptBalanceResult,
  DecryptBalanceResult,
  ClaimableOutput,
  StealthSendPayload,
  StealthSendResult,
  StealthClaimResult,
  ContractCallPayload,
  ContractCallResult,
  Erc20TokenBalance,
  GetEvmTokensResult,
} from './types';

import { NotInstalledError, NotConnectedError, ValidationError, wrapProviderError } from './errors';
import { NonceManager }      from './nonce-manager';
import { CapabilityService } from './capability-service';
import { GasService }        from './gas-service';
import { domainSeparator }   from './crypto';
import { detectProvider, isNonEmptyString, isValidScope, getCurrentOrigin } from './utils';
import { hashPayload }       from './canonical';
import { decodeResponseData, decodeBalanceResponse } from './response-utils';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

export class OctraSDK {
  private provider: OctraProvider | null = null;
  private connection: Connection | null = null;
  private readonly nonceManager: NonceManager;
  private readonly capabilityService: CapabilityService;
  private readonly gasService: GasService;
  private readonly listeners: EventListeners = {};
  private readonly currentOrigin: string;
  private signingMutex: Promise<void> = Promise.resolve();

  private constructor() {
    this.currentOrigin     = getCurrentOrigin();
    this.nonceManager      = new NonceManager();
    this.capabilityService = new CapabilityService();
    this.gasService        = new GasService();
  }

  static async init(options: InitOptions = {}): Promise<OctraSDK> {
    const sdk = new OctraSDK();
    sdk.provider = await detectProvider(options.timeout ?? 3000);

    if (sdk.provider) {
      sdk.setupProviderListeners();
      sdk.emit('extensionReady');
    }

    return sdk;
  }

  isInstalled(): boolean {
    return this.provider !== null && this.provider.isOctra === true;
  }

  async connect(request: ConnectRequest): Promise<Connection> {
    this.ensureInstalled();

    if (!isNonEmptyString(request.circle)) throw new ValidationError('Circle ID is required');
    if (!isNonEmptyString(request.appOrigin)) throw new ValidationError('appOrigin is required');

    try {
      const connection = await this.provider!.connect({
        ...request,
        appOrigin: request.appOrigin || this.currentOrigin,
      });
      this.connection = connection;
      this.emit('connect', { connection });
      return connection;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;

    try {
      await this.provider?.disconnect();
    } catch { /* ignore */ }

    this.connection = null;
    this.nonceManager.clearAll();
    this.capabilityService.clearAll();
    this.emit('disconnect');
  }

  async requestCapability(req: CapabilityRequest): Promise<Capability> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!isNonEmptyString(req.circle)) throw new ValidationError('Circle ID is required');
    if (!req.methods?.length) throw new ValidationError('At least one method is required');
    if (!isValidScope(req.scope)) {
      throw new ValidationError(`Invalid scope: '${req.scope}'. Must be 'read', 'write', or 'compute'`);
    }

    try {
      const capability = await this.provider!.requestCapability(req);
      this.capabilityService.add(capability);
      this.nonceManager.resetNonce(capability.id, capability.nonceBase);
      this.emit('capabilityGranted', { capability });
      return capability;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async renewCapability(capabilityId: string): Promise<Capability> {
    this.ensureInstalled();
    this.ensureConnected();

    try {
      const renewed = await this.provider!.renewCapability(capabilityId);
      this.capabilityService.add(renewed);
      this.nonceManager.resetNonce(renewed.id, renewed.nonceBase);
      return renewed;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async revokeCapability(capabilityId: string): Promise<void> {
    this.ensureInstalled();

    try {
      await this.provider!.revokeCapability(capabilityId);
      this.capabilityService.revoke(capabilityId);
      this.nonceManager.remove(capabilityId);
      this.emit('capabilityRevoked', { capabilityId });
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async listCapabilities(): Promise<Capability[]> {
    this.ensureInstalled();
    try {
      return await this.provider!.listCapabilities();
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    this.ensureInstalled();
    this.ensureConnected();

    this.capabilityService.validate(req.capabilityId);

    if (!this.capabilityService.isMethodAllowed(req.capabilityId, req.method)) {
      const { ScopeViolationError } = await import('./errors');
      throw new ScopeViolationError(req.method, req.capabilityId);
    }

    return this.withSigningLock(async () => {
      const nonce    = this.nonceManager.getNextNonce(req.capabilityId);
      const branchId = req.branchId || this.connection!.branchId || 'main';
      const epoch    = this.connection!.epoch || 0;

      const originHash = domainSeparator({
        circleId:     this.connection!.circle,
        origin:       this.currentOrigin,
        epoch,
        branchId,
        capabilityId: req.capabilityId,
        method:       req.method,
        nonce,
      });

      const payloadHash = req.payload ? hashPayload(req.payload) : '';

      let transportPayload: SignedInvocation['payload'];
      if (req.payload instanceof Uint8Array) {
        transportPayload = { _type: 'Uint8Array', data: Array.from(req.payload) };
      } else if (req.payload && 'data' in req.payload) {
        transportPayload = {
          _type: 'Uint8Array',
          data: Array.from((req.payload as EncryptedPayload).data),
        };
      }

      const signedInvocation: SignedInvocation = {
        header: {
          version:    2,
          circleId:   this.connection!.circle,
          branchId,
          epoch,
          nonce,
          timestamp:  Date.now(),
          originHash,
        },
        payload: transportPayload,
        body: {
          capabilityId: req.capabilityId,
          method:       req.method,
          payloadHash,
        },
      };

      try {
        return await this.provider!.invoke(signedInvocation);
      } catch (error) {
        this.nonceManager.resetNonce(req.capabilityId, nonce - 1);
        throw wrapProviderError(error);
      }
    });
  }

  async estimatePlainTx(payload: unknown): Promise<GasEstimate> {
    this.ensureInstalled();
    try {
      return await this.provider!.estimatePlainTx(payload);
    } catch {
      return this.gasService.estimatePlainTx(payload);
    }
  }

  async estimateEncryptedTx(payload: EncryptedPayload): Promise<GasEstimate> {
    this.ensureInstalled();
    try {
      return await this.provider!.estimateEncryptedTx(payload);
    } catch {
      return this.gasService.estimateEncryptedTx(payload);
    }
  }

  // ── Phase 1: Sign Message ──────────────────────────────────────────────────

  /**
   * Sign an arbitrary UTF-8 message with the wallet's Ed25519 key.
   * Useful for authentication flows (e.g. "Sign in with Octra").
   * Always opens a popup for user approval.
   */
  async signMessage(message: string): Promise<SignMessageResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!isNonEmptyString(message)) {
      throw new ValidationError('Message must be a non-empty string');
    }

    try {
      const signature = await this.provider!.signMessage(message);
      return {
        signature,
        message,
        address: this.connection!.walletPubKey,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  // ── Phase 2: Balance (full) ────────────────────────────────────────────────

  /**
   * Get full wallet balance including encrypted balance info.
   * Requires a capability with `get_balance` method.
   * Auto-executes (no popup).
   */
  async getBalance(capabilityId: string): Promise<BalanceResponse> {
    const result = await this.invoke({ capabilityId, method: 'get_balance' });
    return decodeBalanceResponse(result);
  }

  // ── Phase 3: EVM Operations ────────────────────────────────────────────────

  /**
   * Send an ETH/EVM transaction using the wallet's derived secp256k1 key.
   * Always opens a popup for user approval.
   * Requires a capability with `send_evm_transaction` method and `write` scope.
   * Network defaults to the wallet's active EVM network — no need to specify manually.
   */
  async sendEvmTransaction(
    capabilityId: string,
    payload: EvmTransactionPayload,
  ): Promise<EvmTransactionResult> {
    if (!payload.to) throw new ValidationError('EVM recipient address is required');

    // Default to wallet's active EVM network — dApp should not need to specify this
    const resolvedPayload: EvmTransactionPayload = {
      ...payload,
      network: payload.network ?? this.connection?.evmNetworkId ?? 'eth-mainnet',
    };

    const result = await this.invoke({
      capabilityId,
      method: 'send_evm_transaction',
      payload: new TextEncoder().encode(JSON.stringify(resolvedPayload)),
    });

    const data = decodeResponseData<EvmTransactionResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in EVM response');
    return data;
  }

  /**
   * Send an ERC-20 token transfer using the wallet's derived secp256k1 key.
   * Always opens a popup for user approval.
   * Requires a capability with `send_erc20_transaction` method and `write` scope.
   * Network defaults to the wallet's active EVM network — no need to specify manually.
   */
  async sendErc20Transaction(
    capabilityId: string,
    payload: Erc20TransactionPayload,
  ): Promise<EvmTransactionResult> {
    if (!payload.tokenContract) throw new ValidationError('Token contract address is required');
    if (!payload.to) throw new ValidationError('Recipient address is required');
    if (!payload.amount) throw new ValidationError('Amount is required');

    // Default to wallet's active EVM network — dApp should not need to specify this
    const resolvedPayload: Erc20TransactionPayload = {
      ...payload,
      network: payload.network ?? this.connection?.evmNetworkId ?? 'eth-mainnet',
    };

    const result = await this.invoke({
      capabilityId,
      method: 'send_erc20_transaction',
      payload: new TextEncoder().encode(JSON.stringify(resolvedPayload)),
    });

    const data = decodeResponseData<EvmTransactionResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in ERC-20 response');
    return data;
  }

  // ── Phase 4: Encrypted Balance ─────────────────────────────────────────────

  /**
   * Get encrypted balance info (cipher, decrypted amount if PVAC available).
   * Auto-executes (no popup).
   * Requires a capability with `get_encrypted_balance` method and `read` scope.
   */
  async getEncryptedBalance(capabilityId: string): Promise<EncryptedBalanceInfo> {
    const result = await this.invoke({
      capabilityId,
      method: 'get_encrypted_balance',
    });

    const data = decodeResponseData<EncryptedBalanceInfo>(result);
    if (!data) throw new Error('Empty encrypted balance response');
    return data;
  }

  /**
   * Move OCT from public balance into encrypted balance.
   * Always opens a popup for user approval.
   * Requires a capability with `encrypt_balance` method and `write` scope.
   *
   * @param amount - Amount in OCT to encrypt
   */
  async encryptBalance(capabilityId: string, amount: number): Promise<EncryptBalanceResult> {
    if (amount <= 0) throw new ValidationError('Amount must be greater than 0');

    const result = await this.invoke({
      capabilityId,
      method: 'encrypt_balance',
      payload: new TextEncoder().encode(JSON.stringify({ amount })),
    });

    const data = decodeResponseData<EncryptBalanceResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in encrypt response');
    return data;
  }

  /**
   * Move OCT from encrypted balance back into public balance.
   * Always opens a popup for user approval.
   * Requires a capability with `decrypt_balance` method and `write` scope.
   *
   * @param amount - Amount in OCT to decrypt
   */
  async decryptBalance(capabilityId: string, amount: number): Promise<DecryptBalanceResult> {
    if (amount <= 0) throw new ValidationError('Amount must be greater than 0');

    const result = await this.invoke({
      capabilityId,
      method: 'decrypt_balance',
      payload: new TextEncoder().encode(JSON.stringify({ amount })),
    });

    const data = decodeResponseData<DecryptBalanceResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in decrypt response');
    return data;
  }

  // ── Phase 5: Stealth Transfers ─────────────────────────────────────────────

  /**
   * Send a stealth (private) transfer from encrypted balance.
   * Always opens a popup for user approval.
   * Requires a capability with `stealth_send` method and `write` scope.
   * The recipient must have a registered view public key.
   */
  async stealthSend(
    capabilityId: string,
    payload: StealthSendPayload,
  ): Promise<StealthSendResult> {
    if (!isNonEmptyString(payload.to)) throw new ValidationError('Recipient address is required');
    if (payload.amount <= 0) throw new ValidationError('Amount must be greater than 0');

    const result = await this.invoke({
      capabilityId,
      method: 'stealth_send',
      payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    const data = decodeResponseData<StealthSendResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in stealth send response');
    return data;
  }

  /**
   * Scan for claimable stealth outputs belonging to this wallet.
   * Auto-executes (no popup) — uses wallet's private view key internally.
   * Requires a capability with `stealth_scan` method and `read` scope.
   */
  async stealthScan(capabilityId: string): Promise<ClaimableOutput[]> {
    const result = await this.invoke({
      capabilityId,
      method: 'stealth_scan',
    });

    const data = decodeResponseData<{ outputs: ClaimableOutput[] }>(result);
    return data?.outputs ?? [];
  }

  /**
   * Claim a stealth output — adds the amount to encrypted balance.
   * Always opens a popup for user approval.
   * Requires a capability with `stealth_claim` method and `write` scope.
   *
   * @param outputId - The stealth output ID from stealthScan()
   */
  async stealthClaim(capabilityId: string, outputId: string): Promise<StealthClaimResult> {
    if (!isNonEmptyString(outputId)) throw new ValidationError('Output ID is required');

    const result = await this.invoke({
      capabilityId,
      method: 'stealth_claim',
      payload: new TextEncoder().encode(JSON.stringify({ outputId })),
    });

    const data = decodeResponseData<StealthClaimResult>(result);
    if (!data?.txHash) throw new Error('No transaction hash in stealth claim response');
    return data;
  }

  // ── Phase 6: Contract Interactions ────────────────────────────────────────

  /**
   * Send a state-changing contract call transaction.
   * Always opens a popup for user approval.
   * Requires a capability with `send_transaction` method and `write` scope.
   *
   * Octra contract call wire format (matches webcli tx_builder.hpp):
   *   op_type:        'call'
   *   encrypted_data: method name as plain string  (e.g. 'lock_to_eth')
   *   message:        params as JSON array string  (e.g. '["0xAddr"]')
   *   to:             contract address
   *   amount:         OCT to attach (default 0)
   */
  async sendContractCall(
    capabilityId: string,
    payload: ContractCallPayload,
  ): Promise<ContractCallResult> {
    if (!isNonEmptyString(payload.contract)) throw new ValidationError('Contract address is required');
    if (!isNonEmptyString(payload.method)) throw new ValidationError('Method name is required');

    const result = await this.invoke({
      capabilityId,
      method: 'send_transaction',
      payload: new TextEncoder().encode(JSON.stringify({
        to:             payload.contract,
        amount:         payload.amount ?? 0,
        op_type:        'call',
        encrypted_data: payload.method,                              // plain method name string
        message:        JSON.stringify(payload.params ?? []),        // params as JSON array string
        ou:             payload.ou,
      })),
    });

    const data = decodeResponseData<{ txHash: string }>(result);
    if (!data?.txHash) throw new Error('No transaction hash in contract call response');
    return {
      txHash:   data.txHash,
      contract: payload.contract,
      method:   payload.method,
    };
  }

  // ── Phase 8: EVM Token Balances ───────────────────────────────────────────

  /**
   * Get all ERC-20 token balances for the wallet's active EVM network.
   * Returns common tokens (wOCT, USDC, etc.) plus any user-imported tokens.
   * Auto-executes (no popup).
   * Requires a capability with `get_evm_tokens` method and `read` scope.
   */
  async getEvmTokens(capabilityId: string): Promise<GetEvmTokensResult> {
    const result = await this.invoke({ capabilityId, method: 'get_evm_tokens' });
    const data = decodeResponseData<GetEvmTokensResult>(result);
    return data ?? { tokens: [], networkId: this.connection?.evmNetworkId ?? '', chainId: 0 };
  }

  /**
   * Get the balance of a specific ERC-20 token for the wallet's EVM address.
   * Auto-executes (no popup).
   * Requires a capability with `get_evm_token_balance` method and `read` scope.
   *
   * @param tokenAddress - ERC-20 contract address (0x...)
   * @param options      - Optional token metadata (decimals, symbol, name) for display
   */
  async getEvmTokenBalance(
    capabilityId: string,
    tokenAddress: string,
    options?: { decimals?: number; symbol?: string; name?: string },
  ): Promise<Erc20TokenBalance> {
    if (!isNonEmptyString(tokenAddress)) throw new ValidationError('tokenAddress is required');

    const result = await this.invoke({
      capabilityId,
      method: 'get_evm_token_balance',
      payload: new TextEncoder().encode(JSON.stringify({ tokenAddress, ...options })),
    });

    const data = decodeResponseData<Erc20TokenBalance>(result);
    if (!data) throw new Error('Empty token balance response');
    return data;
  }

  getSessionState(): SessionState {
    this.capabilityService.cleanupExpired();
    return {
      connected:          this.connection !== null,
      circle:             this.connection?.circle,
      branchId:           this.connection?.branchId,
      epoch:              this.connection?.epoch,
      activeCapabilities: this.capabilityService.getActive(),
    };
  }

  on<E extends EventName>(event: E, callback: EventCallback<E>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as EventListeners[E];
    }
    (this.listeners[event] as Set<EventCallback<E>>).add(callback);
    return () => this.off(event, callback);
  }

  off<E extends EventName>(event: E, callback: EventCallback<E>): void {
    (this.listeners[event] as Set<EventCallback<E>> | undefined)?.delete(callback);
  }

  private emit<E extends EventName>(event: E, data?: Parameters<EventCallback<E>>[0]): void {
    const set = this.listeners[event];
    if (!set) return;
    set.forEach((cb) => {
      try {
        if (data !== undefined) (cb as (d: unknown) => void)(data);
        else (cb as () => void)();
      } catch { /* never let listener errors bubble */ }
    });
  }

  private setupProviderListeners(): void {
    if (!this.provider) return;

    this.provider.on('disconnect', () => {
      this.connection = null;
      this.nonceManager.clearAll();
      this.capabilityService.clearAll();
      this.emit('disconnect');
    });

    this.provider.on('branchChanged', (...args: unknown[]) => {
      const data = args[0] as { branchId: string; epoch: number };
      if (this.connection) {
        this.connection.branchId = data.branchId;
        this.connection.epoch    = data.epoch;
      }
      this.emit('branchChanged', data);
    });

    this.provider.on('epochChanged', (...args: unknown[]) => {
      const data = args[0] as { epoch: number };
      if (this.connection) this.connection.epoch = data.epoch;
      this.emit('epochChanged', data);
    });
  }

  private ensureInstalled(): void {
    if (!this.isInstalled()) throw new NotInstalledError();
  }

  private ensureConnected(): void {
    if (!this.connection) throw new NotConnectedError();
  }

  /** Signing mutex — prevents parallel signing / double-send. */
  private async withSigningLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.signingMutex;
    let release!: () => void;
    this.signingMutex = new Promise((r) => { release = r; });
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
