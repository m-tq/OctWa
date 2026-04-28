// api.ts
import {
  BalanceResponse,
  Transaction,
  AddressHistoryResponse,
  TransactionDetails,
  PendingTransaction,
  EncryptedBalanceResponse,
  PendingPrivateTransfer,
  PrivateTransferResult,
  ClaimResult,
  TransactionHistoryItem,
} from '../types/wallet';
import { getActiveRPCProvider } from './rpc';
import * as nacl from 'tweetnacl';

const MU_FACTOR = 1_000_000;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second base delay
const RETRY_BACKOFF_MULTIPLIER = 2; // Exponential backoff

// ============================================
// PERSISTENT EPOCH-BASED CACHING SYSTEM
// ============================================
// Uses chrome.storage.local for persistent cache that syncs between popup/expanded
// Cache is invalidated when epoch changes (transaction processed)
// TTL is fallback if epoch check fails

const EPOCH_CHECK_INTERVAL = 5 * 1000; // Check epoch every 5 seconds
const CACHE_STORAGE_KEY = 'octwa_api_cache';

interface CacheEntry<T> {
  data: T;
  epoch: number;
  timestamp: number;
}

interface CacheStorage {
  balance: Record<string, CacheEntry<BalanceResponse>>;
  encryptedBalance: Record<string, CacheEntry<EncryptedBalanceResponse>>;
  history: Record<string, CacheEntry<any>>;
  pendingTransfers: Record<string, CacheEntry<PendingPrivateTransfer[]>>;
  transactionDetails: Record<string, CacheEntry<TransactionDetails>>; // Cache by tx hash
  currentEpoch: number;
  lastEpochCheck: number;
}

// Check if we're in extension context
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && 
         chrome.storage && 
         typeof chrome.storage.local !== 'undefined';
}

