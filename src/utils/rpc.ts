import { RPCProvider } from '../types/wallet';

export function getActiveRPCProvider(): RPCProvider | null {
  try {
    const providers = JSON.parse(localStorage.getItem('rpcProviders') || '[]');
    const activeProvider = providers.find((p: RPCProvider) => p.isActive);
    
    if (activeProvider) {
      // console.log('Using RPC provider:', activeProvider.name, activeProvider.url);
      return activeProvider;
    }
  } catch (error) {
    console.error('Error loading RPC providers:', error);
  }
  
  // console.log('No active RPC provider found, using default');
  
  // Return default if no active provider
  const defaultProvider = {
    id: 'default',
    name: 'Octra Network (Default)',
    url: 'https://octra.network',
    headers: {},
    priority: 1,
    isActive: true,
    createdAt: Date.now()
  };
  
  // Save default provider if none exists
  try {
    localStorage.setItem('rpcProviders', JSON.stringify([defaultProvider]));
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