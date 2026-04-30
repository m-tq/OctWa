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
} from './types';

import {
  NotInstalledError,
  NotConnectedError,
  ValidationError,
  wrapProviderError,
} from './errors';

import { NonceManager }      from './nonce-manager';
import { CapabilityService } from './capability-service';
import { GasService }        from './gas-service';
import { domainSeparator }   from './crypto';
import { detectProvider, isNonEmptyString, isValidScope, getCurrentOrigin } from './utils';
import { hashPayload }       from './canonical';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

export class OctraSDK {
  private provider: OctraProvider | null = null;
  private connection: Connection | null = null;
  private nonceManager: NonceManager;
  private capabilityService: CapabilityService;
  private gasService: GasService;
  private listeners: EventListeners = {};
  private currentOrigin: string;
  private signingMutex: Promise<void> = Promise.resolve();

  private constructor() {
    this.currentOrigin      = getCurrentOrigin();
    this.nonceManager       = new NonceManager();
    this.capabilityService  = new CapabilityService();
    this.gasService         = new GasService();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  static async init(options: InitOptions = {}): Promise<OctraSDK> {
    const sdk     = new OctraSDK();
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

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(request: ConnectRequest): Promise<Connection> {
    this.ensureInstalled();

    if (!isNonEmptyString(request.circle)) {
      throw new ValidationError('Circle ID is required');
    }
    if (!isNonEmptyString(request.appOrigin)) {
      throw new ValidationError('appOrigin is required');
    }

    const fullRequest: ConnectRequest = {
      ...request,
      appOrigin: request.appOrigin || this.currentOrigin,
    };

    try {
      const connection = await this.provider!.connect(fullRequest);
      this.connection  = connection;
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

  // ── Capabilities ───────────────────────────────────────────────────────────

  async requestCapability(req: CapabilityRequest): Promise<Capability> {
    this.ensureInstalled();
    this.ensureConnected();

    if (!isNonEmptyString(req.circle)) {
      throw new ValidationError('Circle ID is required');
    }
    if (!req.methods || req.methods.length === 0) {
      throw new ValidationError('At least one method is required');
    }
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

  // ── Invocation ─────────────────────────────────────────────────────────────

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    this.ensureInstalled();
    this.ensureConnected();

    this.capabilityService.validate(req.capabilityId);

    if (!this.capabilityService.isMethodAllowed(req.capabilityId, req.method)) {
      const { ScopeViolationError } = await import('./errors');
      throw new ScopeViolationError(req.method, req.capabilityId);
    }

    // SECURITY: Signing mutex prevents parallel signing / double-send
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

      // Serialize payload for transport
      let transportPayload: SignedInvocation['payload'];
      if (req.payload instanceof Uint8Array) {
        transportPayload = { _type: 'Uint8Array', data: Array.from(req.payload) };
      } else if (req.payload && 'data' in req.payload) {
        transportPayload = { _type: 'Uint8Array', data: Array.from((req.payload as EncryptedPayload).data) };
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
        // Rollback nonce on failure
        this.nonceManager.resetNonce(req.capabilityId, nonce - 1);
        throw wrapProviderError(error);
      }
    });
  }

  // ── Fee Estimation ─────────────────────────────────────────────────────────

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

  // ── Session ────────────────────────────────────────────────────────────────

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

  // ── Events ─────────────────────────────────────────────────────────────────

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

  // ── Internal ───────────────────────────────────────────────────────────────

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

  /**
   * Acquire signing lock to prevent parallel signing / double-send.
   */
  private async withSigningLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.signingMutex;
    let release!: () => void;
    this.signingMutex = new Promise(r => { release = r; });
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
