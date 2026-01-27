// Shared RPC Status Manager
// Prevents duplicate fetching between popup and expanded modes



export interface RPCStatusData {
  status: 'connected' | 'disconnected' | 'checking' | 'connecting';
  network: string;
  lastChecked: number;
  rpcUrl: string;
}

const STATUS_CACHE_KEY = 'rpcStatusCache';
const STATUS_VALID_DURATION = 3 * 60 * 1000; // 3 minutes

// Get active RPC provider info
export async function getActiveRPCProvider(): Promise<{ url: string; network: string; name: string } | null> {
  try {
    const providersJson = localStorage.getItem('rpcProviders');
    if (providersJson) {
      const providers = JSON.parse(providersJson);
      const activeProvider = providers.find((p: any) => p.isActive);
      if (activeProvider) {
        return {
          url: activeProvider.url,
          network: activeProvider.network || 'mainnet',
          name: activeProvider.name || 'Unknown'
        };
      }
    }
  } catch (e) {
    console.warn('Failed to get active RPC provider:', e);
  }
  return null;
}

// Get cached RPC status
export async function getCachedRPCStatus(): Promise<RPCStatusData | null> {
  try {
    // Try chrome.storage first (shared between popup and expanded)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STATUS_CACHE_KEY);
      if (result[STATUS_CACHE_KEY]) {
        const cached = JSON.parse(result[STATUS_CACHE_KEY]) as RPCStatusData;
        const now = Date.now();
        
        // Check if cache is still valid (within 3 minutes)
        if (now - cached.lastChecked < STATUS_VALID_DURATION) {
          // Also verify RPC URL hasn't changed
          const activeProvider = await getActiveRPCProvider();
          if (activeProvider && activeProvider.url === cached.rpcUrl) {
            return cached;
          }
        }
      }
    }
    
    // Fallback to localStorage
    const localCached = localStorage.getItem(STATUS_CACHE_KEY);
    if (localCached) {
      const cached = JSON.parse(localCached) as RPCStatusData;
      const now = Date.now();
      
      if (now - cached.lastChecked < STATUS_VALID_DURATION) {
        const activeProvider = await getActiveRPCProvider();
        if (activeProvider && activeProvider.url === cached.rpcUrl) {
          return cached;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to get cached RPC status:', e);
  }
  return null;
}

// Save RPC status to cache
export async function saveRPCStatus(data: RPCStatusData): Promise<void> {
  try {
    const json = JSON.stringify(data);
    
    // Save to localStorage
    localStorage.setItem(STATUS_CACHE_KEY, json);
    
    // Save to chrome.storage for cross-context sharing
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STATUS_CACHE_KEY]: json });
    }
  } catch (e) {
    console.warn('Failed to save RPC status:', e);
  }
}

// Check RPC status with caching
export async function checkRPCStatus(forceRefresh = false): Promise<RPCStatusData> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedRPCStatus();
    if (cached) {
      console.log('📡 Using cached RPC status:', cached.status, cached.network);
      return cached;
    }
  }
  
  // Get active provider
  const activeProvider = await getActiveRPCProvider();
  const rpcUrl = activeProvider?.url || 'https://rpc.octra.org';
  const network = activeProvider?.network || 'mainnet';
  
  const result: RPCStatusData = {
    status: 'checking',
    network,
    lastChecked: Date.now(),
    rpcUrl
  };
  
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  
  const isDevelopment = import.meta.env.DEV;
  const isExtension = typeof chrome !== 'undefined' && 
                      chrome.runtime && 
                      typeof chrome.runtime.id === 'string' &&
                      chrome.runtime.id.length > 0;
  
  let url: string;
  const headers: Record<string, string> = {};
  
  if (isExtension) {
    url = `${rpcUrl}/status`;
  } else if (isDevelopment) {
    url = '/api/status';
    headers['X-RPC-URL'] = rpcUrl;
  } else {
    url = '/rpc-proxy/status';
    headers['X-RPC-Target'] = rpcUrl;
  }
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.status === 200) {
        result.status = 'connected';
        result.lastChecked = Date.now();
        await saveRPCStatus(result);
        return result;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn(`RPC status check attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES) {
        result.status = 'connecting';
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        result.status = 'disconnected';
      }
    }
  }
  
  result.lastChecked = Date.now();
  await saveRPCStatus(result);
  return result;
}

// Listen for RPC status changes from other contexts
export function onRPCStatusChange(callback: (data: RPCStatusData) => void): () => void {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    const listener = (changes: any, areaName: string) => {
      if (areaName === 'local' && changes[STATUS_CACHE_KEY]) {
        try {
          const newData = JSON.parse(changes[STATUS_CACHE_KEY].newValue) as RPCStatusData;
          callback(newData);
        } catch {
          // Ignore parse errors
        }
      }
    };
    
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  
  // Fallback: no-op cleanup
  return () => {};
}
