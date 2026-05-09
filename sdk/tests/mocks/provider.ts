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
  CryptoIdentity,
  SharedSecretResult,
  CipherDecryptResult,
  CipherEncryptResult,
  RawStealthOutput,
  ScanOutputsResult,
  ZkSignInput,
  ZkSignResult,
  PvacProgressCallback,
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
        circle:         request.circle,
        sessionId:      `session-${Date.now()}`,
        walletPubKey:   'mock-pub-key-' + Math.random().toString(36).slice(2),
        address:        'oct' + 'mock'.padEnd(48, '0'),
        evmAddress:     '0x' + '0'.repeat(40),
        evmNetworkId:   'eth-mainnet',
        network:        'devnet',
        epoch:          0,
        branchId:       'main',
        viewPublicKey:  btoa('mock-curve25519-view-pubkey-32b'),
        pvacRegistered: false,
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

      const m = _call.body.method;
      const payload = _call.payload as { _type?: string; data?: number[] } | undefined;
      const parsed = payload && payload._type === 'Uint8Array' && Array.isArray(payload.data)
        ? (() => {
            try { return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.data!))); }
            catch { return null; }
          })()
        : null;

      const jsonResult = (obj: unknown): InvocationResult => ({
        success: true,
        data:    new TextEncoder().encode(JSON.stringify(obj)),
      });

      switch (m) {
        case 'get_transaction':
          return jsonResult({
            hash:       parsed?.hash ?? 'mockhash',
            from:       'oct_sender',
            to:         'oct_recipient',
            amountRaw:  '1000000',
            opType:     'standard',
            nonce:      1,
            ou:         '10000',
            timestamp:  Date.now() / 1000,
            status:     'confirmed',
            epoch:      42,
          });
        case 'get_epoch':
          return jsonResult({ epochId: 42, rootCount: 7 });
        case 'get_recommended_fee':
          return jsonResult({ minimum: '1000', base: '1000', recommended: '10000', fast: '30000' });
        case 'get_contract_storage':
          return jsonResult({ value: 'mock-stored-value' });
        case 'contract_call_view':
          return jsonResult({ result: 'mock-view-result' });
        case 'get_view_pubkey':
          return jsonResult({ viewPubkey: btoa('mock-view-pubkey-for-counterparty-32') });
        case 'get_stealth_outputs':
          return jsonResult({ outputs: [] });
        case 'get_balance':
          return jsonResult({
            octAddress:       'oct_mock_addr',
            octBalance:       12.5,
            encryptedBalance: 0,
            cipher:           'hfhe_v1|mock-cipher',
            hasPvacPubkey:    true,
            network:          'devnet',
          });
        default:
          return { success: true, data: new Uint8Array([1, 2, 3]) };
      }
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

    // ── PVAC / HFHE Crypto (Phase 7) ──────────────────────────────────────────

    async getCryptoIdentity(): Promise<CryptoIdentity> {
      return {
        ed25519PublicKey: 'mock-ed25519-pubkey-hex-64chars00000000000000000000000000000000',
        viewPublicKey:    btoa('mock-curve25519-view-pubkey-32b'),
        pvacRegistered:   false,
        currentCipher:    '0',
      };
    },

    async computeSharedSecret(theirViewPubkey: string): Promise<SharedSecretResult> {
      return {
        sharedSecret: btoa('mock-shared-secret-32bytes000000'),
        stealthTag:   'deadbeefcafebabe0102030405060708',
        claimSecret:  btoa('mock-claim-secret-32bytes0000000'),
      };
    },

    async decryptCipher(cipher: string): Promise<CipherDecryptResult> {
      return {
        valueRaw: 1_000_000n,
        valueOct: 1.0,
      };
    },

    async encryptValue(valueRaw: bigint): Promise<CipherEncryptResult> {
      return {
        cipher: `hfhe_v1|mock-cipher-${valueRaw.toString()}`,
      };
    },

    async scanOutputs(
      outputs: RawStealthOutput[],
      _onProgress?: PvacProgressCallback,
    ): Promise<ScanOutputsResult> {
      return {
        outputs:      [],
        totalScanned: outputs.length,
        matched:      0,
      };
    },

    async signForZK(input: ZkSignInput): Promise<ZkSignResult> {
      const dataHex = Array.from(input.data)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return {
        signature: 'mock-zk-signature-' + dataHex.slice(0, 16),
        publicKey: 'mock-ed25519-pubkey-hex-64chars00000000000000000000000000000000',
        dataHash:  'mock-sha256-' + dataHex.slice(0, 20),
      };
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
