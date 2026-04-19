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
    const entry = this.memoryCache.balance[address];
    if (this.isValid(entry)) {
      
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
    
    await this.saveToStorage();
  }

  async invalidateBalance(address: string): Promise<void> {
    delete this.memoryCache.balance[address];
    
    await this.saveToStorage();
  }

  // Encrypted balance cache
  async getEncryptedBalance(
    address: string
  ): Promise<EncryptedBalanceResponse | null> {
    const entry = this.memoryCache.encryptedBalance[address];
    if (this.isValid(entry)) {
      
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
    
    await this.saveToStorage();
  }

  async invalidateEncryptedBalance(address: string): Promise<void> {
    delete this.memoryCache.encryptedBalance[address];
    
    await this.saveToStorage();
  }

  // History cache
  async getHistory(address: string): Promise<any | null> {
    const entry = this.memoryCache.history[address];
    if (this.isValid(entry)) {
      
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
    
    await this.saveToStorage();
  }

  async invalidateHistory(address: string): Promise<void> {
    delete this.memoryCache.history[address];
    
    await this.saveToStorage();
  }

  // Pending transfers cache
  async getPendingTransfers(
    address: string
  ): Promise<PendingPrivateTransfer[] | null> {
    const entry = this.memoryCache.pendingTransfers[address];
    if (this.isValid(entry)) {
      
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
    
    await this.saveToStorage();
  }

  async invalidatePendingTransfers(address: string): Promise<void> {
    delete this.memoryCache.pendingTransfers[address];
    
    await this.saveToStorage();
  }

  // Transaction details cache (by hash)
  async getTransactionDetails(hash: string): Promise<TransactionDetails | null> {
    const entry = this.memoryCache.transactionDetails[hash];
    if (this.isValid(entry)) {
      
      return entry!.data;
    }
    return null;
  }

  async setTransactionDetails(_hash: string, _data: TransactionDetails): Promise<void> {
    // DISABLED: Transaction details caching causes quota exceeded errors
    // Don't cache transaction details to save storage space
    
    return;
    
    /* Original code - disabled
    const currentEpoch = await this.getCurrentEpoch();
    this.memoryCache.transactionDetails[hash] = {
      data,
      epoch: currentEpoch,
      timestamp: Date.now(),
    };
    
    await this.saveToStorage();
    */
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
    delete this.memoryCache.balance[address];
    delete this.memoryCache.encryptedBalance[address];
    delete this.memoryCache.history[address];
    delete this.memoryCache.pendingTransfers[address];
    // Note: We don't clear transactionDetails here as they're indexed by hash, not address
    // Transaction details remain cached as they're immutable once confirmed
    
    await this.saveToStorage();
  }

  // FIX #8: Clear wallet nonces cache - called on epoch change
  async invalidateAllWalletNonces(addresses: string[]): Promise<void> {
    for (const address of addresses) {
      delete this.memoryCache.balance[address];
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
    // Better error logging
    if (error instanceof Error) {
      console.error('Failed to parse JSON response:', error.message);
      console.error('Error type:', error.name);
    } else {
      console.error('Failed to parse JSON response:', error);
    }
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
    const response = await makeAPIRequest(`/tx/${hash}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { status: 'not_found' };
      }
      return { status: 'not_found' };
    }
    
    const data = await safeJsonParse(response);
    
    // Check if transaction is in staging (pending)
    if (data.stage_status) {
      return { 
        status: 'pending',
        finality: 'pending'
      };
    }
    
    // Check if transaction is confirmed (has epoch)
    if (data.epoch !== undefined) {
      return { 
        status: 'confirmed',
        finality: 'confirmed'
      };
    }
    
    // Check for rejected status
    if (data.status === 'rejected') {
      return { 
        status: 'rejected',
        finality: 'rejected',
        reason: data.reason
      };
    }
    
    // Check for dropped status
    if (data.status === 'dropped') {
      return { 
        status: 'dropped',
        reason: data.reason
      };
    }
    
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

// WEBCLI LOGIC: Fetch transaction history with proper parsing
export async function fetchTransactionHistory(
  address: string, 
  options: HistoryPaginationOptions = {}
): Promise<AddressHistoryResponse & { totalCount: number }> {
  const { limit = 11, offset = 0 } = options;
  
  try {
    // WEBCLI LOGIC: Fetch confirmed and pending transactions in parallel
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
    
    // WEBCLI LOGIC: Fetch details for each confirmed transaction
    const confirmedTransactionPromises = apiData.recent_transactions.map(async (recentTx) => {
      try {
        const txDetails = await fetchTransactionDetails(recentTx.hash);
        
        // WEBCLI LOGIC: Determine op_type from transaction details
        const opType = txDetails.op_type || txDetails.parsed_tx.op_type || 
          (txDetails.parsed_tx.message === 'PRIVATE_TRANSFER' || 
           txDetails.parsed_tx.message === '505249564154455f5452414e53464552' ? 'private' : 'standard');
        
        // WEBCLI LOGIC: Parse amount from amount_raw or amount field
        let amount = 0;
        if (txDetails.parsed_tx.amount_raw) {
          const amountRaw = typeof txDetails.parsed_tx.amount_raw === 'string'
            ? parseInt(txDetails.parsed_tx.amount_raw, 10)
            : txDetails.parsed_tx.amount_raw;
          amount = amountRaw / MU_FACTOR;
        } else if (txDetails.parsed_tx.amount) {
          amount = parseFloat(txDetails.parsed_tx.amount);
        }
        
        // Transform to our expected format
        return {
          hash: txDetails.tx_hash,
          from: txDetails.parsed_tx.from,
          to: txDetails.parsed_tx.to,
          amount: amount,
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
    
    const confirmedHashes = new Set(confirmedTransactions.map(tx => tx.hash));

    // WEBCLI LOGIC: Format pending transactions
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

    // Log any pending transactions that are also in confirmed (should be filtered out)
    const duplicates = pendingTransactionsFormatted.filter(tx => confirmedHashes.has(tx.hash));
    if (duplicates.length > 0) {
      
    }
    
    // WEBCLI LOGIC: Only include pending transactions on first page (offset === 0)
    // Filter out any pending transactions that are already confirmed
    const pendingToInclude = offset === 0
      ? pendingTransactionsFormatted.filter(tx => !confirmedHashes.has(tx.hash))
      : [];
    
    // WEBCLI LOGIC: Merge and sort by timestamp (newest first)
    // Put confirmed transactions first to ensure they take precedence
    const allTransactions = [...confirmedTransactions, ...pendingToInclude]
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // Additional safety: Remove any duplicate hashes (keep first occurrence which is confirmed)
    const seenHashes = new Set<string>();
    const uniqueTransactions = allTransactions.filter(tx => {
      if (seenHashes.has(tx.hash)) {
        
        return false;
      }
      seenHashes.add(tx.hash);
      return true;
    });
    
    return {
      transactions: uniqueTransactions,
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

export async function fetchTransactionDetails(hash: string, _forceRefresh = false): Promise<TransactionDetails> {
  // DISABLED: Transaction details caching causes quota exceeded errors
  // Always fetch fresh data, don't use cache
  
  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await makeAPIRequest(`/tx/${hash}`);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch transaction details:', response.status, errorText);
      throw new Error(`Error ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    
    // Don't cache to save storage space
    
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
    // WEBCLI LOGIC: Fetch balance and staging in parallel
    const [balanceResponse, stagingResponse] = await Promise.all([
      makeAPIRequest(`/balance/${address}`),
      makeAPIRequest(`/staging`).catch(() => ({ ok: false }))
    ]);
    
    if (!balanceResponse.ok) {
      const errorText = await balanceResponse.text();
      console.error('Failed to fetch balance:', balanceResponse.status, errorText);
      
      // Check if this is a 404 error (new address with no transactions)
      if (balanceResponse.status === 404) {
        return { balance: 0, nonce: 0 };
      }
      
      return { balance: 0, nonce: 0 };
    }
    
    let data: any;
    try {
      const responseText = await balanceResponse.text();
      if (!responseText.trim()) {
        console.error('Empty response from balance API');
        return { balance: 0, nonce: 0 };
      }
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse balance response as JSON:', parseError);
      return { balance: 0, nonce: 0 };
    }

    // WEBCLI LOGIC: Parse balance from balance_raw or balance field
    let balance = 0;
    if (data.balance_raw) {
      // Parse from raw micro units
      const balanceRaw = typeof data.balance_raw === 'string' 
        ? parseInt(data.balance_raw, 10) 
        : data.balance_raw;
      balance = balanceRaw / MU_FACTOR;
    } else if (data.balance !== undefined) {
      balance = typeof data.balance === 'string' ? parseFloat(data.balance) : data.balance;
    }
    
    // WEBCLI LOGIC: Nonce calculation
    // Use pending_nonce if available, otherwise use nonce
    let nonce = data.pending_nonce !== undefined ? data.pending_nonce : (data.nonce || 0);
    
    // WEBCLI LOGIC: Check staging for pending transactions from this address
    // and update nonce to max of pending nonces
    if ('ok' in stagingResponse && stagingResponse.ok) {
      try {
        const stagingData = await (stagingResponse as Response).json();
        if (stagingData.staged_transactions || stagingData.transactions) {
          const transactions = stagingData.staged_transactions || stagingData.transactions || [];
          const ourPendingTxs = transactions.filter(
            (tx: any) => tx.from === address
          );
          if (ourPendingTxs.length > 0) {
            const maxPendingNonce = Math.max(...ourPendingTxs.map((tx: any) => {
              const txNonce = parseInt(tx.nonce, 10);
              return isNaN(txNonce) ? 0 : txNonce;
            }));
            // WEBCLI: nonce = max(current_nonce, max_pending_nonce)
            nonce = Math.max(nonce, maxPendingNonce);
          }
        }
      } catch (error) {
        console.warn('Failed to parse staging data for nonce calculation:', error);
      }
    }

    if (isNaN(balance) || isNaN(nonce)) {
      console.warn('Invalid balance or nonce in API response', { balance, nonce });
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

export async function getPendingPrivateTransfers(_address: string, _privateKey?: string, _forceRefresh = false): Promise<PendingPrivateTransfer[]> {
  // COMING SOON: Private transfer feature will be available in future release
  return [];
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
      
      // Background cache transaction details for confirmed transactions only
      const confirmedHashes = historyResult.transactions
        .filter(tx => tx.status === 'confirmed')
        .map(tx => tx.hash);
      
      if (confirmedHashes.length > 0) {
        // Start background caching (non-blocking)
        apiCache.cacheTransactionDetailsInBackground(confirmedHashes);
      }
    }
    
    return historyResult;
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    return { transactions: [], totalCount: 0 };
  }
}