// Get a short network identifier from the active RPC URL
// Used to namespace cache keys so mainnet/devnet have separate buckets
function getNetworkCacheKey(): string {
  try {
    const providers = JSON.parse(localStorage.getItem('rpcProviders') || '[]');
    const active = providers.find((p: any) => p.isActive);
    if (active?.url) {
      const url = (active.url as string).replace(/\/$/, '').toLowerCase();
      if (url.includes('devnet')) return 'devnet';
      const host = url.replace(/https?:\/\//, '').split('/')[0].split(':')[0];
      return host.replace(/\./g, '_');
    }
  } catch { /* ignore */ }
  return 'mainnet';
}

// Prefix address with network key so each RPC has its own cache bucket
function netKey(address: string): string {
  return `${getNetworkCacheKey()}:${address}`;
}

class APICache {
  // In-memory cache for non-extension context (dev mode)
  private memoryCache: CacheStorage = {
    balance: {},
    encryptedBalance: {},
    history: {},
    pendingTransfers: {},
    transactionDetails: {},
    currentEpoch: 0,
    lastEpochCheck: 0
  };

  // Epoch tracking
  private currentEpoch: number = 0;
  private lastEpochCheck: number = 0;
  private epochCheckPromise: Promise<number> | null = null;

  constructor() {
    // Load cache from storage on init
    this.loadFromStorage();
    
    // Listen for storage changes (sync between popup/expanded)
    if (isExtensionContext()) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[CACHE_STORAGE_KEY]) {
          const newValue = changes[CACHE_STORAGE_KEY].newValue as CacheStorage;
          if (newValue) {
            this.memoryCache = newValue;
            this.currentEpoch = newValue.currentEpoch || 0;
            this.lastEpochCheck = newValue.lastEpochCheck || 0;
            
          }
        }
      });
    }
  }

  // Load cache from chrome.storage.local
  private async loadFromStorage(): Promise<void> {
    if (!isExtensionContext()) return;
    
    try {
      const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
      if (result[CACHE_STORAGE_KEY]) {
        this.memoryCache = result[CACHE_STORAGE_KEY];
        this.currentEpoch = this.memoryCache.currentEpoch || 0;
        this.lastEpochCheck = this.memoryCache.lastEpochCheck || 0;
        
      }
    } catch (error) {
      console.warn('📦 Failed to load cache from storage:', error);
    }
  }

  // Save cache to chrome.storage.local
  private async saveToStorage(): Promise<void> {
    if (!isExtensionContext()) return;
    
    try {
      this.memoryCache.currentEpoch = this.currentEpoch;
      this.memoryCache.lastEpochCheck = this.lastEpochCheck;
      await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: this.memoryCache });
    } catch (error) {
      console.warn('📦 Failed to save cache to storage:', error);
    }
  }

  // Get current epoch with caching
  async getCurrentEpoch(): Promise<number> {
    const now = Date.now();

    // Return cached epoch if recently checked
    if (now - this.lastEpochCheck < EPOCH_CHECK_INTERVAL && this.currentEpoch > 0) {
      return this.currentEpoch;
    }

    // Prevent multiple simultaneous epoch fetches
    if (this.epochCheckPromise) {
      return this.epochCheckPromise;
    }

    this.epochCheckPromise = this.fetchEpoch();
    try {
      const epoch = await this.epochCheckPromise;
      return epoch;
    } finally {
      this.epochCheckPromise = null;
    }
  }

  private async fetchEpoch(): Promise<number> {
    try {
      const response = await makeAPIRequest('/rpc', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'node_stats', params: [] }),
      });
      if (response.ok) {
        const data = await response.json();
        const epochs: number[] = data?.result?.latest_epochs || [];
        const newEpoch = epochs.length > 0 ? epochs[0] : 0;
        this.currentEpoch = newEpoch;
        this.lastEpochCheck = Date.now();
        await this.saveToStorage();
        return newEpoch;
      }
    } catch (error) {
      console.warn('📦 Failed to fetch epoch:', error);
    }
    return this.currentEpoch || 0;
  }

  // Check if cache entry is valid with TTL fallback
  // FIX #2: Added TTL fallback to prevent stale cache when epoch check fails
  private static readonly MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes TTL fallback
  
  private isValid<T>(entry: CacheEntry<T> | undefined): boolean {
    if (!entry) return false;
    
    // Cache is valid if:
    // 1. Entry exists AND
    // 2. Entry is not older than MAX_CACHE_AGE (TTL fallback for when epoch check fails)
    const age = Date.now() - entry.timestamp;
    if (age > APICache.MAX_CACHE_AGE_MS) {
      
      return false;
    }
    
    return true;
  }

  // Balance cache
  async getBalance(address: string): Promise<BalanceResponse | null> {
    const entry = this.memoryCache.balance[netKey(address)];
    if (this.isValid(entry)) return entry!.data;
    return null;
  }

  async setBalance(address: string, data: BalanceResponse): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.balance[netKey(address)] = { data, epoch: currentEpoch, timestamp: Date.now() };
    await this.saveToStorage();
  }

  async invalidateBalance(address: string): Promise<void> {
    delete this.memoryCache.balance[netKey(address)];
    await this.saveToStorage();
  }

  // Encrypted balance cache
  async getEncryptedBalance(address: string): Promise<EncryptedBalanceResponse | null> {
    const entry = this.memoryCache.encryptedBalance[netKey(address)];
    if (this.isValid(entry)) return entry!.data;
    return null;
  }

  async setEncryptedBalance(address: string, data: EncryptedBalanceResponse): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.encryptedBalance[netKey(address)] = { data, epoch: currentEpoch, timestamp: Date.now() };
    await this.saveToStorage();
  }

  async invalidateEncryptedBalance(address: string): Promise<void> {
    delete this.memoryCache.encryptedBalance[netKey(address)];
    await this.saveToStorage();
  }

  // History cache
  async getHistory(address: string): Promise<any | null> {
    const entry = this.memoryCache.history[netKey(address)];
    if (this.isValid(entry)) return entry!.data;
    return null;
  }

  async setHistory(address: string, data: any): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.history[netKey(address)] = { data, epoch: currentEpoch, timestamp: Date.now() };
    await this.saveToStorage();
  }

  async invalidateHistory(address: string): Promise<void> {
    delete this.memoryCache.history[netKey(address)];
    await this.saveToStorage();
  }

  // Pending transfers cache
  async getPendingTransfers(address: string): Promise<PendingPrivateTransfer[] | null> {
    const entry = this.memoryCache.pendingTransfers[netKey(address)];
    if (this.isValid(entry)) return entry!.data;
    return null;
  }

  async setPendingTransfers(address: string, data: PendingPrivateTransfer[]): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.pendingTransfers[netKey(address)] = { data, epoch: currentEpoch, timestamp: Date.now() };
    await this.saveToStorage();
  }

  async invalidatePendingTransfers(address: string): Promise<void> {
    delete this.memoryCache.pendingTransfers[netKey(address)];
    await this.saveToStorage();
  }

  // Transaction details cache (by hash) — in-memory only, no storage write to avoid quota
  async getTransactionDetails(hash: string): Promise<TransactionDetails | null> {
    const entry = this.memoryCache.transactionDetails[hash];
    if (this.isValid(entry)) return entry!.data;
    return null;
  }

  async setTransactionDetails(hash: string, data: TransactionDetails): Promise<void> {
    // In-memory only — no saveToStorage() to avoid quota exceeded errors
    const currentEpoch = this.currentEpoch || 0;
    this.memoryCache.transactionDetails[hash] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    // Limit cache size to prevent unbounded memory growth
    const keys = Object.keys(this.memoryCache.transactionDetails);
    if (keys.length > 200) {
      // Remove oldest 50 entries
      const sorted = keys.sort((a, b) =>
        this.memoryCache.transactionDetails[a].timestamp - this.memoryCache.transactionDetails[b].timestamp
      );
      sorted.slice(0, 50).forEach(k => delete this.memoryCache.transactionDetails[k]);
    }
  }

  async invalidateTransactionDetails(hash: string): Promise<void> {
    delete this.memoryCache.transactionDetails[hash];
    
    await this.saveToStorage();
  }

  // Background cache transaction details for confirmed transactions
  async cacheTransactionDetailsInBackground(_hashes: string[]): Promise<void> {
    // DISABLED: Background caching causes quota exceeded errors
    // Only cache on-demand when user views transaction details
    
    return;
  }

  // Helper method to fetch transaction details (used by background caching)
  // DISABLED: Not used anymore since background caching is disabled
  /* private async fetchTransactionDetailsForCache(hash: string): Promise<TransactionDetails | null> {
    try {
      const response = await makeAPIRequest(`/tx/${hash}`);
      
      if (!response.ok) {
        return null;
      }
      
      const data = await safeJsonParse(response);
      return data;
    } catch {
      return null;
    }
  } */

  // Invalidate all cache for an address (call after transactions)
  async invalidateAll(address: string): Promise<void> {
    delete this.memoryCache.balance[netKey(address)];
    delete this.memoryCache.encryptedBalance[netKey(address)];
    delete this.memoryCache.history[netKey(address)];
    delete this.memoryCache.pendingTransfers[netKey(address)];
    await this.saveToStorage();
  }

  // Clear wallet nonces cache - called on epoch change
  async invalidateAllWalletNonces(addresses: string[]): Promise<void> {
    for (const address of addresses) {
      delete this.memoryCache.balance[netKey(address)];
    }
    await this.saveToStorage();
  }

  // Clear all cache
  async clearAll(): Promise<void> {
    this.memoryCache = {
      balance: {},
      encryptedBalance: {},
      history: {},
      pendingTransfers: {},
      transactionDetails: {},
      currentEpoch: this.currentEpoch,
      lastEpochCheck: this.lastEpochCheck
    };
    
    await this.saveToStorage();
  }

  // Get current cached epoch (for display/debug)
  getCachedEpoch(): number {
    return this.currentEpoch;
  }

  // Epoch change listeners
  private epochChangeListeners: Set<(newEpoch: number, oldEpoch: number) => void> = new Set();

  // Subscribe to epoch changes
  onEpochChange(callback: (newEpoch: number, oldEpoch: number) => void): () => void {
    this.epochChangeListeners.add(callback);
    // Return unsubscribe function
    return () => {
      this.epochChangeListeners.delete(callback);
    };
  }

  // Notify all listeners of epoch change
  private notifyEpochChange(newEpoch: number, oldEpoch: number): void {
    this.epochChangeListeners.forEach(callback => {
      try {
        callback(newEpoch, oldEpoch);
      } catch (error) {
        console.error('Error in epoch change listener:', error);
      }
    });
  }

  // Check for epoch change and notify listeners (call this periodically)
  async checkEpochChange(): Promise<boolean> {
    const oldEpoch = this.currentEpoch;
    const newEpoch = await this.fetchEpoch();
    
    if (oldEpoch > 0 && newEpoch > oldEpoch) {
      
      this.notifyEpochChange(newEpoch, oldEpoch);
      return true;
    }
    return false;
  }
}

// Singleton cache instance
export const apiCache = new APICache();

// Helper to invalidate cache after transaction
export async function invalidateCacheAfterTransaction(address: string): Promise<void> {
  await apiCache.invalidateBalance(address);
  await apiCache.invalidateHistory(address);
}

// Invalidate ALL cached data when switching RPC so stale data is never shown.
export async function invalidateCacheForNetworkSwitch(): Promise<void> {
  await apiCache.clearAll();
}

export async function invalidateCacheAfterEncrypt(address: string): Promise<void> {
  await apiCache.invalidateBalance(address);
  await apiCache.invalidateEncryptedBalance(address);
  await apiCache.invalidateHistory(address);
}

