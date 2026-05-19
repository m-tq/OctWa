import { RPCProvider } from '../types/wallet';
import {
  DEFAULT_OCTRA_MAINNET_URL,
  DEFAULT_OCTRA_DEVNET_URL,
} from './rpcDefaults';

/** Stale devnet URLs that must be migrated to the configured devnet URL. */
const STALE_DEVNET_URLS = ['devnet.octrascan', ':8081'];

function isStaleDevnetUrl(url: string): boolean {
  return STALE_DEVNET_URLS.some((pattern) => url.includes(pattern));
}

/**
 * Migrate any stale devnet URLs to the correct direct IP.
 * Returns the (possibly mutated) array and a flag indicating whether a save is needed.
 */
function migrateStaleUrls(providers: RPCProvider[]): { providers: RPCProvider[]; changed: boolean } {
  let changed = false;
  const migrated = providers.map((p) => {
    if (p.id === 'devnet' && isStaleDevnetUrl(p.url)) {
      changed = true;
      return { ...p, url: DEFAULT_OCTRA_DEVNET_URL };
    }
    return p;
  });
  return { providers: migrated, changed };
}

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
    url: DEFAULT_OCTRA_MAINNET_URL,
    headers: {},
    priority: 1,
    isActive: true,
    createdAt: Date.now(),
    network: 'mainnet',
  };
}

export function getActiveRPCProvider(): RPCProvider | null {
  // Web Workers don't have localStorage — return default provider silently
  if (typeof localStorage === 'undefined') {
    return buildDefaultProvider();
  }

  try {
    let providers: RPCProvider[] = JSON.parse(localStorage.getItem('rpcProviders') ?? '[]');

    // Always migrate stale devnet URLs on read so the worker always gets the correct URL
    const { providers: migrated, changed } = migrateStaleUrls(providers);
    if (changed) {
      providers = migrated;
      localStorage.setItem('rpcProviders', JSON.stringify(providers));
      syncProvidersToExtensionStorage(providers);
    }

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