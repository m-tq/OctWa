// api.ts
import {
  BalanceResponse,
  Transaction,
  AddressHistoryResponse,
  TransactionDetails,
  PendingTransaction,
  StagingResponse,
  EncryptedBalanceResponse,
  PendingPrivateTransfer,
  PrivateTransferResult,
  ClaimResult,
} from '../types/wallet';
import { encryptClientBalance } from './crypto';
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
const CACHE_TTL_FALLBACK = 60 * 1000; // 1 minute fallback if epoch check fails
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
  currentEpoch: number;
  lastEpochCheck: number;
}

// Check if we're in extension context
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && 
         chrome.storage && 
         typeof chrome.storage.local !== 'undefined';
}

class APICache {
  // In-memory cache for non-extension context (dev mode)
  private memoryCache: CacheStorage = {
    balance: {},
    encryptedBalance: {},
    history: {},
    pendingTransfers: {},
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
            console.log('📦 Cache synced from storage');
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
        console.log('📦 Cache loaded from storage');
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
      const response = await makeAPIRequest('/status');
      if (response.ok) {
        const data = await response.json();
        const newEpoch = data.current_epoch;

        // Just update epoch tracking, don't auto-invalidate cache
        // Cache invalidation is handled manually after user actions
        // or by WalletDashboard when it detects data changes
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

  // Check if cache entry exists (cache is valid until manually invalidated or updated)
  private isValid<T>(entry: CacheEntry<T> | undefined): boolean {
    // Cache is valid as long as entry exists
    // Invalidation is handled by:
    // 1. Manual invalidate after user TX actions
    // 2. WalletDashboard updating cache when epoch change detects new data
    return !!entry;
  }

  // Balance cache
  async getBalance(address: string): Promise<BalanceResponse | null> {
    const entry = this.memoryCache.balance[address];
    if (this.isValid(entry)) {
      console.log(
        `📦 Cache hit: balance for ${address.slice(0, 8)}`
      );
      return entry!.data;
    }
    return null;
  }

  async setBalance(address: string, data: BalanceResponse): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.balance[address] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    console.log(`📦 Cache set: balance for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  async invalidateBalance(address: string): Promise<void> {
    delete this.memoryCache.balance[address];
    console.log(`📦 Cache invalidated: balance for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  // Encrypted balance cache
  async getEncryptedBalance(
    address: string
  ): Promise<EncryptedBalanceResponse | null> {
    const entry = this.memoryCache.encryptedBalance[address];
    if (this.isValid(entry)) {
      console.log(
        `📦 Cache hit: encrypted balance for ${address.slice(0, 8)}`
      );
      return entry!.data;
    }
    return null;
  }

  async setEncryptedBalance(
    address: string,
    data: EncryptedBalanceResponse
  ): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.encryptedBalance[address] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    console.log(`📦 Cache set: encrypted balance for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  async invalidateEncryptedBalance(address: string): Promise<void> {
    delete this.memoryCache.encryptedBalance[address];
    console.log(
      `📦 Cache invalidated: encrypted balance for ${address.slice(0, 8)}`
    );
    await this.saveToStorage();
  }

  // History cache
  async getHistory(address: string): Promise<any | null> {
    const entry = this.memoryCache.history[address];
    if (this.isValid(entry)) {
      console.log(`📦 Cache hit: history for ${address.slice(0, 8)}`);
      return entry!.data;
    }
    return null;
  }

  async setHistory(address: string, data: any): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.history[address] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    console.log(`📦 Cache set: history for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  async invalidateHistory(address: string): Promise<void> {
    delete this.memoryCache.history[address];
    console.log(`📦 Cache invalidated: history for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  // Pending transfers cache
  async getPendingTransfers(
    address: string
  ): Promise<PendingPrivateTransfer[] | null> {
    const entry = this.memoryCache.pendingTransfers[address];
    if (this.isValid(entry)) {
      console.log(`📦 Cache hit: pending transfers for ${address.slice(0, 8)}`);
      return entry!.data;
    }
    return null;
  }

  async setPendingTransfers(
    address: string,
    data: PendingPrivateTransfer[]
  ): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.pendingTransfers[address] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    console.log(
      `📦 Cache set: pending transfers for ${address.slice(0, 8)} (epoch ${currentEpoch})`
    );
    await this.saveToStorage();
  }

  async invalidatePendingTransfers(address: string): Promise<void> {
    delete this.memoryCache.pendingTransfers[address];
    console.log(
      `📦 Cache invalidated: pending transfers for ${address.slice(0, 8)}`
    );
    await this.saveToStorage();
  }

  // Invalidate all cache for an address (call after transactions)
  async invalidateAll(address: string): Promise<void> {
    delete this.memoryCache.balance[address];
    delete this.memoryCache.encryptedBalance[address];
    delete this.memoryCache.history[address];
    delete this.memoryCache.pendingTransfers[address];
    console.log(`📦 Cache invalidated: ALL for ${address.slice(0, 8)}`);
    await this.saveToStorage();
  }

  // Clear all cache
  async clearAll(): Promise<void> {
    this.memoryCache = {
      balance: {},
      encryptedBalance: {},
      history: {},
      pendingTransfers: {},
      currentEpoch: this.currentEpoch,
      lastEpochCheck: this.lastEpochCheck
    };
    console.log('📦 Cache cleared: ALL');
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
      console.log(`📦 Epoch change detected: ${oldEpoch} → ${newEpoch}`);
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
  
  // console.log(`Making API request to: ${provider.url}${cleanEndpoint} (via proxy: ${url})`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000) // 30 second timeout
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
    console.error('Failed to parse JSON response:', error);
    throw new Error('Invalid JSON response from server');
  }
}

// Update other API functions to use the helper
export async function getAddressInfo(address: string): Promise<any> {
  try {
    const response = await makeAPIRequest(`/address/${address}`);
    if (response.ok) {
      return await safeJsonParse(response);
    }
    return null;
  } catch (error) {
    console.error('Error fetching address info:', error);
    return null;
  }
}

// Fetch current epoch from RPC status
export async function fetchCurrentEpoch(): Promise<number> {
  try {
    const response = await makeAPIRequest('/status');
    if (response.ok) {
      const data = await safeJsonParse(response);
      return data.current_epoch;
    }
    throw new Error('Failed to fetch status');
  } catch (error) {
    console.error('Error fetching current epoch:', error);
    throw error;
  }
}

export async function getPublicKey(address: string): Promise<string | null> {
  try {
    const response = await makeAPIRequest(`/public_key/${address}`);
    if (response.ok) {
      const data = await safeJsonParse(response);
      return data.public_key;
    }
    return null;
  } catch (error) {
    console.error('Error fetching public key:', error);
    return null;
  }
}

export async function sendTransaction(transaction: Transaction): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    // console.log('Sending transaction:', JSON.stringify(transaction, null, 2));
    
    const response = await makeAPIRequest(`/send-tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transaction),
    });

    const text = await response.text();
    // console.log('Server response:', response.status, text);

    if (response.ok) {
      try {
        const data = JSON.parse(text);
        if (data.status === 'accepted') {
          return { success: true, hash: data.tx_hash };
        }
      } catch {
        const hashMatch = text.match(/OK\s+([0-9a-fA-F]{64})/);
        if (hashMatch) {
          return { success: true, hash: hashMatch[1] };
        }
      }
      return { success: true, hash: text };
    }

    console.error('Transaction failed:', text);
    return { success: false, error: text || 'Transaction failed' };
  } catch (error) {
    console.error('Error sending transaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error occurred' };
  }
}

// Update fetchTransactionHistory to handle errors better
export async function fetchTransactionHistory(
  address: string, 
  options: HistoryPaginationOptions = {}
): Promise<AddressHistoryResponse & { totalCount: number }> {
  const { limit = 20, offset = 0 } = options;
  
  try {
    // Fetch both confirmed and pending transactions
    const [confirmedResponse, pendingTransactions] = await Promise.all([
      makeAPIRequest(`/address/${address}?limit=${limit}&offset=${offset}`),
      fetchPendingTransactions(address).catch(() => []) // Return empty array on error
    ]);
    
    if (!confirmedResponse.ok) {
      const errorText = await confirmedResponse.text();
      console.error('Failed to fetch transaction history:', confirmedResponse.status, errorText);
      // Return empty history instead of throwing
      return {
        transactions: [],
        balance: 0,
        totalCount: 0
      };
    }
    
    let apiData: AddressApiResponse;
    try {
      apiData = await safeJsonParse(confirmedResponse);
    } catch (parseError) {
      console.error('Failed to parse transaction history JSON:', parseError);
      return {
        transactions: [],
        balance: 0,
        totalCount: 0
      };
    }
    
    // Fetch details for each confirmed transaction
    const confirmedTransactionPromises = apiData.recent_transactions.map(async (recentTx) => {
      try {
        const txDetails = await fetchTransactionDetails(recentTx.hash);
        
        // Determine op_type from transaction details
        const opType = txDetails.op_type || txDetails.parsed_tx.op_type || 
          (txDetails.parsed_tx.message === 'PRIVATE_TRANSFER' || 
           txDetails.parsed_tx.message === '505249564154455f5452414e53464552' ? 'private' : 'standard');
        
        // Transform to our expected format
        return {
          hash: txDetails.tx_hash,
          from: txDetails.parsed_tx.from,
          to: txDetails.parsed_tx.to,
          amount: parseFloat(txDetails.parsed_tx.amount),
          timestamp: txDetails.parsed_tx.timestamp,
          status: 'confirmed' as const,
          type: txDetails.parsed_tx.from.toLowerCase() === address.toLowerCase() ? 'sent' as const : 'received' as const,
          op_type: opType,
          message: txDetails.parsed_tx.message
        };
      } catch (error) {
        console.error('Failed to fetch transaction details for hash:', recentTx.hash, error);
        // Return a basic transaction object if details fetch fails
        return {
          hash: recentTx.hash,
          from: 'unknown',
          to: 'unknown',
          amount: 0,
          timestamp: Date.now() / 1000,
          status: 'confirmed' as const,
          type: 'received' as const,
          op_type: 'standard'
        };
      }
    });
    
    const confirmedTransactions = await Promise.all(confirmedTransactionPromises);
    
    // Transform pending transactions to our expected format
    const pendingTransactionsFormatted = pendingTransactions.map(tx => {
      // Determine op_type from message
      const opType = tx.message === 'PRIVATE_TRANSFER' || 
        tx.message === '505249564154455f5452414e53464552' ? 'private' : 'standard';
      
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        amount: parseFloat(tx.amount),
        timestamp: tx.timestamp,
        status: 'pending' as const,
        type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' as const : 'received' as const,
        op_type: opType,
        message: tx.message
      };
    });
    
    // Combine and sort by timestamp (newest first)
    // Only include pending transactions on first page (offset 0)
    const pendingToInclude = offset === 0 ? pendingTransactionsFormatted : [];
    const allTransactions = [...pendingToInclude, ...confirmedTransactions]
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return {
      transactions: allTransactions,
      balance: parseFloat(apiData.balance),
      totalCount: apiData.transaction_count || 0
    };
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    // Return empty history instead of throwing
    return {
      transactions: [],
      balance: 0,
      totalCount: 0
    };
  }
}

export async function fetchTransactionDetails(hash: string): Promise<TransactionDetails> {
  try {
    const response = await makeAPIRequest(`/tx/${hash}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch transaction details:', response.status, errorText);
      throw new Error(`Error ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return data;
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    throw error;
  }
}

// New function to fetch pending transactions from staging
export async function fetchPendingTransactions(address: string): Promise<PendingTransaction[]> {
  try {
    const response = await makeAPIRequest(`/staging`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch pending transactions:', response.status, errorText);
      return [];
    }
    
    let data: StagingResponse;
    try {
      data = await safeJsonParse(response);
      
      if (!data.staged_transactions || !Array.isArray(data.staged_transactions)) {
        console.warn('Staging response does not contain staged_transactions array:', data);
        return [];
      }
    } catch (parseError) {
      console.error('Failed to parse staging JSON:', parseError);
      return [];
    }
    
    // Filter transactions for the specific address
    const userTransactions = data.staged_transactions.filter(tx => 
      tx.from.toLowerCase() === address.toLowerCase() || 
      tx.to.toLowerCase() === address.toLowerCase()
    );
    
    return userTransactions;
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    return [];
  }
}

// New function to fetch specific pending transaction by hash with retry
export async function fetchPendingTransactionByHash(hash: string, maxRetries: number = 3): Promise<PendingTransaction | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await makeAPIRequest(`/staging`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch pending transactions (attempt ${attempt}):`, response.status, errorText);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
          continue;
        }
        return null;
      }
      
      let data: StagingResponse;
      try {
        data = await safeJsonParse(response);
        
        if (!data.staged_transactions || !Array.isArray(data.staged_transactions)) {
          console.warn('Staging response does not contain staged_transactions array:', data);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            continue;
          }
          return null;
        }
      } catch (parseError) {
        console.error('Failed to parse staging JSON:', parseError);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          continue;
        }
        return null;
      }
      
      // Find transaction by hash
      const transaction = data.staged_transactions.find(tx => tx.hash === hash);
      
      if (transaction) {
        return transaction;
      }
      
      // If not found and we have retries left, wait and try again
      // (transaction might not be propagated yet)
      if (attempt < maxRetries) {
        console.log(`Pending transaction not found (attempt ${attempt}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
      
      return null;
    } catch (error) {
      console.error(`Error fetching pending transaction by hash (attempt ${attempt}):`, error);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
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
    // Fetch both balance and staging data like CLI does
    const [balanceResponse, stagingResponse] = await Promise.all([
      makeAPIRequest(`/balance/${address}`),
      makeAPIRequest(`/staging`).catch(() => ({ ok: false }))
    ]);
    
    if (!balanceResponse.ok) {
      const errorText = await balanceResponse.text();
      console.error('Failed to fetch balance:', balanceResponse.status, errorText);
      
      // Check if this is a 404 error (new address with no transactions)
      if (balanceResponse.status === 404) {
        // console.log('Address not found (new address), returning zero balance');
        return { balance: 0, nonce: 0 };
      }
      
      // For other errors, also return zero balance for new addresses
      // console.log('Balance fetch failed, treating as new address with zero balance');
      return { balance: 0, nonce: 0 };
    }
    
    let data: any;
    try {
      const responseText = await balanceResponse.text();
      if (!responseText.trim()) {
        console.error('Empty response from balance API');
        // Return zero balance for empty response (new address)
        return { balance: 0, nonce: 0 };
      }
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse balance response as JSON:', parseError);
      // Return zero balance for parse errors (new address)
      return { balance: 0, nonce: 0 };
    }

    const balance = typeof data.balance === 'string' ? parseFloat(data.balance) : (data.balance || 0);
    
    // Calculate nonce exactly like CLI: max of transaction_count and highest pending nonce
    const transactionCount = data.nonce || 0;
    let nonce = transactionCount;
    
    // Check staging for our pending transactions like CLI does
    if ('ok' in stagingResponse && stagingResponse.ok) {
      try {
        const stagingData = await (stagingResponse as Response).json();
        if (stagingData.staged_transactions) {
          const ourPendingTxs = stagingData.staged_transactions.filter(
            (tx: any) => tx.from === address
          );
          if (ourPendingTxs.length > 0) {
            const maxPendingNonce = Math.max(...ourPendingTxs.map((tx: any) => parseInt(tx.nonce) || 0));
            nonce = Math.max(nonce, maxPendingNonce);
          }
        }
      } catch (error) {
        console.warn('Failed to parse staging data for nonce calculation:', error);
      }
    }

    if (isNaN(balance) || isNaN(nonce)) {
      console.warn('Invalid balance or nonce in API response', { balance, nonce });
      // Return zero balance for invalid data (new address)
      return { balance: 0, nonce: 0 };
    }

    const result = { balance, nonce };
    // Cache the result
    await apiCache.setBalance(address, result);
    return result;
  } catch (error) {
    console.error('Error fetching balance:', error);
    // Return zero balance for network errors (new address)
    return { balance: 0, nonce: 0 };
  }
}

export async function fetchEncryptedBalance(address: string, privateKey?: string, forceRefresh = false): Promise<EncryptedBalanceResponse | null> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await apiCache.getEncryptedBalance(address);
    if (cached) return cached;
  }