export async function invalidateCacheAfterDecrypt(address: string): Promise<void> {
  await apiCache.invalidateBalance(address);
  await apiCache.invalidateEncryptedBalance(address);
  await apiCache.invalidateHistory(address);
}

export async function invalidateCacheAfterClaim(address: string): Promise<void> {
  await apiCache.invalidateEncryptedBalance(address);
  await apiCache.invalidatePendingTransfers(address);
  await apiCache.invalidateHistory(address);
}

export async function invalidateCacheAfterPrivateSend(address: string): Promise<void> {
  await apiCache.invalidateEncryptedBalance(address);
  await apiCache.invalidateHistory(address);
}

// ============================================
// END CACHING SYSTEM
// ============================================

// Helper function to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to check if error is retryable
const isRetryableError = (error: any, response?: Response): boolean => {
  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error?.name === 'AbortError') return false; // Timeout - don't retry
  
  // Server errors (5xx) are retryable
  if (response && response.status >= 500) return true;
  
  // Rate limiting (429) is retryable
  if (response && response.status === 429) return true;
  
  return false;
};

// Use the active RPC provider for API requests with retry logic
async function makeAPIRequest(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<Response> {
  const provider = getActiveRPCProvider();
  
  if (!provider) {
    throw new Error('No RPC provider available');
  }
  
  // Merge headers from RPC provider configuration
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...provider.headers
  };
  
  // Safely merge options.headers if they exist
  if (options.headers) {
    const optionsHeaders = options.headers as Record<string, string>;
    Object.assign(headers, optionsHeaders);
  }
  
  // Determine if we're in development, production, or extension
  const isDevelopment = import.meta.env.DEV;
  // More robust extension detection - check for chrome.runtime.id which only exists in actual extensions
  const isExtension = typeof chrome !== 'undefined' && 
                      chrome.runtime && 
                      typeof chrome.runtime.id === 'string' &&
                      chrome.runtime.id.length > 0;
  
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  let url: string;
  
  if (isExtension) {
    // Extension: make direct requests to RPC provider
    url = `${provider.url}${cleanEndpoint}`;
  } else if (isDevelopment) {
    // Development: use Vite proxy to avoid CORS
    url = `/api${cleanEndpoint}`;
    headers['X-RPC-URL'] = provider.url;
  } else {
    // Production: use nginx proxy with X-RPC-Target header
    url = `/rpc-proxy${cleanEndpoint}`;
    headers['X-RPC-Target'] = provider.url;
  }
  
  // 
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      // Add timeout to prevent hanging requests
      // Increased to 60 seconds to handle large transaction histories
      signal: AbortSignal.timeout(300_000) // 5 minute timeout for large histories
    });
    
    // Check if we should retry on server errors
    if (isRetryableError(null, response) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryCount);
      console.warn(`API request to ${cleanEndpoint} failed with status ${response.status}, retrying in ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(delayMs);
      return makeAPIRequest(endpoint, options, retryCount + 1);
    }
    
    return response;
  } catch (error) {
    // Check if we should retry on network errors
    if (isRetryableError(error) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryCount);
      console.warn(`API request to ${cleanEndpoint} failed with error, retrying in ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      await delay(delayMs);
      return makeAPIRequest(endpoint, options, retryCount + 1);
    }
    
    console.error(`API request failed for ${url} after ${retryCount} retries:`, error);
    // Return a failed response object instead of throwing
    return new Response(null, {
      status: 500,
      statusText: 'Network Error',
      headers: new Headers()
    });
  }
}

// Helper function to safely parse JSON responses
async function safeJsonParse(response: Response): Promise<any> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('Empty response body');
    }
    return JSON.parse(text);
  } catch (error) {
    // Better error logging
    if (error instanceof Error) {
      console.error('Failed to parse JSON response:', error.message);
      console.error('Error type:', error.name);
      
      // If it's an AbortError, throw it directly so it can be handled properly
      if (error.name === 'AbortError') {
        throw error;
      }
    } else {
      console.error('Failed to parse JSON response:', error);
    }
    throw new Error('Invalid JSON response from server');
  }
}

// Update other API functions to use the helper
export async function getAddressInfo(address: string): Promise<any> {
  try {
    // octra_balance includes has_public_key field
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_balance', params: [address] }),
    });
    if (response.ok) {
      const data = await safeJsonParse(response);
      if (data?.result) return data.result;
    }
    return null;
  } catch (error) {
    console.error('Error fetching address info:', error);
    return null;
  }
}

/**
 * Fetch recipient's Curve25519 view public key via RPC octra_viewPubkey.
 * This is the key used for ECDH in stealth send — NOT the Ed25519 signing key.
 * Webcli equivalent: g_rpc.get_view_pubkey(addr) → result["view_pubkey"]
 */
export async function getViewPubkey(address: string): Promise<string | null> {
  try {
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'octra_viewPubkey',
      params: [address],
    };
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcRequest),
    });
    if (!response.ok) return null;
    const data = await safeJsonParse(response);
    if (data.error) return null;
    const result = data.result;
    if (!result || !result.view_pubkey || typeof result.view_pubkey !== 'string') return null;
    return result.view_pubkey; // base64-encoded 32-byte Curve25519 pubkey
  } catch (error) {
    console.error('Error fetching view pubkey:', error);
    return null;
  }
}

// Fetch current epoch from node_stats RPC
export async function fetchCurrentEpoch(): Promise<number> {
  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'node_stats', params: [] }),
    });
    if (response.ok) {
      const data = await safeJsonParse(response);
      const epochs: number[] = data?.result?.latest_epochs || [];
      if (epochs.length > 0) return epochs[0];
    }
    throw new Error('Failed to fetch node_stats');
  } catch (error) {
    console.error('Error fetching current epoch:', error);
    throw error;
  }
}

export async function getPublicKey(address: string): Promise<string | null> {
  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_publicKey', params: [address] }),
    });
    if (response.ok) {
      const data = await safeJsonParse(response);
      if (data?.result?.public_key) return data.result.public_key;
      if (typeof data?.result === 'string') return data.result;
    }
    return null;
  } catch (error) {
    console.error('Error fetching public key:', error);
    return null;
  }
}

/**
 * Register PVAC pubkey on the node via octra_registerPvacPubkey RPC.
 * Called before first encrypt/decrypt/stealth on a fresh wallet.
 * Returns true if already registered or successfully registered.
 */
