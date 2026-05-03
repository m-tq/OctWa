import type {
  OctraProvider,
  ConnectRequest,
  Connection,
  CapabilityRequest,
  Capability,
  SignedInvocation,
  InvocationResult,
  GasEstimate,
  EncryptedPayload,
} from '../../src/types';

type EventCallback = (...args: unknown[]) => void;

export interface MockProviderOptions {
  shouldRejectConnect?: boolean;
  shouldRejectCapability?: boolean;
  shouldRejectInvoke?: boolean;
  rejectMessage?: string;
}

let capabilityCounter = 0;

function getCurrentOrigin(): string {
  if (typeof window !== 'undefined' && window.location) {
    try { return window.location.origin || ''; } catch { return ''; }
  }
  return '';
}

export function createMockProvider(
  options: MockProviderOptions = {}
): OctraProvider & { emit: (event: string, data?: unknown) => void } {
  const eventListeners = new Map<string, Set<EventCallback>>();

  const {
    shouldRejectConnect    = false,
    shouldRejectCapability = false,
    shouldRejectInvoke     = false,
    rejectMessage          = 'User rejected request',
  } = options;

  const provider: OctraProvider & { emit: (event: string, data?: unknown) => void } = {
    isOctra:  true,
    version:  '2.0.0-mock',

    async connect(request: ConnectRequest): Promise<Connection> {
      if (shouldRejectConnect) throw new Error(rejectMessage);
      return {
        circle:       request.circle,
        sessionId:    `session-${Date.now()}`,
        walletPubKey: 'mock-pub-key-' + Math.random().toString(36).slice(2),
        evmAddress:   '0x' + '0'.repeat(40),
        network:      'testnet',
        epoch:        0,
        branchId:     'main',
      };
    },

    async disconnect() {
      provider.emit('disconnect');
      return { disconnected: true };
    },

    async requestCapability(req: CapabilityRequest): Promise<Capability> {
      if (shouldRejectCapability) throw new Error(rejectMessage);
      capabilityCounter++;
      const now       = Date.now();
      const expiresAt = req.ttlSeconds ? now + req.ttlSeconds * 1000 : now + 3_600_000;
      return {
        id:           `cap-${capabilityCounter}-${Date.now()}`,
        version:      2,
        circle:       req.circle,
        methods:      [...req.methods].sort(),
        scope:        req.scope,
        encrypted:    req.encrypted,
        appOrigin:    getCurrentOrigin(),
        branchId:     'main',
        epoch:        0,
        issuedAt:     now,
        expiresAt,
        nonceBase:    0,
        walletPubKey: 'mock-wallet-pub-key-hex-32bytes00',
        signature:    'mock-signature-64bytes-hex-for-testing-purposes-only-not-real-sig00000000',
        state:        'ACTIVE',
        lastNonce:    0,
      };
    },

    async renewCapability(capabilityId: string): Promise<Capability> {
      const now = Date.now();
      return {
        id:           capabilityId,
        version:      2,
        circle:       'mock-circle',
        methods:      ['getData'],
        scope:        'read',
        encrypted:    false,
        appOrigin:    getCurrentOrigin(),
        branchId:     'main',
        epoch:        0,
        issuedAt:     now,
        expiresAt:    now + 900_000,
        nonceBase:    0,
        walletPubKey: 'mock-wallet-pub-key-hex-32bytes00',
        signature:    'mock-signature-renewed-00000000000000000000000000000000000000000000000000000000',
        state:        'ACTIVE',
        lastNonce:    0,
      };
    },

    async revokeCapability(_capabilityId: string): Promise<void> {
      // no-op in mock
    },

    async listCapabilities(): Promise<Capability[]> {
      return [];
    },

    async invoke(_call: SignedInvocation): Promise<InvocationResult> {
      if (shouldRejectInvoke) throw new Error('Invocation failed');
      return { success: true, data: new Uint8Array([1, 2, 3]) };
    },

    async estimatePlainTx(_payload: unknown): Promise<GasEstimate> {
      return { gasUnits: 1000, tokenCost: 0.001, latencyEstimate: 2000, epoch: 0 };
    },

    async estimateEncryptedTx(_payload: EncryptedPayload): Promise<GasEstimate> {
      return { gasUnits: 30000, tokenCost: 0.03, latencyEstimate: 4000, epoch: 0 };
    },

    async signMessage(message: string): Promise<string> {
      return `mock-sig-${message.slice(0, 8)}`;
    },

    on(event: string, callback: EventCallback): void {
      if (!eventListeners.has(event)) eventListeners.set(event, new Set());
      eventListeners.get(event)!.add(callback);
    },

    off(event: string, callback: EventCallback): void {
      eventListeners.get(event)?.delete(callback);
    },

    emit(event: string, data?: unknown): void {
      eventListeners.get(event)?.forEach(cb => cb(data));
    },
  };

  return provider;
}

export function injectMockProvider(provider: OctraProvider): void {
  const g = globalThis as Record<string, unknown>;
  g.window = g.window || {};
  (g.window as Record<string, unknown>).octra = provider;
}

export function clearMockProvider(): void {
  capabilityCounter = 0;
  const g = globalThis as Record<string, unknown>;
  if (g.window) delete (g.window as Record<string, unknown>).octra;
}