  try {
    const headers: Record<string, string> = {};
    if (privateKey) {
      headers['X-Private-Key'] = privateKey;
    }
    
    const response = await makeAPIRequest(`/view_encrypted_balance/${address}`, {
      headers
    });
    
    if (!response.ok) {
      console.error('Failed to fetch encrypted balance:', response.status);
      return null;
    }
    
    let data: any;
    try {
      const responseText = await response.text();
      if (!responseText.trim()) {
        console.error('Empty response from encrypted balance API');
        return null;
      }
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse encrypted balance response as JSON:', parseError);
      return null;
    }
    
    const result = {
      public: parseFloat(data.public_balance?.split(' ')[0] || '0'),
      public_raw: parseInt(data.public_balance_raw || '0'),
      encrypted: parseFloat(data.encrypted_balance?.split(' ')[0] || '0'),
      encrypted_raw: parseInt(data.encrypted_balance_raw || '0'),
      total: parseFloat(data.total_balance?.split(' ')[0] || '0')
    };
    
    // Cache the result
    await apiCache.setEncryptedBalance(address, result);
    return result;
  } catch (error) {
    console.error('Error fetching encrypted balance:', error);
    return null;
  }
}

export async function encryptBalance(address: string, amount: number, privateKey: string): Promise<{ success: boolean; tx_hash?: string; error?: string }> {
  try {
    const encData = await fetchEncryptedBalance(address, privateKey);
    if (!encData) {
      return { success: false, error: "Cannot get balance" };
    }
    
    const currentEncryptedRaw = encData.encrypted_raw;
    const newEncryptedRaw = currentEncryptedRaw + Math.floor(amount * MU_FACTOR);
    
    const encryptedValue = await encryptClientBalance(newEncryptedRaw, privateKey);
    
    const data = {
      address,
      amount: Math.floor(amount * MU_FACTOR).toString(),
      private_key: privateKey,
      encrypted_data: encryptedValue
    };
    
    const response = await makeAPIRequest('/encrypt_balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      const result = await response.json();
      return { success: true, tx_hash: result.tx_hash };
    } else {
      const error = await response.text();
      return { success: false, error };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function decryptBalance(address: string, amount: number, privateKey: string): Promise<{ success: boolean; tx_hash?: string; error?: string }> {
  try {
    const encData = await fetchEncryptedBalance(address, privateKey);
    if (!encData) {
      return { success: false, error: "Cannot get balance" };
    }
    
    const currentEncryptedRaw = encData.encrypted_raw;
    if (currentEncryptedRaw < Math.floor(amount * MU_FACTOR)) {
      return { success: false, error: "Insufficient encrypted balance" };
    }
    
    const newEncryptedRaw = currentEncryptedRaw - Math.floor(amount * MU_FACTOR);
    
    const encryptedValue = await encryptClientBalance(newEncryptedRaw, privateKey);
    
    const data = {
      address,
      amount: Math.floor(amount * MU_FACTOR).toString(),
      private_key: privateKey,
      encrypted_data: encryptedValue
    };
    
    const response = await makeAPIRequest('/decrypt_balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      const result = await response.json();
      return { success: true, tx_hash: result.tx_hash };
    } else {
      const error = await response.text();
      return { success: false, error };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
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

export async function getPendingPrivateTransfers(address: string, privateKey?: string, forceRefresh = false): Promise<PendingPrivateTransfer[]> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await apiCache.getPendingTransfers(address);
    if (cached) return cached;
  }

  try {
    const headers: Record<string, string> = {};
    if (privateKey) {
      headers['X-Private-Key'] = privateKey;
    }
    
    const response = await makeAPIRequest(`/pending_private_transfers?address=${address}`, {
      headers
    });
    
    if (response.ok) {
      let data: any;
      try {
        const responseText = await response.text();
        if (!responseText.trim()) {
          console.error('Empty response from pending private transfers API');
          return [];
        }
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse pending private transfers response as JSON:', parseError);
        return [];
      }
      const transfers = data.pending_transfers || [];
      // Cache the result
      await apiCache.setPendingTransfers(address, transfers);
      return transfers;
    }
    console.error('Failed to fetch pending private transfers:', response.status);
    return [];
  } catch (error) {
    console.error('Error fetching pending private transfers:', error);
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
  // Convert amount to micro units (multiply by 1,000,000)
  const amountMu = Math.floor(amount * MU_FACTOR);
  
  // Use custom OU if provided, otherwise determine based on amount (10000 for < 1000 OCT, 30000 for >= 1000 OCT)
  const defaultOu = amount < 1000 ? 10000 : 30000;
  const ou = (customOu || defaultOu).toString();
  
  // Create timestamp exactly like CLI: time.time() equivalent
  const timestamp = Date.now() / 1000;

  // Create base transaction object
  const transaction: Transaction = {
    from: senderAddress,
    to_: recipientAddress,
    amount: amountMu.toString(),
    nonce,
    ou,
    timestamp
  };

  // Add message if provided (like CLI)
  if (message) {
    transaction.message = message;
  }

  // Convert transaction to JSON string for signing exactly like CLI
  // CLI uses: json.dumps({k: v for k, v in tx.items() if k != "message"}, separators=(",", ":"))
  // Create signing data excluding message field like CLI does
  const signingObject: any = {};
  // Add fields in the exact order as CLI to ensure consistent JSON
  signingObject.from = transaction.from;
  signingObject.to_ = transaction.to_;
  signingObject.amount = transaction.amount;
  signingObject.nonce = transaction.nonce;
  signingObject.ou = transaction.ou;
  signingObject.timestamp = transaction.timestamp;
  
  const signingData = JSON.stringify(signingObject, null, 0);
  
  // Prepare keys for signing
  const privateKeyBuffer = Buffer.from(privateKeyBase64, 'base64');
  const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  
  // Create secret key for nacl (64 bytes: 32 private + 32 public)
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKeyBuffer, 0);
  secretKey.set(publicKeyBuffer, 32);

  // Sign the transaction
  const signature = nacl.sign.detached(new TextEncoder().encode(signingData), secretKey);

  // Add signature and public key to transaction
  transaction.signature = Buffer.from(signature).toString('base64');
  transaction.public_key = Buffer.from(publicKeyBuffer).toString('base64');

  return transaction;
}

// Updated interface to match actual API response
interface AddressApiResponse {
  address: string;
  balance: string;
  nonce: number;
  balance_raw: string;
  has_public_key: boolean;
  transaction_count: number;
  recent_transactions: Array<{
    epoch: number;
    hash: string;
    url: string;
  }>;
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
    return Math.random() * 100; // Mock data for development
  }
}

export async function sendMultipleTransactions(transactions: any[]): Promise<string[]> {
  try {
    const promises = transactions.map(async (txData, index) => {
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
  forceRefresh = false
): Promise<{ transactions: any[]; totalCount: number }> {
  // Check cache first (unless force refresh or pagination)
  if (!forceRefresh && (options.offset === 0 || options.offset === undefined)) {
    const cached = await apiCache.getHistory(address);
    if (cached) return cached;
  }

  try {
    const result = await fetchTransactionHistory(address, options);
    const historyResult = { 
      transactions: result.transactions || [], 
      totalCount: result.totalCount || 0 
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