export async function ensurePvacPubkeyRegistered(
  address: string,
  pvacPubkeyB64: string,
  regSig: string,
  walletPubKeyB64: string,
  aesKatHex: string
): Promise<{ success: boolean; alreadyRegistered?: boolean; error?: string }> {
  try {
    // Check if already registered
    const checkReq = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'octra_pvacPubkey',
      params: [address],
    };
    const checkResp = await makeAPIRequest('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkReq),
    });
    if (checkResp.ok) {
      const checkData = await safeJsonParse(checkResp);
      if (!checkData.error && checkData.result?.pvac_pubkey) {
        // Already registered — check if it matches
        if (checkData.result.pvac_pubkey === pvacPubkeyB64) {
          return { success: true, alreadyRegistered: true };
        }
        // Different key registered — conflict, cannot proceed
        return { success: false, error: 'A different PVAC key is already registered for this address. Use key switch to reset.' };
      }
    }

    // Not registered — register now
    const regReq = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'octra_registerPvacPubkey',
      params: [address, pvacPubkeyB64, regSig, walletPubKeyB64, aesKatHex],
    };
    const regResp = await makeAPIRequest('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regReq),
    });
    if (!regResp.ok) {
      return { success: false, error: `Registration request failed: ${regResp.status}` };
    }
    const regData = await safeJsonParse(regResp);
    if (regData.error) {
      const msg = typeof regData.error === 'object' ? regData.error.message : String(regData.error);
      if (msg.includes('already registered')) {
        return { success: true, alreadyRegistered: true };
      }
      return { success: false, error: msg };
    }
    return { success: true, alreadyRegistered: false };
  } catch (error) {
    console.error('Error registering PVAC pubkey:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendTransaction(transaction: Transaction): Promise<{ 
  success: boolean; 
  hash?: string; 
  error?: string;
  finality?: 'pending' | 'confirmed' | 'rejected';
  reason?: string;
}> {
  try {
    // WEBCLI LOGIC: Submit transaction via JSON-RPC 2.0 (rpc_client.hpp:123-125)
    // Endpoint: POST /rpc
    // Method: octra_submit
    // Params: [transaction_object]
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'octra_submit',
      params: [transaction]
    };

    const response = await makeAPIRequest(`/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rpcRequest),
    });

    const text = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(text);
        
        // JSON-RPC 2.0 response format
        if (data.error) {
          return {
            success: false,
            error: data.error.message || data.error.reason || 'Transaction failed',
            reason: data.error.reason
          };
        }
        
        // Success response in result field
        const result = data.result || {};
        
        // Check status field (accepted/rejected)
        if (result.status === 'accepted') {
          return { 
            success: true, 
            hash: result.tx_hash || result.hash,
            finality: 'pending'
          };
        } else if (result.status === 'rejected') {
          return { 
            success: false, 
            error: result.reason || 'Transaction rejected',
            finality: 'rejected',
            reason: result.reason
          };
        }
        
        // Fallback: if we have tx_hash, consider it success
        if (result.tx_hash || result.hash) {
          return {
            success: true,
            hash: result.tx_hash || result.hash,
            finality: 'pending'
          };
        }
        
        return {
          success: false,
          error: 'Unknown response format'
        };
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        return { success: false, error: 'Invalid response format' };
      }
    }

    // Handle error responses (non-200 status)
    try {
      const errorData = JSON.parse(text);
      
      // JSON-RPC error format
      if (errorData.error) {
        const errorMessage = errorData.error.message || errorData.error.reason || 'Transaction failed';
        console.error('Transaction failed:', errorMessage);
        return { success: false, error: errorMessage };
      }
      
      // Legacy error format
      const errorMessage = getTransactionErrorMessage(errorData.error || errorData.reason || text);
      console.error('Transaction failed:', errorMessage);
      return { success: false, error: errorMessage };
    } catch {
      console.error('Transaction failed:', text);
      return { success: false, error: text || 'Transaction failed' };
    }
  } catch (error) {
    console.error('Error sending transaction:', error);
    // Ensure we always throw an Error object, not a plain object
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    // If error is an object with type/reason, extract the message
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as { type?: string; reason?: string; message?: string };
      const errorMsg = errorObj.reason || errorObj.message || errorObj.type || 'Network error occurred';
      return { success: false, error: errorMsg };
    }
    return { success: false, error: 'Network error occurred' };
  }
}

// Helper function to get user-friendly error messages
function getTransactionErrorMessage(errorType: string): string {
  const errorMessages: Record<string, string> = {
    'malformed_transaction': 'Transaction format is invalid',
    'invalid_address': 'Invalid recipient address',
    'self_transfer': 'Cannot send to yourself',
    'sender_not_found': 'Sender address not found',
    'invalid_signature': 'Invalid transaction signature',
    'duplicate_transaction': 'Duplicate transaction detected',
    'nonce_too_far': 'Transaction nonce is too far ahead',
    'insufficient_balance': 'Insufficient balance',
    'internal_error': 'Internal server error',
  };
  
  return errorMessages[errorType] || errorType || 'Transaction failed';
}

// Submit multiple transactions in a single batch using octra_submitBatch
export async function sendTransactionBatch(transactions: Transaction[]): Promise<{
  success: boolean;
  total: number;
  accepted: number;
  rejected: number;
  results: Array<{
    status: 'accepted' | 'rejected';
    tx_hash?: string;
    reason?: string;
    nonce?: number;
  }>;
  error?: string;
}> {
  try {
    // DOCS.HTML: octra_submitBatch accepts array of signed tx objects
    // Returns: {total, accepted, rejected, results:[{status, tx_hash/reason, nonce}]}
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'octra_submitBatch',
      params: [transactions] // Array of transaction objects
    };

    const response = await makeAPIRequest(`/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rpcRequest),
    });

    const text = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(text);
        
        // JSON-RPC 2.0 error response
        if (data.error) {
          return {
            success: false,
            total: transactions.length,
            accepted: 0,
            rejected: transactions.length,
            results: [],
            error: data.error.message || data.error.reason || 'Batch submission failed'
          };
        }
        
        // Success response in result field
        const result = data.result || {};
        
        return {
          success: true,
          total: result.total || transactions.length,
          accepted: result.accepted || 0,
          rejected: result.rejected || 0,
          results: result.results || []
        };
      } catch (parseError) {
        console.error('Failed to parse batch response:', parseError);
        return {
          success: false,
          total: transactions.length,
          accepted: 0,
          rejected: transactions.length,
          results: [],
          error: 'Invalid response format'
        };
      }
    }

    // Handle error responses (non-200 status)
    try {
      const errorData = JSON.parse(text);
      
      // JSON-RPC error format
      if (errorData.error) {
        const errorMessage = errorData.error.message || errorData.error.reason || 'Batch submission failed';
        console.error('Batch submission failed:', errorMessage);
        return {
          success: false,
          total: transactions.length,
          accepted: 0,
          rejected: transactions.length,
          results: [],
          error: errorMessage
        };
      }
      
      // Legacy error format
      const errorMessage = getTransactionErrorMessage(errorData.error || errorData.reason || text);
      console.error('Batch submission failed:', errorMessage);
      return {
        success: false,
        total: transactions.length,
        accepted: 0,
        rejected: transactions.length,
        results: [],
        error: errorMessage
      };
    } catch {
      console.error('Batch submission failed:', text);
      return {
        success: false,
        total: transactions.length,
        accepted: 0,
        rejected: transactions.length,
        results: [],
        error: text || 'Batch submission failed'
      };
    }
  } catch (error) {
    console.error('Error sending transaction batch:', error);
    // Ensure we always return proper error format
    if (error instanceof Error) {
      return {
        success: false,
        total: transactions.length,
        accepted: 0,
        rejected: transactions.length,
        results: [],
        error: error.message
      };
    }
    // If error is an object with type/reason, extract the message
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as { type?: string; reason?: string; message?: string };
      const errorMsg = errorObj.reason || errorObj.message || errorObj.type || 'Network error occurred';
      return {
        success: false,
        total: transactions.length,
        accepted: 0,
        rejected: transactions.length,
        results: [],
        error: errorMsg
      };
    }
    return {
      success: false,
      total: transactions.length,
      accepted: 0,
      rejected: transactions.length,
      results: [],
      error: 'Network error occurred'
    };
  }
}

