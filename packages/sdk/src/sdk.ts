import type {
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
  OctraProvider,
} from './types';

import {
  OctraError,
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
  ContractError,
  wrapProviderError,
} from './errors';

import {
  detectProvider,
  getProvider,
  isProviderInstalled,
  isNonEmptyString,
  isValidAmount,
  normalizeAmount,
} from './utils';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

/**
 * Main SDK class for interacting with Octra Wallet
 */
export class OctraSDK {
  private provider: OctraProvider | null = null;
  private _isConnected = false;
  private _address: string | null = null;
  private listeners: EventListeners = {};
  private providerListeners: Map<string, (...args: unknown[]) => void> = new Map();

  private constructor() {}

  /**
   * Initialize the SDK and wait for provider detection
   * @param options - Initialization options
   * @returns Initialized SDK instance
   */
  static async init(options: InitOptions = {}): Promise<OctraSDK> {
    const sdk = new OctraSDK();
    const timeout = options.timeout ?? 3000;
    
    sdk.provider = await detectProvider(timeout);
    
    if (sdk.provider) {
      sdk.setupProviderListeners();
      sdk.emit('extensionReady');
      
      // Sync connection state from provider
      if (sdk.provider.isConnected && sdk.provider.selectedAddress) {
        sdk._isConnected = true;
        sdk._address = sdk.provider.selectedAddress;
      }
    }
    
    return sdk;
  }

  /**
   * Check if the Octra Wallet extension is installed
   */
  isInstalled(): boolean {
    return this.provider !== null && this.provider.isOctra === true;
  }

  /**
   * Check if wallet is currently connected
   */
  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to the wallet
   * @param permissions - Permissions to request
   * @returns Connection result with address and permissions
   */
  async connect(permissions: Permission[] = ['view_address', 'view_balance']): Promise<ConnectResult> {
    this.ensureInstalled();
    
    try {
      const result = await this.provider!.connect(permissions);
      
      this._isConnected = true;
      this._address = result.address;
      
      this.emit('connect', { address: result.address });
      
      return {
        address: result.address,
        permissions: result.permissions as Permission[],
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Disconnect from the wallet
   */
  async disconnect(): Promise<void> {
    if (!this._isConnected) {
      return;
    }
    
    try {
      await this.provider?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    
    this._isConnected = false;
    this._address = null;
    
    this.emit('disconnect');
  }

  /**
   * Get the currently connected account address
   * @throws NotConnectedError if not connected
   */
  getAccount(): string {
    this.ensureConnected();
    return this._address!;
  }

  /**
   * Get account balance
   * @param address - Optional address to query (defaults to connected account)
   */
  async getBalance(address?: string): Promise<BalanceResult> {
    this.ensureInstalled();
    this.ensureConnected();
    
    try {
      const result = await this.provider!.getBalance(address ?? this._address!);
      return {
        balance: result.balance,
        address: result.address,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Get network information
   */
  async getNetwork(): Promise<NetworkInfo> {
    this.ensureInstalled();
    
    try {
      return await this.provider!.getNetwork();
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Send a transaction
   * @param tx - Transaction request
   * @returns Transaction result with hash
   */
  async sendTransaction(tx: TransactionRequest): Promise<TransactionResult> {
    this.ensureInstalled();
    this.ensureConnected();
    this.validateTransaction(tx);
    
    try {
      const result = await this.provider!.sendTransaction({
        to: tx.to,
        amount: normalizeAmount(tx.amount),
        message: tx.message,
      });
      
      this.emit('transaction', { hash: result.hash });
      
      return { hash: result.hash };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Sign a message
   * @param message - Message to sign
   * @returns Signature result
   */
  async signMessage(message: string): Promise<SignatureResult> {
    this.ensureInstalled();
    this.ensureConnected();
    
    if (!isNonEmptyString(message)) {
      throw new ValidationError('Message cannot be empty');
    }
    
    try {
      const result = await this.provider!.signMessage(message);
      return {
        signature: result.signature,
        message,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Call a contract view method (no transaction, no approval needed)
   * @param address - Contract address
   * @param method - Method name
   * @param params - Method parameters
   */
  async callContract(address: string, method: string, params?: ContractParams): Promise<unknown> {
    this.ensureInstalled();
    this.ensureConnected();
    
    if (!isNonEmptyString(address)) {
      throw new ValidationError('Contract address is required');
    }
    if (!isNonEmptyString(method)) {
      throw new ValidationError('Method name is required');
    }
    
    try {
      return await this.provider!.callContract(address, method, params);
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Invoke a contract method (creates transaction, requires approval)
   * @param address - Contract address
   * @param method - Method name
   * @param params - Method parameters
   * @param options - Transaction options
   */
  async invokeContract(
    address: string,
    method: string,
    params?: ContractParams,
    options?: InvokeOptions
  ): Promise<ContractResult> {
    this.ensureInstalled();
    this.ensureConnected();
    
    if (!isNonEmptyString(address)) {
      throw new ValidationError('Contract address is required');
    }
    if (!isNonEmptyString(method)) {
      throw new ValidationError('Method name is required');
    }
    
    try {
      const result = await this.provider!.invokeContract(address, method, params, options);
      
      this.emit('transaction', { hash: result.hash });
      
      return {
        hash: result.hash,
        result: result.result,
      };
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param callback - Event callback
   * @returns Unsubscribe function
   */
  on<E extends EventName>(event: E, callback: EventCallback<E>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    
    (this.listeners[event] as Set<EventCallback<E>>).add(callback);
    
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param callback - Event callback to remove
   */
  off<E extends EventName>(event: E, callback: EventCallback<E>): void {
    const eventListeners = this.listeners[event] as Set<EventCallback<E>> | undefined;
    if (eventListeners) {
      eventListeners.delete(callback);
    }
  }

  // Private methods

  private emit<E extends EventName>(event: E, data?: Parameters<EventCallback<E>>[0]): void {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      eventListeners.forEach((callback) => {
        try {
          if (data !== undefined) {
            (callback as (data: unknown) => void)(data);
          } else {
            (callback as () => void)();
          }
        } catch {
          // Ignore callback errors
        }
      });
    }
  }

  private ensureInstalled(): void {
    if (!this.isInstalled()) {
      throw new NotInstalledError();
    }
  }

  private ensureConnected(): void {
    if (!this._isConnected) {
      throw new NotConnectedError();
    }
  }

  private validateTransaction(tx: TransactionRequest): void {
    if (!isNonEmptyString(tx.to)) {
      throw new ValidationError('Transaction recipient (to) is required');
    }
    if (!isValidAmount(tx.amount)) {
      throw new ValidationError('Transaction amount must be a valid positive number');
    }
  }

  private setupProviderListeners(): void {
    if (!this.provider) return;
    
    // Forward connect event
    const onConnect = (data: { address: string }) => {
      this._isConnected = true;
      this._address = data.address;
      this.emit('connect', data);
    };
    this.provider.on('connect', onConnect);
    this.providerListeners.set('connect', onConnect);
    
    // Forward disconnect event
    const onDisconnect = () => {
      this._isConnected = false;
      this._address = null;
      this.emit('disconnect');
    };
    this.provider.on('disconnect', onDisconnect);
    this.providerListeners.set('disconnect', onDisconnect);
    
    // Forward account changed event
    const onAccountChanged = (data: { address: string }) => {
      this._address = data.address;
      this.emit('accountChanged', data);
    };
    this.provider.on('accountChanged', onAccountChanged);
    this.providerListeners.set('accountChanged', onAccountChanged);
  }
}
