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
  CapabilityScope,
} from './types';

import {
  NotInstalledError,
  NotConnectedError,
  ValidationError,
  CapabilityError,
  ScopeViolationError,
  wrapProviderError,
} from './errors';

import { SessionManager } from './session-manager';
import { CapabilityManager } from './capability-manager';
import { detectProvider, isNonEmptyString, isValidScope } from './utils';

type EventListeners = {
  [E in EventName]?: Set<EventCallback<E>>;
};

/**
 * Octra Web Wallet SDK
 * 
 * Implements capability-based authorization model.
 * Does NOT follow EVM/MetaMask patterns.
 * 
 * Public API (5 methods only):
 * - connect(request): Establish connection to a Circle
 * - disconnect(): End connection and clear state
 * - requestCapability(req): Request scoped authorization
 * - invoke(call): Execute method with capability
 * - getSessionState(): Get current session state
 */
export class OctraSDK {
  private provider: OctraProvider | null = null;
  private sessionManager: SessionManager;
  private capabilityManager: CapabilityManager;
  private listeners: EventListeners = {};
  private providerListeners: Map<string, (...args: unknown[]) => void> = new Map();

  private constructor() {
    this.sessionManager = new SessionManager();
    this.capabilityManager = new CapabilityManager();
  }

  /**
   * Initialize the SDK and wait for provider detection
   */
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

  /**
   * Check if the Octra Wallet extension is installed
   */
  isInstalled(): boolean {
    return this.provider !== null && this.provider.isOctra === true;
  }


  // ==========================================================================
  // PUBLIC API - 5 Methods Only
  // ==========================================================================

  /**
   * Connect to a Circle (NO signing popup)
   * Creates connection context without granting any authority
   */
  async connect(request: ConnectRequest): Promise<Connection> {
    this.ensureInstalled();

    // Validate circle ID
    if (!isNonEmptyString(request.circle)) {
      throw new ValidationError('Circle ID is required');
    }

    // Validate appOrigin
    if (!isNonEmptyString(request.appOrigin)) {
      throw new ValidationError('App origin is required');
    }

    try {
      const connection = await this.provider!.connect(request);

      this.sessionManager.setConnection(connection);
      this.emit('connect', { connection });

      return connection;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Disconnect from the Circle
   * Clears all session state and capabilities
   */
  async disconnect(): Promise<void> {
    if (!this.sessionManager.isConnected()) {
      return;
    }

    try {
      await this.provider?.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.sessionManager.clearConnection();
    this.capabilityManager.clearAll();

    this.emit('disconnect');
  }

  /**
   * Request a capability from the user
   * Returns scoped, signed authorization
   */
  async requestCapability(req: CapabilityRequest): Promise<Capability> {
    this.ensureInstalled();
    this.ensureConnected();

    // Validate request
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

      this.capabilityManager.addCapability(capability);
      this.emit('capabilityGranted', { capability });

      return capability;
    } catch (error) {
      throw wrapProviderError(error);
    }
  }

  /**
   * Invoke a method using a capability
   * Creates signed invocation with nonce and timestamp
   */
  async invoke(call: InvocationRequest): Promise<InvocationResult> {
    this.ensureInstalled();
    this.ensureConnected();

    // Validate capability exists and is valid
    if (!this.capabilityManager.isCapabilityValid(call.capabilityId)) {
      throw new CapabilityError(`Capability '${call.capabilityId}' is invalid or expired`);
    }

    // Validate method is in scope
    if (!this.capabilityManager.isMethodAllowed(call.capabilityId, call.method)) {
      throw new ScopeViolationError(call.method, call.capabilityId);
    }

    // Build signed invocation
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

  /**
   * Get current session state
   * Returns connection status and active capabilities
   */
  getSessionState(): SessionState {
    // Cleanup expired capabilities first
    this.capabilityManager.cleanupExpired();

    return {
      connected: this.sessionManager.isConnected(),
      circle: this.sessionManager.getCircle(),
      activeCapabilities: this.capabilityManager.getActiveCapabilities(),
    };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to an event
   */
  on<E extends EventName>(event: E, callback: EventCallback<E>): () => void {
    if (!this.listeners[event]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.listeners[event] = new Set() as any;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.listeners[event] as Set<any>).add(callback);

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   */
  off<E extends EventName>(event: E, callback: EventCallback<E>): void {
    const eventListeners = this.listeners[event] as Set<EventCallback<E>> | undefined;
    if (eventListeners) {
      eventListeners.delete(callback);
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

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
    if (!this.sessionManager.isConnected()) {
      throw new NotConnectedError();
    }
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
}
