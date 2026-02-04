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
} from './types';

import {
  NotInstalledError,
  NotConnectedError,
  ValidationError,
  CapabilityError,
  ScopeViolationError,
  CapabilityExpiredError,
  OriginMismatchError,
  SignatureInvalidError,
  wrapProviderError,
} from './errors';

import { SessionManager } from './session-manager';
import { CapabilityManager } from './capability-manager';
import { detectProvider, isNonEmptyString, isValidScope, getCurrentOrigin } from './utils';
import { isCapabilityExpired, isOriginValid, verifyCapabilitySignature } from './crypto';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

export class OctraSDK {
  private provider: OctraProvider | null = null;
  private sessionManager: SessionManager;
  private capabilityManager: CapabilityManager;
  private listeners: EventListeners = {};
  private providerListeners: Map<string, (...args: unknown[]) => void> = new Map();
  private currentOrigin: string;
  private skipSignatureVerification: boolean;

  private constructor(skipSignatureVerification = false) {
    this.currentOrigin = getCurrentOrigin();
    this.sessionManager = new SessionManager();
    this.capabilityManager = new CapabilityManager(this.currentOrigin);
    this.skipSignatureVerification = skipSignatureVerification;
  }

  static async init(options: InitOptions = {}): Promise<OctraSDK> {
    const sdk = new OctraSDK(options.skipSignatureVerification ?? false);
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
    if (!isNonEmptyString(request.appOrigin)) {
      throw new ValidationError('App origin is required');
    }
    try {
      const connection = await this.provider!.connect(request);
      console.log('[OctraSDK] Connection received:', {
        circle: connection.circle,
        walletPubKey: connection.walletPubKey,
        evmAddress: connection.evmAddress,
        network: connection.network
      });
      this.sessionManager.setConnection(connection);
      this.emit('connect', { connection });
      return connection;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.sessionManager.isConnected()) return;
    try {
      await this.provider?.disconnect();
    } catch { /* ignore */ }
    this.cleanupProviderListeners();
    this.sessionManager.clearConnection();
    this.capabilityManager.clearAll();
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
    if (!isValidScope(req.scope)) {
      throw new ValidationError("Scope must be 'read', 'write', or 'compute'");
    }
    try {
      const capability = await this.provider!.requestCapability(req);
      if (!this.skipSignatureVerification) {
        const signatureValid = await verifyCapabilitySignature(capability);
        if (!signatureValid) {
          throw new SignatureInvalidError(capability.id);
        }
      }
      if (!isOriginValid(capability, this.currentOrigin)) {
        throw new OriginMismatchError(capability.appOrigin, this.currentOrigin);
      }
      this.capabilityManager.addCapabilityTrusted(capability);
      this.emit('capabilityGranted', { capability });
      return capability;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  async invoke(call: InvocationRequest): Promise<InvocationResult> {
    this.ensureInstalled();
    this.ensureConnected();
    const capability = this.capabilityManager.getCapability(call.capabilityId);
    if (!capability) {
      throw new CapabilityError(`Capability '${call.capabilityId}' not found`);
    }
    if (isCapabilityExpired(capability)) {
      throw new CapabilityExpiredError(call.capabilityId, capability.expiresAt);
    }
    if (!isOriginValid(capability, this.currentOrigin)) {
      throw new OriginMismatchError(capability.appOrigin, this.currentOrigin);
    }
    if (!this.capabilityManager.isMethodAllowed(call.capabilityId, call.method)) {
      throw new ScopeViolationError(call.method, call.capabilityId);
    }
    const signedInvocation: SignedInvocation = {
      capabilityId: call.capabilityId,
      method: call.method,
      payload: call.payload,
      nonce: this.capabilityManager.getNextNonce(call.capabilityId),
      timestamp: Date.now(),
    };
    try {
      return await this.provider!.invoke(signedInvocation);
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  getSessionState(): SessionState {
    this.capabilityManager.cleanupExpired();
    return {
      connected: this.sessionManager.isConnected(),
      circle: this.sessionManager.getCircle(),
      activeCapabilities: this.capabilityManager.getActiveCapabilities(),
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
        } catch { /* ignore */ }
      });
    }
  }

  private ensureInstalled(): void {
    if (!this.isInstalled()) throw new NotInstalledError();
  }

  private ensureConnected(): void {
    if (!this.sessionManager.isConnected()) throw new NotConnectedError();
  }

  private setupProviderListeners(): void {
    if (!this.provider) return;
    const onDisconnect = () => {
      this.sessionManager.clearConnection();
      this.capabilityManager.clearAll();
      this.emit('disconnect');
    };
    this.provider.on('disconnect', onDisconnect);
    this.providerListeners.set('disconnect', onDisconnect);
  }

  private cleanupProviderListeners(): void {
    if (!this.provider) return;
    for (const [event, callback] of this.providerListeners.entries()) {
      this.provider.off(event, callback);
    }
    this.providerListeners.clear();
  }
}
