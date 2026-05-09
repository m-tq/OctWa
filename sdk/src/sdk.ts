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
  // Phase 7 — PVAC / HFHE
  CryptoIdentity,
  CipherDecryptResult,
  CipherEncryptResult,
  RawStealthOutput,
  ScannedOutput,
  ScanOutputsResult,
  SharedSecretResult,
  ZkSignInput,
  ZkSignResult,
  PvacProgressCallback,
  // Phase 9 — reads
  TransactionInfo,
  WaitForConfirmationOptions,
  EpochInfo,
  RecommendedFee,
  ContractViewPayload,
  ContractViewResult,
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

      const payloadHash = req.payload ? await hashPayload(req.payload) : '';

      let transportPayload: SignedInvocation['payload'];
      const isByteArrayLike = (v: unknown): v is Uint8Array =>
        !!v &&
        typeof (v as { byteLength?: unknown }).byteLength === 'number' &&
        typeof (v as { BYTES_PER_ELEMENT?: unknown }).BYTES_PER_ELEMENT === 'number';

      if (isByteArrayLike(req.payload)) {
        transportPayload = { _type: 'Uint8Array', data: Array.from(req.payload as Uint8Array) };
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

  // ── Phase 7: PVAC / HFHE Crypto Identity ──────────────────────────────────

  /**
   * Get wallet's crypto identity: Ed25519 pubkey, Curve25519 view pubkey,
   * PVAC registration status, and current HFHE cipher.
   *
   * Auto-executes — no popup. Requires a capability with `get_crypto_identity`
   * method and `read` scope.
   *
   * The view public key is safe to share with counterparties for stealth sends.
   * It has no signing power — only used for ECDH key agreement.
   */
  async getCryptoIdentity(capabilityId: string): Promise<CryptoIdentity> {
    this.ensureInstalled();
    this.ensureConnected();

    try {
      const result = await this.provider!.getCryptoIdentity();
      return result as CryptoIdentity;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Compute ECDH shared secret with a counterparty's Curve25519 view pubkey.
   * Returns the shared secret plus derived stealth tag and claim secret.
   *
   * Auto-executes — no popup. Requires a capability with `compute_shared_secret`
   * method and `read` scope.
   *
   * Use case: dApp needs to verify a stealth output belongs to a specific
   * recipient, or to derive encryption keys for private messaging.
   *
   * @param capabilityId - Active capability ID
   * @param theirViewPubkey - Counterparty's Curve25519 view public key (base64)
   */
  async computeSharedSecret(
    capabilityId: string,
    theirViewPubkey: string,
  ): Promise<SharedSecretResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!isNonEmptyString(theirViewPubkey)) {
      throw new ValidationError('theirViewPubkey must be a non-empty string');
    }

    try {
      const result = await this.provider!.computeSharedSecret(theirViewPubkey);
      return result as SharedSecretResult;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Decrypt an HFHE cipher client-side using the wallet's PVAC secret key.
   * No transaction, no fee — pure read operation.
   *
   * Auto-executes — no popup. Requires a capability with `decrypt_cipher`
   * method and `read` scope.
   *
   * Use case: dApp fetches an encrypted value from contract storage and
   * decrypts it locally to display to the user.
   *
   * @param capabilityId - Active capability ID
   * @param cipher - HFHE cipher string ("hfhe_v1|..." from contract storage)
   */
  async decryptCipher(
    capabilityId: string,
    cipher: string,
  ): Promise<CipherDecryptResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!isNonEmptyString(cipher)) {
      throw new ValidationError('cipher must be a non-empty string');
    }

    try {
      const result = await this.provider!.decryptCipher(cipher);
      // Deserialize bigint from string (postMessage transport)
      const raw = result as { valueRaw: string | bigint; valueOct: number };
      return {
        valueRaw: typeof raw.valueRaw === 'bigint' ? raw.valueRaw : BigInt(raw.valueRaw ?? 0),
        valueOct: raw.valueOct ?? 0,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Encrypt a value client-side using the wallet's PVAC public key.
   * Returns an hfhe_v1|... cipher ready for use in contract calls.
   *
   * Auto-executes — no popup. Requires a capability with `encrypt_value`
   * method and `read` scope.
   *
   * Use case: dApp needs to pass an encrypted value to a contract method
   * without revealing the plaintext on-chain.
   *
   * @param capabilityId - Active capability ID
   * @param valueRaw - Value in raw units (1 OCT = 1_000_000)
   */
  async encryptValue(
    capabilityId: string,
    valueRaw: bigint,
  ): Promise<CipherEncryptResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (valueRaw < 0n) {
      throw new ValidationError('valueRaw must be non-negative');
    }

    try {
      const result = await this.provider!.encryptValue(valueRaw);
      return result as CipherEncryptResult;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Scan a list of raw stealth outputs and return ones belonging to this wallet.
   * Performs ECDH inside the wallet context — private view key never leaves.
   *
   * Auto-executes — no popup. Requires a capability with `scan_outputs`
   * method and `read` scope.
   *
   * Use case: dApp fetches all stealth outputs from the node and lets the
   * wallet identify which ones belong to the current user.
   *
   * @param capabilityId - Active capability ID
   * @param outputs - Raw stealth outputs from node RPC (octra_stealthOutputs)
   * @param onProgress - Optional progress callback for large output sets
   */
  async scanOutputs(
    capabilityId: string,
    outputs: RawStealthOutput[],
    onProgress?: PvacProgressCallback,
  ): Promise<ScanOutputsResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!Array.isArray(outputs)) {
      throw new ValidationError('outputs must be an array');
    }

    onProgress?.({ step: 'initializing', label: 'Preparing scan...', percent: 5 });

    try {
      onProgress?.({ step: 'scanning', label: `Scanning ${outputs.length} outputs...`, percent: 20 });

      const result = await this.provider!.scanOutputs(outputs, onProgress);

      onProgress?.({ step: 'done', label: 'Scan complete', percent: 100 });

      // Deserialize bigint fields from string transport
      const raw = result as {
        outputs: Array<ScannedOutput & { amountRaw: string | bigint }>;
        totalScanned: number;
        matched: number;
      };

      return {
        outputs: raw.outputs.map((o) => ({
          ...o,
          amountRaw: typeof o.amountRaw === 'bigint' ? o.amountRaw : BigInt(o.amountRaw ?? 0),
        })),
        totalScanned: raw.totalScanned,
        matched: raw.matched,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Sign data for use as a ZK proof public input.
   * Uses the wallet's Ed25519 key. Always opens a popup for user approval.
   *
   * Requires a capability with `sign_for_zk` method and `write` scope.
   *
   * Use case: dApp needs to generate a ZK proof where the public input
   * includes a wallet signature (e.g., proving ownership without revealing key).
   *
   * @param capabilityId - Active capability ID
   * @param input - Data to sign and optional domain string
   */
  async signForZK(
    capabilityId: string,
    input: ZkSignInput,
  ): Promise<ZkSignResult> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!input?.data || !(input.data instanceof Uint8Array) || input.data.length === 0) {
      throw new ValidationError('input.data must be a non-empty Uint8Array');
    }

    try {
      const result = await this.provider!.signForZK(input);
      return result as ZkSignResult;
    } catch (error) {
      throw wrapProviderError(error);
    }
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

  // ── Phase 9: Reads — transactions, epoch, fees, contract views ────────────

  /**
   * Look up a single transaction by hash.
   * Auto-executes — no popup.
   * Requires a capability with method `get_transaction` and `read` scope.
   */
  async getTransaction(capabilityId: string, hash: string): Promise<TransactionInfo | null> {
    if (!isNonEmptyString(hash)) throw new ValidationError('hash must be a non-empty string');
    const result = await this.invoke({
      capabilityId,
      method: 'get_transaction',
      payload: new TextEncoder().encode(JSON.stringify({ hash })),
    });
    const data = decodeResponseData<TransactionInfo | null>(result);
    return data ?? null;
  }

  /**
   * Poll until a transaction is either confirmed, rejected, or dropped.
   * Resolves with the final status or rejects on timeout.
   *
   * Defaults: 120_000 ms budget (>= 12 epochs), 3_000 ms interval.
   *
   * @throws TimeoutError if the poll budget is exhausted without a terminal state.
   */
  async waitForConfirmation(
    capabilityId: string,
    hash: string,
    options: WaitForConfirmationOptions = {},
  ): Promise<TransactionInfo> {
    const timeoutMs      = options.timeoutMs      ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 3_000;
    const deadline       = Date.now() + timeoutMs;

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (Date.now() < deadline) {
      try {
        const info = await this.getTransaction(capabilityId, hash);
        options.onTick?.(info);
        consecutiveErrors = 0;

        if (info && (info.status === 'confirmed' || info.status === 'rejected' || info.status === 'dropped')) {
          return info;
        }
      } catch (err) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          const { TimeoutError } = await import('./errors');
          throw new TimeoutError(
            `waitForConfirmation(${hash}) after ${consecutiveErrors} consecutive lookup errors`,
            err,
          );
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const { TimeoutError } = await import('./errors');
    throw new TimeoutError(`waitForConfirmation(${hash}) not confirmed within ${timeoutMs} ms`);
  }

  /**
   * Current Octra epoch from the wallet's active RPC.
   * Auto-executes — no popup.
   * Requires a capability with method `get_epoch` and `read` scope.
   */
  async getEpoch(capabilityId: string): Promise<EpochInfo> {
    const result = await this.invoke({ capabilityId, method: 'get_epoch' });
    const data = decodeResponseData<EpochInfo>(result);
    if (!data) throw new Error('Empty epoch response');
    return data;
  }

  /**
   * Recommended fee for an op_type, pulled from `octra_recommendedFee`.
   * Auto-executes — no popup.
   *
   * @param opType - one of: standard | encrypt | decrypt | stealth | claim | call | deploy | key_switch
   */
  async getRecommendedFee(capabilityId: string, opType: string): Promise<RecommendedFee> {
    if (!isNonEmptyString(opType)) throw new ValidationError('opType is required');
    const result = await this.invoke({
      capabilityId,
      method: 'get_recommended_fee',
      payload: new TextEncoder().encode(JSON.stringify({ opType })),
    });
    const data = decodeResponseData<RecommendedFee>(result);
    if (!data) throw new Error('Empty recommendedFee response');
    return data;
  }

  /**
   * Read a single contract storage slot by raw key.
   * No tx, no fee — view-only.
   */
  async getContractStorage(
    capabilityId: string,
    contract: string,
    key: string,
  ): Promise<unknown> {
    if (!isNonEmptyString(contract)) throw new ValidationError('contract is required');
    if (!isNonEmptyString(key))      throw new ValidationError('key is required');
    const result = await this.invoke({
      capabilityId,
      method: 'get_contract_storage',
      payload: new TextEncoder().encode(JSON.stringify({ contract, key })),
    });
    const data = decodeResponseData<{ value: unknown }>(result);
    return data?.value ?? null;
  }

  /**
   * Call a contract view method (read-only). No tx, no fee.
   */
  async callContractView(
    capabilityId: string,
    payload: ContractViewPayload,
  ): Promise<ContractViewResult> {
    if (!isNonEmptyString(payload.contract)) throw new ValidationError('contract is required');
    if (!isNonEmptyString(payload.method))   throw new ValidationError('method is required');
    const result = await this.invoke({
      capabilityId,
      method: 'contract_call_view',
      payload: new TextEncoder().encode(JSON.stringify({
        contract: payload.contract,
        method:   payload.method,
        params:   payload.params ?? [],
      })),
    });
    const data = decodeResponseData<ContractViewResult>(result);
    return data ?? { result: null };
  }

  /**
   * Fetch the Curve25519 view pubkey registered for a given Octra address.
   * Needed before sending a stealth transfer to them.
   * Auto-executes — no popup.
   */
  async getViewPubkey(capabilityId: string, address: string): Promise<string | null> {
    if (!isNonEmptyString(address)) throw new ValidationError('address is required');
    const result = await this.invoke({
      capabilityId,
      method: 'get_view_pubkey',
      payload: new TextEncoder().encode(JSON.stringify({ address })),
    });
    const data = decodeResponseData<{ viewPubkey: string | null }>(result);
    return data?.viewPubkey ?? null;
  }

  /**
   * Convenience: `getBalance` + `decryptCipher` in one call.
   * Returns the decrypted encrypted balance (0 if no cipher).
   *
   * Auto-executes — no popup. Requires capability methods `get_balance` AND `decrypt_cipher`.
   */
  async getDecryptedBalance(
    capabilityId: string,
  ): Promise<BalanceResponse & { decryptedEncryptedBalance: number; decryptedEncryptedBalanceRaw: bigint }> {
    const balance = await this.getBalance(capabilityId);

    if (!balance.cipher || balance.cipher === '0') {
      return { ...balance, decryptedEncryptedBalance: 0, decryptedEncryptedBalanceRaw: 0n };
    }

    const dec = await this.decryptCipher(capabilityId, balance.cipher);
    return {
      ...balance,
      encryptedBalance:              dec.valueOct,
      decryptedEncryptedBalance:     dec.valueOct,
      decryptedEncryptedBalanceRaw:  dec.valueRaw,
    };
  }

  /**
   * Full stealth scan that fetches raw outputs from the wallet's active RPC
   * and then runs wallet-side ECDH matching.
   *
   * Supersedes the legacy `stealthScan` (which cannot match outputs because
   * the background service worker has no access to the private view key).
   *
   * Auto-executes — no popup. Requires `stealth_scan` (+ read) for the RPC fetch
   * and `scan_outputs` (+ read) for the local match.
   */
  async stealthScanFull(
    capabilityId: string,
    fromEpoch = 0,
    onProgress?: PvacProgressCallback,
  ): Promise<ScanOutputsResult> {
    let fetched: { outputs: RawStealthOutput[] } | null = null;
    try {
      const fetchResult = await this.invoke({
        capabilityId,
        method: 'get_stealth_outputs',
        payload: new TextEncoder().encode(JSON.stringify({ fromEpoch })),
      });
      fetched = decodeResponseData<{ outputs: RawStealthOutput[] }>(fetchResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`stealthScanFull failed during get_stealth_outputs RPC: ${msg}`);
    }

    const raw = fetched?.outputs ?? [];
    try {
      return await this.scanOutputs(capabilityId, raw, onProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`stealthScanFull failed during scanOutputs (${raw.length} outputs): ${msg}`);
    }
  }

  /**
   * Submit a `key_switch` transaction — replaces the wallet's PVAC pubkey
   * on-chain. Used to recover from a PVAC foreign-key conflict.
   *
   * Always opens a popup. Requires capability method `key_switch` and `write` scope.
   */
  async keySwitch(capabilityId: string): Promise<{ txHash: string }> {
    const result = await this.invoke({ capabilityId, method: 'key_switch' });
    const data = decodeResponseData<{ txHash: string }>(result);
    if (!data?.txHash) throw new Error('No transaction hash in key_switch response');
    return { txHash: data.txHash };
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