// Check transaction status using octra_transaction RPC method
export async function checkTransactionStatus(hash: string): Promise<{
  status: 'pending' | 'confirmed' | 'rejected' | 'dropped' | 'not_found';
  finality?: 'pending' | 'confirmed' | 'rejected';
  reason?: string;
}> {
  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_transaction', params: [hash] }),
    });

    if (!response.ok) return { status: 'not_found' };

    const json = await safeJsonParse(response);
    if (json.error) return { status: 'not_found' };
    const data = json.result;
    if (!data) return { status: 'not_found' };

    if (data.stage_status) return { status: 'pending', finality: 'pending' };
    if (data.epoch !== undefined) return { status: 'confirmed', finality: 'confirmed' };
    if (data.status === 'rejected') return { status: 'rejected', finality: 'rejected', reason: data.reason };
    if (data.status === 'dropped') return { status: 'dropped', reason: data.reason };

    return { status: 'not_found' };
  } catch (error) {
    console.error('Error checking transaction status:', error);
    return { status: 'not_found' };
  }
}

// Poll transaction status until confirmed, rejected, or timeout
export async function pollTransactionStatus(
  hash: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    onStatusUpdate?: (status: 'pending' | 'confirmed' | 'rejected' | 'dropped' | 'not_found') => void;
  } = {}
): Promise<{
  status: 'pending' | 'confirmed' | 'rejected' | 'dropped' | 'not_found';
  finality?: 'pending' | 'confirmed' | 'rejected';
  reason?: string;
}> {
  const { maxAttempts = 15, intervalMs = 2000, onStatusUpdate } = options;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await checkTransactionStatus(hash);
    
    // Notify callback of status update
    if (onStatusUpdate) {
      onStatusUpdate(result.status);
    }
    
    // If confirmed, rejected, or dropped, return immediately
    if (result.status === 'confirmed' || result.status === 'rejected' || result.status === 'dropped') {
      return result;
    }
    
    // If not found and not first attempt, might have been dropped
    if (result.status === 'not_found' && attempt > 2) {
      return { status: 'dropped' };
    }
    
    // Wait before next attempt (except on last attempt)
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  // Timeout - still pending
  return { status: 'pending', finality: 'pending' };
}

// Parse amount from a tx object — handles both raw integer and formatted string.
// octra_transactionsByAddress returns amount as raw integer string (no decimal, e.g. "1000")
// octra_transaction returns amount as formatted string (with decimal, e.g. "0.001000")
function parseAmount(raw: string | number | undefined, formatted: string | number | undefined): number {
  // Prefer amount_raw field — always a raw integer, divide by MU_FACTOR
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (!isNaN(n)) return n / MU_FACTOR;
  }
  // Fallback: use amount field
  if (formatted !== undefined && formatted !== null && formatted !== '') {
    const s = String(formatted);
    // If no decimal point → raw integer string, divide by MU_FACTOR
    if (!s.includes('.')) {
      const n = parseInt(s, 10);
      if (!isNaN(n)) return n / MU_FACTOR;
    }
    // Has decimal → already human-readable formatted value
    const n = parseFloat(s);
    if (!isNaN(n)) return n;
  }
  return 0;
}

