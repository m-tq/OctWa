import type { OctraProvider } from '../../src/types';

type EventCallback = (...args: unknown[]) => void;

export interface MockProviderOptions {
  isConnected?: boolean;
  selectedAddress?: string | null;
  shouldReject?: boolean;
  rejectMessage?: string;
}

export function createMockProvider(options: MockProviderOptions = {}): OctraProvider {
  const eventListeners: Map<string, Set<EventCallback>> = new Map();
  
  let isConnected = options.isConnected ?? false;
  let selectedAddress = options.selectedAddress ?? null;
  const shouldReject = options.shouldReject ?? false;
  const rejectMessage = options.rejectMessage ?? 'User rejected request';
  
  const provider: OctraProvider = {
    isOctra: true,
    isConnected,
    selectedAddress,
    networkId: 'octra-testnet',
    chainId: '0x1',
    version: '1.0.0',
    
    async connect(permissions = []) {
      if (shouldReject) {
        throw new Error(rejectMessage);
      }
      isConnected = true;
      selectedAddress = 'oct1mock_address_123';
      provider.isConnected = true;
      provider.selectedAddress = selectedAddress;
      return { address: selectedAddress, permissions };
    },
    
    async disconnect() {
      isConnected = false;
      selectedAddress = null;
      provider.isConnected = false;
      provider.selectedAddress = null;
    },
    
    async getAccount() {
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return selectedAddress!;
    },
    
    async getBalance(address) {
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return { balance: 1000000, address: address ?? selectedAddress! };
    },
    
    async getNetwork() {
      return {
        chainId: '0x1',
        networkId: 'octra-testnet',
        name: 'Octra Testnet'
      };
    },
    
    async sendTransaction(tx) {
      if (shouldReject) {
        throw new Error(rejectMessage);
      }
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return { hash: 'tx_mock_hash_' + Date.now() };
    },
    
    async signMessage(message) {
      if (shouldReject) {
        throw new Error(rejectMessage);
      }
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return { signature: 'sig_mock_' + Buffer.from(message).toString('hex').slice(0, 16) };
    },
    
    async callContract(address, method, params) {
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return { result: 'mock_view_result', method, params };
    },
    
    async invokeContract(address, method, params, options) {
      if (shouldReject) {
        throw new Error(rejectMessage);
      }
      if (!isConnected) {
        throw new Error('Not connected');
      }
      return { hash: 'contract_tx_' + Date.now(), result: { success: true } };
    },
    
    on(event, callback) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(callback);
    },
    
    off(event, callback) {
      eventListeners.get(event)?.delete(callback);
    }
  };
  
  // Helper to emit events for testing
  (provider as any).emit = (event: string, data?: unknown) => {
    eventListeners.get(event)?.forEach(cb => cb(data));
  };
  
  return provider;
}

export function injectMockProvider(provider: OctraProvider): void {
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.octra = provider;
}

export function clearMockProvider(): void {
  if ((globalThis as any).window) {
    delete (globalThis as any).window.octra;
  }
}
