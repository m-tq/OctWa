import { RPCProvider } from '../types/wallet';

// Sync rpcProviders and selectedNetwork to chrome.storage.local for background script access
function syncToExtensionStorage(providers: RPCProvider[]) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const activeProvider = providers.find(p => p.isActive);
    const selectedNetwork = activeProvider?.network || 'mainnet';
    
    chrome.storage.local.set({ 
      rpcProviders: JSON.stringify(providers),
      selectedNetwork 
    }).catch(err => {
      console.warn('Failed to sync rpcProviders to chrome.storage:', err);
    });
  }
}

export function getActiveRPCProvider(): RPCProvider | null {
  try {
    const providers = JSON.parse(localStorage.getItem('rpcProviders') || '[]');
    const activeProvider = providers.find((p: RPCProvider) => p.isActive);
    
    if (activeProvider) {
      // Sync to chrome.storage.local for background script access
      syncToExtensionStorage(providers);
      return activeProvider;
    }
  } catch (error) {
    console.error('Error loading RPC providers:', error);
  }
  
  // Return default if no active provider
  const defaultProvider: RPCProvider = {
    id: 'default',
    name: 'Octra Network (Default)',
    url: 'https://octra.network',
    headers: {},
    priority: 1,
    isActive: true,
    createdAt: Date.now(),
    network: 'mainnet'
  };
  
  // Save default provider if none exists
  try {
    localStorage.setItem('rpcProviders', JSON.stringify([defaultProvider]));
    // Also sync to chrome.storage.local
    syncToExtensionStorage([defaultProvider]);
  } catch (error) {
    console.error('Error saving default RPC provider:', error);
  }
  
  return defaultProvider;
}

export async function makeRPCRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const provider = getActiveRPCProvider();
  
  if (!provider) {
    throw new Error('No RPC provider available');
  }
  
  // Construct full URL
  const url = `${provider.url}${endpoint}`;
  
  // Merge headers
  const headers = {
    'Content-Type': 'application/json',
    ...provider.headers,
    ...options.headers
  };
  
  return fetch(url, {
    ...options,
    headers
  });
}