export async function fetchTransactionHistory(
  address: string,
  options: HistoryPaginationOptions = {},
  onProgress?: (txs: TransactionHistoryItem[]) => void
): Promise<AddressHistoryResponse & { totalCount: number }> {
  const { limit = 11, offset = 0 } = options;
  
  try {
    // Use octra_account — fast (~2s), returns full tx objects with all fields
    // octra_transactionsByAddress is too slow (times out)
    const [confirmedResponse, pendingTransactions] = await Promise.all([
      makeAPIRequest('/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'octra_account',
          params: [address, limit],
        }),
      }),
      fetchPendingTransactions(address).catch(() => []),
    ]);

    if (!confirmedResponse.ok) {
      console.error('Failed to fetch transaction history:', confirmedResponse.status);
      return { transactions: [], balance: 0, totalCount: 0 };
    }

    let rpcData: any;
    try {
      rpcData = await safeJsonParse(confirmedResponse);
    } catch {
      return { transactions: [], balance: 0, totalCount: 0 };
    }

    if (rpcData.error) {
      console.error('octra_account error:', rpcData.error);
      return { transactions: [], balance: 0, totalCount: 0 };
    }

    const apiData = rpcData.result;
    if (!apiData) return { transactions: [], balance: 0, totalCount: 0 };

    // octra_account returns: { address, balance, nonce, tx_count, recent_txs[{epoch,hash}], rejected_txs[] }
    // recent_txs only has {epoch, hash} — need to fetch full details per tx
    const recentTxList: Array<any> = apiData.recent_txs || [];

    // Fetch details for each confirmed tx — fire onProgress as each one resolves
    const confirmedTransactions: TransactionHistoryItem[] = [];
    const progressBuffer: TransactionHistoryItem[] = [];

    const parseTx = async (recentTx: any): Promise<TransactionHistoryItem> => {
      // octra_account recent_txs only has {epoch, hash} — always fetch details
      const hash = recentTx.hash || recentTx.tx_hash;
      if (!hash) throw new Error('No hash');
      const txDetails = await fetchTransactionDetails(hash);
      const amount = parseAmount(txDetails.amount_raw, txDetails.amount);
      return {
        hash: txDetails.tx_hash,
        from: txDetails.from,
        to: txDetails.to,
        amount,
        timestamp: txDetails.timestamp,
        status: 'confirmed' as const,
        type: txDetails.from?.toLowerCase() === address.toLowerCase() ? 'sent' as const : 'received' as const,
        op_type: txDetails.op_type || 'standard',
        message: txDetails.message || undefined,
      };
    };

    // Launch all tx fetches concurrently (max 5 at a time) and call onProgress as each resolves
    const CONCURRENCY = 5;
    const slots = new Array(Math.min(CONCURRENCY, recentTxList.length)).fill(null);
    let nextIdx = 0;

    const runSlot = async () => {
      while (nextIdx < recentTxList.length) {
        const idx = nextIdx++;
        const recentTx = recentTxList[idx];
        try {
          const tx = await parseTx(recentTx);
          confirmedTransactions.push(tx);
          progressBuffer.push(tx);
          // Fire progress callback with all resolved txs so far (sorted newest first)
          if (onProgress) {
            const sorted = [...progressBuffer].sort((a, b) => b.timestamp - a.timestamp);
            onProgress(sorted);
          }
        } catch {
          const fallback: TransactionHistoryItem = {
            hash: recentTx.hash || recentTx.tx_hash || '',
            from: 'unknown', to: 'unknown', amount: 0,
            timestamp: Date.now() / 1000,
            status: 'confirmed' as const, type: 'received' as const,
          };
          confirmedTransactions.push(fallback);
        }
      }
    };

    await Promise.all(slots.map(() => runSlot()));

    const confirmedHashes = new Set(confirmedTransactions.map(tx => tx.hash));

    const pendingFormatted = pendingTransactions.map(tx => {
      let opType = tx.op_type || 'standard';
      if (!tx.op_type) {
        if (tx.message === 'PRIVATE_TRANSFER' || tx.message === '505249564154455f5452414e53464552') {
          opType = 'private';
        } else if (tx.encrypted_data) {
          try {
            const ed = JSON.parse(tx.encrypted_data);
            if (ed.cipher && ed.zero_proof && !ed.delta_cipher) opType = 'encrypt';
            else if (ed.cipher && ed.range_proof_balance && !ed.delta_cipher) opType = 'decrypt';
            else if (ed.delta_cipher) opType = 'stealth';
            else if (ed.claim_cipher) opType = 'claim';
          } catch { /* keep standard */ }
        }
      }
      return {
        hash: tx.hash, from: tx.from, to: tx.to,
        amount: parseAmount(undefined, tx.amount),
        timestamp: tx.timestamp,
        status: 'pending' as const,
        type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' as const : 'received' as const,
        op_type: opType,
        message: tx.message || undefined,
      };
    });

    const pendingToInclude = offset === 0
      ? pendingFormatted.filter(tx => !confirmedHashes.has(tx.hash))
      : [];

    const allTransactions = [...confirmedTransactions, ...pendingToInclude]
      .sort((a, b) => b.timestamp - a.timestamp);

    const seenHashes = new Set<string>();
    const uniqueTransactions = allTransactions.filter(tx => {
      if (seenHashes.has(tx.hash)) return false;
      seenHashes.add(tx.hash);
      return true;
    });

    return {
      transactions: uniqueTransactions,
      balance: parseFloat(apiData.balance || '0'),
      totalCount: apiData.tx_count || apiData.total || uniqueTransactions.length,
    };
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    return { transactions: [], balance: 0, totalCount: 0 };
  }
}

export async function fetchTransactionDetails(hash: string, _forceRefresh = false): Promise<TransactionDetails> {
  // Check in-memory cache first for instant display
  const cached = await apiCache.getTransactionDetails(hash);
  if (cached) return cached;

  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_transaction', params: [hash] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch transaction details:', response.status, errorText);
      throw new Error(`Error ${response.status}`);
    }

    const json = await safeJsonParse(response);
    if (json.error) throw new Error(json.error.message || `RPC error: ${JSON.stringify(json.error)}`);

    const data = json.result;
    if (!data) throw new Error('Empty result from octra_transaction');

    const to = data.to || data.to_ || '';
    const normalized: TransactionDetails = {
      tx_hash: data.tx_hash || hash,
      status: data.status || 'confirmed',
      epoch: data.epoch ?? null,
      from: data.from || '',
      to,
      amount: data.amount || '0',
      amount_raw: data.amount_raw || '0',
      nonce: data.nonce || 0,
      ou: data.ou || '0',
      timestamp: data.timestamp || 0,
      op_type: data.op_type || 'standard',
      message: data.message || null,
      parsed_tx: {
        from: data.from || '',
        to,
        amount: data.amount || '0',
        amount_raw: data.amount_raw || '0',
        nonce: data.nonce || 0,
        ou: data.ou || '0',
        timestamp: data.timestamp || 0,
        message: data.message || null,
        op_type: data.op_type || 'standard',
      },
    };

    // Cache for instant display on next access
    await apiCache.setTransactionDetails(hash, normalized);

    return normalized;
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    throw error;
  }
}

export async function fetchPendingTransactions(address: string): Promise<PendingTransaction[]> {
  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'staging_view', params: [] }),
    });

    if (!response.ok) {
      console.error('Failed to fetch pending transactions:', response.status);
      return [];
    }

    const json = await safeJsonParse(response);
    if (json.error) return [];

    const result = json.result || json;
    // staging_view returns { count, transactions[] }
    const staged: any[] = result.transactions || result.staged_transactions || [];

    return staged.filter((tx: any) =>
      tx.from?.toLowerCase() === address.toLowerCase() ||
      tx.to?.toLowerCase() === address.toLowerCase()
    );
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    return [];
  }
}

export async function fetchPendingTransactionByHash(hash: string, maxRetries = 3): Promise<PendingTransaction | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await makeAPIRequest('/rpc', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'staging_view', params: [] }),
      });

      if (!response.ok) {
        if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
        return null;
      }

      const json = await safeJsonParse(response);
      if (json.error) return null;

      const result = json.result || json;
      const staged: any[] = result.transactions || result.staged_transactions || [];
      const tx = staged.find((t: any) => t.hash === hash);
      if (tx) return tx;

      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
      return null;
    } catch (error) {
      console.error(`Error fetching pending tx by hash (attempt ${attempt}):`, error);
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
      return null;
    }
  }
  return null;
}

