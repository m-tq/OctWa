// Shared RPC Status Manager
// Prevents duplicate fetching between popup and expanded modes

interface RPCStatusData {
  status: 'connected' | 'disconnected' | 'checking' | 'connecting';
  network: string;
  lastChecked: number;
  rpcUrl: string;
  latestEpoch?: number;
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
async function getCachedRPCStatus(): Promise<RPCStatusData | null> {
  try {
    // Try chrome.storage first (shared between popup and expanded)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STATUS_CACHE_KEY);
      if (result[STATUS_CACHE_KEY]) {
        const cached = JSON.parse(result[STATUS_CACHE_KEY]) as RPCStatusData;
        const now = Date.now();
        if (now - cached.lastChecked < STATUS_VALID_DURATION) {
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
async function saveRPCStatus(data: RPCStatusData): Promise<void> {
  try {
    const json = JSON.stringify(data);
    localStorage.setItem(STATUS_CACHE_KEY, json);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STATUS_CACHE_KEY]: json });
    }
  } catch (e) {
    console.warn('Failed to save RPC status:', e);
  }
}

// Call node_stats via JSON-RPC to check connectivity and get latest epoch
async function callNodeStats(rpcUrl: string): Promise<{ ok: boolean; latestEpoch?: number }> {
  const isDevelopment = import.meta.env.DEV;
  const isExtension =
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.id.length > 0;

  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isExtension) {
    url = `${rpcUrl.replace(/\/$/, '')}/rpc`;
  } else if (isDevelopment) {
    url = '/api/rpc';
    headers['X-RPC-URL'] = rpcUrl;
  } else {
    url = '/rpc-proxy/rpc';
    headers['X-RPC-Target'] = rpcUrl;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'node_stats', params: [] }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) return { ok: false };

  const json = await response.json();
  if (json.error || !json.result) return { ok: false };

  const latestEpochs: number[] = json.result.latest_epochs || [];
  const latestEpoch = latestEpochs.length > 0 ? latestEpochs[0] : undefined;

  return { ok: true, latestEpoch };
}

// Check RPC status with caching
export async function checkRPCStatus(forceRefresh = false): Promise<RPCStatusData> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedRPCStatus();
    if (cached) return cached;
  }

  // Get active provider
  const activeProvider = await getActiveRPCProvider();
  const rpcUrl = activeProvider?.url || 'http://46.101.86.250:8080';
  const network = activeProvider?.network || 'mainnet';

  const result: RPCStatusData = {
    status: 'checking',
    network,
    lastChecked: Date.now(),
    rpcUrl,
  };

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { ok, latestEpoch } = await callNodeStats(rpcUrl);
      if (ok) {
        result.status = 'connected';
        result.latestEpoch = latestEpoch;
        result.lastChecked = Date.now();
        await saveRPCStatus(result);
        return result;
      }
      throw new Error('node_stats returned error');
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

// Fetch only the latest epoch (lightweight, no cache invalidation)
export async function fetchLatestEpoch(rpcUrl: string): Promise<number | null> {
  try {
    const { latestEpoch } = await callNodeStats(rpcUrl);
    return latestEpoch ?? null;
  } catch {
    return null;
  }
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
  return () => {};
}
