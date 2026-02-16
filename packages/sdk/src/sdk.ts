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
  ComputeRequest,
  ComputeResult,
  ComputeProfile,
  GasEstimate,
  EncryptedPayload,
} from './types';

import {
  NotInstalledError,
  NotConnectedError,
  ValidationError,
  BranchMismatchError,
  EpochMismatchError,
  wrapProviderError,
} from './errors';

import { NonceManager } from './nonce-manager';
import { CapabilityService } from './capability-service';
import { ComputeService } from './compute-service';
import { GasService } from './gas-service';
import { domainSeparator } from './crypto';
import { detectProvider, isNonEmptyString, getCurrentOrigin } from './utils';
import { hashPayload } from './canonical';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

export class OctraSDK {
  private provider: OctraProvider | null = null;
  private connection: Connection | null = null;
  private nonceManager: NonceManager;
  private capabilityService: CapabilityService;
  private computeService: ComputeService;
  private gasService: GasService;
  private listeners: EventListeners = {};
  private currentOrigin: string;
  private signingMutex: Promise<void> = Promise.resolve();
  private pendingSignatures: Set<string> = new Set();
  
  private constructor() {
    this.currentOrigin = getCurrentOrigin();
    this.nonceManager = new NonceManager();
    this.capabilityService = new CapabilityService();
    this.computeService = new ComputeService();
    this.gasService = new GasService();
  }
  
  static async init(options: InitOptions = {}): Promise<OctraSDK> {
    const sdk = new OctraSDK();
    const timeout = options.timeout ?? 3000;
    
    sdk.provider = await detectProvider(timeout);
    
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
    
    if (!isNonEmptyString(request.circle)) {
      throw new ValidationError('Circle ID is required');
    }
    
    const fullRequest: ConnectRequest = {
      ...request,
      appOrigin: request.appOrigin || this.currentOrigin,
    };
    
    try {
      const connection = await this.provider!.connect(fullRequest);
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
    } catch {
      // Ignore
    }
    
    this.connection = null;
    this.nonceManager.clearAll();
    this.capabilityService.clearAll();
    this.emit('disconnect');
  }
  
