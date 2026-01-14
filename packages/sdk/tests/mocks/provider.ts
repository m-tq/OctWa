import type {
  OctraProvider,
  ConnectRequest,
  Connection,
  CapabilityRequest,
  Capability,
  SignedInvocation,
  InvocationResult,
} from '../../src/types';

type EventCallback = (...args: unknown[]) => void;

export interface MockProviderOptions {
  shouldRejectConnect?: boolean;
  shouldRejectCapability?: boolean;
  shouldRejectInvoke?: boolean;
  circleExists?: boolean;
  rejectMessage?: string;
}

let capabilityCounter = 0;

export function createMockProvider(options: MockProviderOptions = {}): OctraProvider & { emit: (event: string, data?: unknown) => void } {
  const eventListeners: Map<string, Set<EventCallback>> = new Map();

  const shouldRejectConnect = options.shouldRejectConnect ?? false;
  const shouldRejectCapability = options.shouldRejectCapability ?? false;
  const shouldRejectInvoke = options.shouldRejectInvoke ?? false;
  const circleExists = options.circleExists ?? true;
  const rejectMessage = options.rejectMessage ?? 'User rejected request';

  const provider: OctraProvider & { emit: (event: string, data?: unknown) => void } = {
    isOctra: true,
    version: '1.0.0-mock',

    async connect(request: ConnectRequest): Promise<Connection> {
      if (shouldRejectConnect) {
        throw new Error(rejectMessage);
      }

      if (!circleExists) {
        throw new Error('Circle does not exist');
      }

      return {
        circle: request.circle,
        sessionId: `session-${Date.now()}`,
        walletPubKey: 'mock-pub-key-' + Math.random().toString(36).slice(2),
        network: 'testnet',
      };
    },

    async disconnect(): Promise<void> {
      provider.emit('disconnect');
    },

    async requestCapability(req: CapabilityRequest): Promise<Capability> {
      if (shouldRejectCapability) {
        throw new Error(rejectMessage);
      }

      capabilityCounter++;
      const now = Date.now();

      return {
        id: `cap-${capabilityCounter}-${Date.now()}`,
        circle: req.circle,
        methods: req.methods,
        scope: req.scope,
        encrypted: req.encrypted,
        issuedAt: now,
        expiresAt: req.ttlSeconds ? now + req.ttlSeconds * 1000 : undefined,
        issuerPubKey: 'mock-issuer-pub-key',
        signature: 'mock-signature-' + Math.random().toString(36).slice(2),
      };
    },

    async invoke(call: SignedInvocation): Promise<InvocationResult> {
      if (shouldRejectInvoke) {
        throw new Error('Invocation failed');
      }

      return {
        success: true,
        data: new Uint8Array([1, 2, 3]),
      };
    },

    on(event: string, callback: EventCallback): void {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(callback);
    },

    off(event: string, callback: EventCallback): void {
      eventListeners.get(event)?.delete(callback);
    },

    emit(event: string, data?: unknown): void {
      eventListeners.get(event)?.forEach((cb) => cb(data));
    },
  };

  return provider;
}

export function injectMockProvider(provider: OctraProvider): void {
  (globalThis as Record<string, unknown>).window = (globalThis as Record<string, unknown>).window || {};
  ((globalThis as Record<string, unknown>).window as Record<string, unknown>).octra = provider;
}

export function clearMockProvider(): void {
  capabilityCounter = 0;
  if ((globalThis as Record<string, unknown>).window) {
    delete ((globalThis as Record<string, unknown>).window as Record<string, unknown>).octra;
  }
}
