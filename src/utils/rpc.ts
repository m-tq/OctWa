import { RPCProvider } from '../types/wallet';

const DEFAULT_RPC_URL = 'http://46.101.86.250:8080';

function syncProvidersToExtensionStorage(providers: RPCProvider[]): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const activeProvider = providers.find((p) => p.isActive);
  const selectedNetwork = activeProvider?.network ?? 'mainnet';

  chrome.storage.local
    .set({ rpcProviders: JSON.stringify(providers), selectedNetwork })
    .catch((err) => console.warn('Failed to sync rpcProviders to chrome.storage:', err));
}

function buildDefaultProvider(): RPCProvider {
  return {
    id: 'default',
    name: 'Octra Mainnet',
    url: DEFAULT_RPC_URL,
    headers: {},
    priority: 1,
    isActive: true,
    createdAt: Date.now(),
    network: 'mainnet',
  };
}

export function getActiveRPCProvider(): RPCProvider | null {
  try {
    const providers: RPCProvider[] = JSON.parse(localStorage.getItem('rpcProviders') ?? '[]');
    const active = providers.find((p) => p.isActive);

    if (active) {
      syncProvidersToExtensionStorage(providers);
      return active;
    }
  } catch (error) {
    console.error('Error loading RPC providers:', error);
  }

  const defaultProvider = buildDefaultProvider();

  try {
    localStorage.setItem('rpcProviders', JSON.stringify([defaultProvider]));
    syncProvidersToExtensionStorage([defaultProvider]);
  } catch (error) {
    console.error('Error saving default RPC provider:', error);
  }

  return defaultProvider;
}