export async function fetchBalance(address: string, forceRefresh = false): Promise<BalanceResponse> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await apiCache.getBalance(address);
    if (cached) return cached;
  }

  try {
    // Use octra_balance JSON-RPC — works on both mainnet and devnet
    const [balanceResponse, stagingResponse] = await Promise.all([
      makeAPIRequest('/rpc', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_balance', params: [address] }),
      }),
      makeAPIRequest('/rpc', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'staging_view', params: [] }),
      }).catch(() => ({ ok: false })),
    ]);

    if (!balanceResponse.ok) {
      console.error('Failed to fetch balance:', balanceResponse.status);
      return { balance: 0, nonce: 0 };
    }

    let rpcData: any;
    try {
      rpcData = await balanceResponse.json();
    } catch {
      console.error('Failed to parse balance RPC response');
      return { balance: 0, nonce: 0 };
    }

    if (rpcData.error) {
      console.error('octra_balance RPC error:', rpcData.error);
      return { balance: 0, nonce: 0 };
    }

    const data = rpcData.result;
    if (!data) return { balance: 0, nonce: 0 };

    // Parse balance — prefer balance_raw (micro units), fallback to balance string
    let balance = 0;
    if (data.balance_raw !== undefined) {
      const raw = typeof data.balance_raw === 'string' ? parseInt(data.balance_raw, 10) : data.balance_raw;
      balance = raw / MU_FACTOR;
    } else if (data.balance !== undefined) {
      balance = typeof data.balance === 'string' ? parseFloat(data.balance) : data.balance;
    }

    // Nonce: prefer pending_nonce
    let nonce = data.pending_nonce !== undefined ? data.pending_nonce : (data.nonce || 0);

    // Check staging for pending nonces from this address
    if ('ok' in stagingResponse && stagingResponse.ok) {
      try {
        const stagingRpc = await (stagingResponse as Response).json();
        const stagingData = stagingRpc.result || stagingRpc;
        // staging_view returns { count, transactions[] }
        const transactions = stagingData.transactions || stagingData.staged_transactions || [];
        const ourPendingTxs = transactions.filter((tx: any) => tx.from === address);
        if (ourPendingTxs.length > 0) {
          const maxPendingNonce = Math.max(...ourPendingTxs.map((tx: any) => {
            const n = parseInt(tx.nonce, 10);
            return isNaN(n) ? 0 : n;
          }));
          nonce = Math.max(nonce, maxPendingNonce);
        }
      } catch {
        // staging check is best-effort
      }
    }

    if (isNaN(balance) || isNaN(nonce)) {
      console.warn('Invalid balance or nonce', { balance, nonce });
      return { balance: 0, nonce: 0 };
    }

    const result = { balance, nonce };
    await apiCache.setBalance(address, result);
    return result;
  } catch (error) {
    console.error('Error fetching balance:', error);
    return { balance: 0, nonce: 0 };
  }
}

export async function fetchEncryptedBalance(address: string, privateKey?: string, forceRefresh = false): Promise<EncryptedBalanceResponse | null> {
  try {
    // Step 1: Fetch public balance first
    const publicBalance = await fetchBalance(address, forceRefresh);
    
    // Step 2: Try to fetch encrypted balance if private key is provided
    let encryptedRaw = 0;
    let cipher = '0';
    
    if (privateKey) {
      try {
        // Import encrypted balance service
        const { fetchEncryptedBalanceFromNode } = await import('../services/encryptedBalanceService');
        
        // Get RPC URL from active provider
        const provider = getActiveRPCProvider();
        if (!provider) {
          throw new Error('No active RPC provider');
        }
        const rpcUrl = provider.url;
        
        // IMPORTANT: privateKey is 32-byte seed in base64 format
        // The service will convert it to 64-byte secret key internally
        const result = await fetchEncryptedBalanceFromNode(
          address,
          privateKey, // Pass as-is (32-byte seed base64)
          rpcUrl
        );
        
        cipher = result.cipher;
        
        // Try to decrypt using PVAC server if cipher exists
        if (cipher && cipher !== '0' && cipher.startsWith('hfhe_v1|')) {
          try {
            const { pvacServerService } = await import('../services/pvacServerService');
            
            if (pvacServerService.isEnabled()) {
              
              const decryptResult = await pvacServerService.decryptBalance(cipher, privateKey);
              
              if (decryptResult.success && decryptResult.balance) {
                encryptedRaw = decryptResult.balance;
                
              }
            } else {
              
            }
          } catch (decryptError) {
            console.warn('[EncryptedBalance] Failed to decrypt balance:', decryptError);
            // Continue with cipher only
          }
        }

      } catch (encError) {
        console.warn('[EncryptedBalance] Failed to fetch encrypted balance:', encError);
        // Continue with public balance only
      }
    }
    
    return {
      public: publicBalance.balance,
      public_raw: Math.floor(publicBalance.balance * MU_FACTOR),
      encrypted: encryptedRaw / MU_FACTOR,
      encrypted_raw: encryptedRaw,
      total: publicBalance.balance + (encryptedRaw / MU_FACTOR),
      cipher
    };
  } catch (error) {
    console.error('Error fetching balance:', error);
    return null;
  }
}

// Helper function removed - no longer needed

export async function encryptBalance(_address: string, _amount: number, _privateKey: string): Promise<{ success: boolean; tx_hash?: string; error?: string }> {
  // COMING SOON: Encrypted balance feature will be available in future release
  return { 
    success: false, 
    error: 'Encrypted balance feature coming soon. Please use standard transactions for now.' 
  };
}

export async function decryptBalance(_address: string, _amount: number, _privateKey: string, _currentCipher: string): Promise<{ success: boolean; tx_hash?: string; error?: string }> {
  // COMING SOON: Encrypted balance feature will be available in future release
  return { 
    success: false, 
    error: 'Encrypted balance feature coming soon. Please use standard transactions for now.' 
  };
}