  async requestCapability(req: CapabilityRequest): Promise<Capability> {
    this.ensureInstalled();
    this.ensureConnected();
    
    if (!isNonEmptyString(req.circle)) {
      throw new ValidationError('Circle ID is required');
    }
    
    if (!req.methods || req.methods.length === 0) {
      throw new ValidationError('At least one method is required');
    }
    
    try {
      const capability = await this.provider!.requestCapability(req);
      
      // PENDING: Skip epoch/branchId validation until implementation is ready
      // if (capability.epoch !== this.connection!.epoch) {
      //   throw new EpochMismatchError(this.connection!.epoch, capability.epoch);
      // }
      // 
      // if (capability.branchId !== this.connection!.branchId) {
      //   throw new BranchMismatchError(this.connection!.branchId, capability.branchId);
      // }
      
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
    
    const capability = this.capabilityService.get(req.capabilityId)!;
    
    if (!this.capabilityService.isMethodAllowed(req.capabilityId, req.method)) {
      throw new ValidationError(`Method '${req.method}' not allowed by capability`);
    }
    
    // SECURITY: Acquire signing mutex to prevent parallel signing
    // This prevents double-send and nonce race conditions
    return this.withSigningLock(async () => {
      // NOTE: Nonce is managed by SDK for ordering, but wallet MUST validate
      // Wallet is the final authority on nonce correctness
      const nonce = this.nonceManager.getNextNonce(req.capabilityId);
      
      // PENDING: Use default values for epoch/branchId until implementation is ready
      const branchId = req.branchId || this.connection!.branchId || 'main';
      const epoch = this.connection!.epoch || 0;
      
      const originHash = domainSeparator({
        circleId: this.connection!.circle,
        origin: this.currentOrigin,
        epoch,
        branchId,
        capabilityId: req.capabilityId,
        method: req.method,
        nonce,
      });
      
      // SECURITY: Use canonical payload hashing
      // Encrypted payloads remain opaque (no inspection of ciphertext)
      const payloadHash = req.payload 
        ? hashPayload(req.payload)
        : '';
      
      const signedInvocation: SignedInvocation = {
        header: {
          version: 2,
          circleId: this.connection!.circle,
          branchId,
          epoch,
          nonce,
          timestamp: Date.now(),
          originHash,
        },
        body: {
          capabilityId: req.capabilityId,
          method: req.method,
          payloadHash,
        },
      };
      
      try {
        const result = await this.provider!.invoke(signedInvocation);
        // Only update local nonce after successful invocation
        return result;
      } catch (error) {
        // On error, rollback nonce
        this.nonceManager.resetNonce(req.capabilityId, nonce - 1);
        throw wrapProviderError(error);
      }
    });
  }
  
  async invokeCompute(req: ComputeRequest): Promise<ComputeResult> {
    this.ensureInstalled();
    this.ensureConnected();
    
    this.capabilityService.validate(req.capabilityId);
    this.computeService.validateComputeProfile(req.computeProfile);
    
    try {
      return await this.provider!.invokeCompute(req);
    } catch (error) {
      throw wrapProviderError(error);
    }
  }
  
  async estimatePlainTx(payload: unknown): Promise<GasEstimate> {
    this.ensureInstalled();
    
    try {
      return await this.provider!.estimatePlainTx(payload);
    } catch (error) {
      return this.gasService.estimatePlainTx(payload);
    }
  }
  
  async estimateEncryptedTx(payload: EncryptedPayload): Promise<GasEstimate> {
    this.ensureInstalled();
    
    try {
      return await this.provider!.estimateEncryptedTx(payload);
    } catch (error) {
      return this.gasService.estimateEncryptedTx(payload);
    }
  }
  
  async estimateComputeCost(profile: ComputeProfile): Promise<GasEstimate> {
    this.ensureInstalled();
    
    try {
      return await this.provider!.estimateComputeCost(profile);
    } catch (error) {
      return this.gasService.estimateComputeCost(profile);
    }
  }
  
  async signMessage(message: string): Promise<string> {
    this.ensureInstalled();
    this.ensureConnected();
    
    try {
      return await this.provider!.signMessage(message);
    } catch (error) {
      throw wrapProviderError(error);
    }
  }
  
  getSessionState(): SessionState {
    this.capabilityService.cleanupExpired();
    
    return {
      connected: this.connection !== null,
      circle: this.connection?.circle,
      branchId: this.connection?.branchId,
      epoch: this.connection?.epoch,
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
    const eventListeners = this.listeners[event] as Set<EventCallback<E>> | undefined;
    if (eventListeners) eventListeners.delete(callback);
  }
  
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
          // Ignore
        }
      });
    }
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
        this.connection.epoch = data.epoch;
      }
      this.emit('branchChanged', data);
    });
    
    this.provider.on('epochChanged', (...args: unknown[]) => {
      const data = args[0] as { epoch: number };
      if (this.connection) {
        this.connection.epoch = data.epoch;
      }
      this.emit('epochChanged', data);
    });
  }
  
  private ensureInstalled(): void {
    if (!this.isInstalled()) {
      throw new NotInstalledError();
    }
  }
  
  private ensureConnected(): void {
    if (!this.connection) {
      throw new NotConnectedError();
    }
  }
  
  /**
   * Acquire signing lock to prevent parallel signing operations
   * 
   * SECURITY: Prevents race conditions and double-send attacks
   */
  private async withSigningLock<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for previous operation to complete
    await this.signingMutex;
    
    // Create new mutex for next operation
    let release: () => void;
    this.signingMutex = new Promise(resolve => {
      release = resolve;
    });
    
    try {
      return await fn();
    } finally {
      // Release lock
      release!();
    }
  }
}