export async function createPrivateTransfer(fromAddress: string, toAddress: string, amount: number, fromPrivateKey: string): Promise<PrivateTransferResult> {
  try {
    const addressInfo = await getAddressInfo(toAddress);
    if (!addressInfo || !addressInfo.has_public_key) {
      return { success: false, error: "Recipient has no public key" };
    }
    
    const toPublicKey = await getPublicKey(toAddress);
    if (!toPublicKey) {
      return { success: false, error: "Cannot get recipient public key" };
    }
    
    const data = {
      from: fromAddress,
      to: toAddress,
      amount: Math.floor(amount * MU_FACTOR).toString(),
      from_private_key: fromPrivateKey,
      to_public_key: toPublicKey
    };
    
    const response = await makeAPIRequest('/private_transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        tx_hash: result.tx_hash,
        ephemeral_key: result.ephemeral_key
      };
    } else {
      const error = await response.text();
      return { success: false, error };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getPendingPrivateTransfers(address: string, privateKey?: string, _forceRefresh = false): Promise<PendingPrivateTransfer[]> {
  if (!privateKey) return [];
  try {
    const { scanStealthOutputs } = await import('../services/stealthScanService');
    const claimable = await scanStealthOutputs(privateKey);
    // Map to PendingPrivateTransfer shape expected by existing callers
    return claimable.map(t => ({
      id: t.id,
      from: t.sender,
      to: address,
      amount: t.amount,
      encrypted_data: '',
      ephemeral_key: '',
      timestamp: t.epoch,
      // Extra fields for ClaimTransfers
      _claimable: t,
    } as any));
  } catch (err) {
    console.warn('[getPendingPrivateTransfers] scan failed:', err);
    return [];
  }
}

export async function claimPrivateTransfer(recipientAddress: string, privateKey: string, transferId: string): Promise<ClaimResult> {
  try {
    const data = {
      recipient_address: recipientAddress,
      private_key: privateKey,
      transfer_id: transferId
    };
    
    const response = await makeAPIRequest('/claim_private_transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        amount: result.amount
      };
    } else {
      const error = await response.text();
      return { success: false, error };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function createTransaction(
  senderAddress: string,
  recipientAddress: string,
  amount: number,
  nonce: number,
  privateKeyBase64: string,
  publicKeyHex: string,
  message?: string,
  customOu?: number
): Transaction {
  // Convert amount to micro units (multiply by 1,000,000) - WEBCLI LOGIC
  const amountMu = Math.floor(amount * MU_FACTOR);
  
  // Use custom OU if provided, otherwise determine based on amount
  // WEBCLI LOGIC: 10000 for < 1000 OCT, 30000 for >= 1000 OCT
  const defaultOu = amount < 1000 ? 10000 : 30000;
  const ou = (customOu || defaultOu).toString();
  
  // Create timestamp - WEBCLI LOGIC: Date.now() / 1000 (seconds with decimals)
  const timestamp = Date.now() / 1000;

  // Create base transaction object - WEBCLI STRUCTURE
  const transaction: Transaction = {
    from: senderAddress,
    to_: recipientAddress,
    amount: amountMu.toString(),
    nonce,
    ou,
    timestamp,
    op_type: 'standard', // WEBCLI: uses 'standard' for normal transfers (see main.cpp:1056)
  };

  // Add message if provided - WEBCLI LOGIC
  if (message && message.trim()) {
    transaction.message = message;
  }

  // WEBCLI CANONICAL JSON FORMAT
  // Build canonical JSON exactly like webcli does (tx_builder.hpp:88-98):
  // Order: from, to_, amount, nonce, ou, timestamp, op_type, [encrypted_data], [message]
  const canonicalFields: any = {
    from: transaction.from,
    to_: transaction.to_,
    amount: transaction.amount,
    nonce: transaction.nonce,
    ou: transaction.ou,
    timestamp: transaction.timestamp,
    op_type: transaction.op_type,
  };

  // Add optional fields in canonical order - WEBCLI: encrypted_data BEFORE message
  if (transaction.encrypted_data) {
    canonicalFields.encrypted_data = transaction.encrypted_data;
  }
  if (transaction.message) {
    canonicalFields.message = transaction.message;
  }

  // Create canonical JSON string - WEBCLI uses compact format (no spaces)
  const signingData = JSON.stringify(canonicalFields);
  
  // Prepare keys for signing
  const privateKeyBuffer = Buffer.from(privateKeyBase64, 'base64');
  const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  
  // Create secret key for nacl (64 bytes: 32 private + 32 public)
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKeyBuffer, 0);
  secretKey.set(publicKeyBuffer, 32);

  // Sign the canonical JSON - WEBCLI LOGIC
  const signature = nacl.sign.detached(new TextEncoder().encode(signingData), secretKey);

  // Add signature and public key to transaction
  transaction.signature = Buffer.from(signature).toString('base64');
  transaction.public_key = Buffer.from(publicKeyBuffer).toString('base64');

  return transaction;
}

// Pagination options for transaction history
export interface HistoryPaginationOptions {
  limit?: number;
  offset?: number;
}

// Wrapper functions for compatibility with existing components
export async function getBalance(address: string): Promise<number> {
  try {
    const result = await fetchBalance(address);
    return result.balance;
  } catch (error) {
    console.error('Error fetching balance:', error);
    return 0;
  }
}

export async function sendMultipleTransactions(transactions: any[]): Promise<string[]> {
  try {
    const promises = transactions.map(async (txData) => {
      // Convert the transaction data to the proper format
      const transaction = createTransaction(
        txData.from,
        txData.to,
        txData.amount,
        0, // nonce will be handled properly in real implementation
        txData.privateKey,
        '' // publicKey will be derived from privateKey
      );
      
      const result = await sendTransaction(transaction);
      if (result.success && result.hash) {
        return result.hash;
      }
      throw new Error(result.error || 'Transaction failed');
    });
    
    const results = await Promise.all(promises);
    return results;
  } catch (error) {
    console.error('Error sending multiple transactions:', error);
    throw error;
  }
}

export async function getTransactionHistory(
  address: string,
  options: HistoryPaginationOptions = {},
  forceRefresh = false,
  onProgress?: (txs: any[]) => void
): Promise<{ transactions: any[]; totalCount: number }> {
  // Check cache first (unless force refresh or pagination)
  if (!forceRefresh && (options.offset === 0 || options.offset === undefined)) {
    const cached = await apiCache.getHistory(address);
    if (cached) return cached;
  }

  try {
    const result = await fetchTransactionHistory(address, options, onProgress);
    const historyResult = {
      transactions: result.transactions || [],
      totalCount: result.totalCount || 0,
    };

    // Cache only first page results
    if (options.offset === 0 || options.offset === undefined) {
      await apiCache.setHistory(address, historyResult);
    }

    return historyResult;
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    return { transactions: [], totalCount: 0 };
  }
}

// ============================================
// TX COUNT POLLER — Smart sync trigger
// ============================================
// Every 3s: call octra_account to get tx_count.
// If tx_count changed → fire onChanged callback so WalletDashboard re-fetches.
// This avoids blind polling — only syncs when there's actually new data.

const TX_COUNT_POLL_INTERVAL = 5000; // 5 seconds
const TX_COUNT_STORAGE_KEY = 'octwa_tx_counts'; // persisted per address+network

function getTxCountKey(address: string): string {
  return `${getNetworkCacheKey()}:${address}`;
}

async function fetchTxCount(address: string): Promise<number | null> {
  try {
    const response = await makeAPIRequest('/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'octra_account',
        params: [address, 1], // limit=1, we only need tx_count
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const txCount = data?.result?.tx_count;
    if (typeof txCount === 'number') return txCount;
    return null;
  } catch {
    return null;
  }
}

function loadStoredTxCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TX_COUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredTxCount(key: string, count: number): void {
  try {
    const counts = loadStoredTxCounts();
    counts[key] = count;
    localStorage.setItem(TX_COUNT_STORAGE_KEY, JSON.stringify(counts));
  } catch { /* ignore */ }
}

export class TxCountPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private address: string = '';
  private onChanged: () => void = () => {};
  private isRunning = false;

  start(address: string, onChanged: () => void): void {
    this.stop();
    this.address = address;
    this.onChanged = onChanged;
    this.isRunning = true;
    this.intervalId = setInterval(() => this.poll(), TX_COUNT_POLL_INTERVAL);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning || !this.address) return;
    const count = await fetchTxCount(this.address);
    if (count === null) return; // RPC error — skip

    const key = getTxCountKey(this.address);
    const stored = loadStoredTxCounts();
    const prev = stored[key];

    if (prev === undefined) {
      // First poll — just store, don't trigger sync
      saveStoredTxCount(key, count);
      return;
    }

    if (count !== prev) {
      saveStoredTxCount(key, count);
      this.onChanged();
    }
  }
}
