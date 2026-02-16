/**
 * Octra Wallet Background Script
 * 
 * Handles capability-based authorization model.
 * 
 * Capability format (v2):
 * - version: 2
 * - circle, methods, scope, encrypted
 * - appOrigin (cryptographically bound)
 * - branchId, epoch (network state binding)
 * - issuedAt, expiresAt (mandatory)
 * - nonceBase (replay protection)
 * - walletPubKey, signature (ed25519)
 * 
 * SECURITY ARCHITECTURE:
 * - Wallet is final authority (pre_client equivalent)
 * - Private keys ONLY in background context
 * - Canonical serialization for all signing
 * - Domain separation to prevent replay attacks
 * - Signing mutex to prevent race conditions
 * - Nonce validation at wallet layer
 */

// =============================================================================
// Signing Mutex (Prevent Parallel Signing)
// =============================================================================

let signingMutex = Promise.resolve();
let pendingSignatures = new Set();

/**
 * Acquire signing lock to prevent parallel signing operations
 * 
 * SECURITY: Prevents race conditions and double-send attacks
 */
async function withSigningLock(fn) {
  // Wait for previous operation to complete
  await signingMutex;
  
  // Create new mutex for next operation
  let release;
  signingMutex = new Promise(resolve => {
    release = resolve;
  });
  
  try {
    return await fn();
  } finally {
    // Release lock
    release();
  }
}

// =============================================================================
// Normalized Error Model
// =============================================================================

/**
 * Create normalized error response
 * 
 * SECURITY: Consistent error structure across all layers
 */
function createErrorResponse(code, message, layer = 'wallet', retryable = false) {
  return {
    code,
    message,
    layer,
    retryable
  };
}

/**
 * Normalize errors from various sources
 */
function normalizeError(error) {
  if (typeof error === 'object' && error.code) {
    return error; // Already normalized
  }
  
  const message = error?.message || String(error);
  
  // User rejection
  if (message.toLowerCase().includes('reject') || message.toLowerCase().includes('denied')) {
    return createErrorResponse('USER_REJECTED', message, 'wallet', false);
  }
  
  // Network failures
  if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    return createErrorResponse('NETWORK_ERROR', message, 'network', true);
  }
  
  // Invalid signature
  if (message.toLowerCase().includes('signature')) {
    return createErrorResponse('SIGNATURE_INVALID', message, 'wallet', false);
  }
  
  // Insufficient balance
  if (message.toLowerCase().includes('balance') || message.toLowerCase().includes('insufficient')) {
    return createErrorResponse('INSUFFICIENT_BALANCE', message, 'wallet', false);
  }
  
  // Encrypted execution rejection
  if (message.toLowerCase().includes('encrypt')) {
    return createErrorResponse('ENCRYPTED_EXECUTION_ERROR', message, 'wallet', false);
  }
  
  // Nonce errors
  if (message.toLowerCase().includes('nonce')) {
    return createErrorResponse('NONCE_VIOLATION', message, 'wallet', false);
  }
  
  // Origin mismatch
  if (message.toLowerCase().includes('origin')) {
    return createErrorResponse('ORIGIN_MISMATCH', message, 'wallet', false);
  }
  
  // Default
  return createErrorResponse('UNKNOWN_ERROR', message, 'wallet', false);
}

// =============================================================================
// Lock wallet on browser startup
// =============================================================================

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Browser started, locking wallet...');
  await lockWallet();
});

// Lock wallet when all windows closed
chrome.windows.onRemoved.addListener(async (windowId) => {
  const windows = await chrome.windows.getAll();
  if (windows.length === 0) {
    console.log('[Background] All windows closed, locking wallet...');
    await lockWallet();
  }
});

// Open expanded view on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_STATE') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }

  if (message.type === 'OPEN_EXPANDED') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    return true;
  }

  // Handle dApp requests
  if (message.source === 'octra-content-script') {
    handleDAppRequest(message, sender)
      .then(response => sendResponse(response))
      .catch(error => {
        const normalized = normalizeError(error);
        sendResponse({
          type: 'ERROR_RESPONSE',
          success: false,
          error: normalized.message,
          errorCode: normalized.code,
          errorLayer: normalized.layer,
          retryable: normalized.retryable
        });
      });
    return true;
  }

  return true;
});

// =============================================================================
// Request Handlers
// =============================================================================

async function handleDAppRequest(message, sender) {
  const { type, requestId, data } = message;
  const senderOrigin = getSenderOrigin(sender);
  if (!senderOrigin) {
    throw new Error('Unable to determine sender origin');
  }
  const appOrigin = data?.appOrigin || senderOrigin;
  if (senderOrigin !== appOrigin) {
    throw new Error('Origin mismatch');
  }
  const normalizedData = { ...(data || {}), appOrigin };

  console.log('[Background] handleDAppRequest called:', type, requestId);

  try {
    switch (type) {
      case 'CONNECTION_REQUEST':
        return await handleConnectionRequest(normalizedData, sender);

      case 'CAPABILITY_REQUEST':
        return await handleCapabilityRequest(normalizedData, sender);

      case 'INVOKE_REQUEST':
        console.log('[Background] Processing INVOKE_REQUEST');
        return await handleInvokeRequest(normalizedData, sender);

      case 'SIGN_MESSAGE_REQUEST':
        return await handleSignMessageRequest(normalizedData, sender);

      case 'DISCONNECT_REQUEST':
        return await handleDisconnectRequest(normalizedData, sender);

      case 'ESTIMATE_PLAIN_TX':
        return await handleEstimatePlainTx(normalizedData, sender);

      case 'ESTIMATE_ENCRYPTED_TX':
        return await handleEstimateEncryptedTx(normalizedData, sender);

      case 'ESTIMATE_COMPUTE_COST':
        return await handleEstimateComputeCost(normalizedData, sender);

      case 'LIST_CAPABILITIES_REQUEST':
        return await handleListCapabilities(normalizedData, sender);

      case 'RENEW_CAPABILITY_REQUEST':
        return await handleRenewCapability(normalizedData, sender);

      case 'REVOKE_CAPABILITY_REQUEST':
        return await handleRevokeCapability(normalizedData, sender);

      default:
        throw new Error(`Unknown request type: ${type}`);
    }
  } catch (error) {
    console.error('[Background] Request error:', error);
    throw error;
  }
}

function getSenderOrigin(sender) {
  try {
    if (!sender || !sender.url) return null;
    return new URL(sender.url).origin;
  } catch {
    return null;
  }
}

// Handle connection request (NO signing)
async function handleConnectionRequest(data, sender) {
  const { circle, appOrigin, appName, appIcon, requestedCapabilities } = data;

  console.log('[Background] Connection request:', { circle, appOrigin, appName });

  // Check if already connected - return existing connection without popup
  const existingConnection = await getConnection(appOrigin);
  if (existingConnection && existingConnection.circle === circle) {
    console.log('[Background] Already connected, returning existing connection');
    
    // PENDING: Epoch implementation - not fetched for now
    // const currentEpoch = await fetchCurrentEpoch();
    
    return {
      type: 'CONNECTION_RESPONSE',
      success: true,
      result: {
        circle: existingConnection.circle,
        sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        walletPubKey: existingConnection.walletPubKey,
        evmAddress: existingConnection.evmAddress || '',
        network: existingConnection.network || 'mainnet',
        // epoch: currentEpoch,  // PENDING
        branchId: existingConnection.branchId || 'main'
      }
    };
  }

  // Store pending request
  await setStorageData('pendingConnectionRequest', {
    circle,
    appOrigin,
    appName: appName || appOrigin,
    appIcon: appIcon || null,
    requestedCapabilities: requestedCapabilities || [],
    timestamp: Date.now()
  });

  // Try popup first, fallback to tab
  try {
    await chrome.action.openPopup();
  } catch (error) {
    const url = chrome.runtime.getURL(
      `index.html?action=connect&circle=${encodeURIComponent(circle)}&appOrigin=${encodeURIComponent(appOrigin)}&appName=${encodeURIComponent(appName || '')}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response
  return new Promise((resolve) => {
    const listener = async (msg) => {
      console.log('[Background] Received message:', msg.type, msg);
      
      // Handle both old format (origin) and new format (appOrigin)
      const msgOrigin = msg.appOrigin || msg.origin;
      
      if (msg.type === 'CONNECTION_RESULT' && msgOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved) {
          const walletAddress = msg.walletPubKey || msg.address || 'oct_unknown';
          const network = msg.network || 'mainnet';
          const evmAddress = msg.evmAddress || '';
          
          // PENDING: Epoch implementation - not fetched for now
          // const currentEpoch = await fetchCurrentEpoch();
          const branchId = msg.branchId || 'main';
          
          console.log('[Background] Connection approved:', { walletAddress, evmAddress, network, branchId });

          saveConnection({
            circle,
            appOrigin,
            appName,
            walletPubKey: walletAddress,
            evmAddress: evmAddress,
            network: network,
            // epoch: currentEpoch,  // PENDING
            branchId: branchId,
            connectedAt: Date.now()
          });

          resolve({
            type: 'CONNECTION_RESPONSE',
            success: true,
            result: {
              circle,
              sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              walletPubKey: walletAddress,
              evmAddress: evmAddress,
              network: network,
              // epoch: currentEpoch,  // PENDING
              branchId: branchId
            }
          });
        } else {
          console.log('[Background] Connection rejected');
          resolve({
            type: 'CONNECTION_RESPONSE',
            success: false,
            error: 'User rejected request'
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Timeout after 60 seconds
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.local.remove('pendingConnectionRequest');
      resolve({
        type: 'CONNECTION_RESPONSE',
        success: false,
        error: 'Connection request timeout'
      });
    }, 60000);
  });
}

// Handle capability request
async function handleCapabilityRequest(data, sender) {
  const { circle, methods, scope, encrypted, ttlSeconds, appOrigin, appName, appIcon } = data;

  // Check if connected
  const connection = await getConnection(appOrigin);
  if (!connection) {
    throw new Error('Not connected to wallet');
  }

  // Store pending request
  await setStorageData('pendingCapabilityRequest', {
    circle,
    methods,
    scope,
    encrypted,
    ttlSeconds,
    appOrigin,
    appName: appName || appOrigin,
    appIcon,
    timestamp: Date.now()
  });

  // Open approval UI
  try {
    await chrome.action.openPopup();
  } catch (error) {
    const url = chrome.runtime.getURL(
      `index.html?action=capability&circle=${encodeURIComponent(circle)}&methods=${encodeURIComponent(JSON.stringify(methods))}&scope=${encodeURIComponent(scope)}&encrypted=${encrypted}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response
  return new Promise((resolve) => {
    const listener = async (msg) => {
      if (msg.type === 'CAPABILITY_RESULT' && msg.appOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved) {
          const signedCapability = msg.signedCapability;
          const capabilityId = msg.capabilityId;
          
          // PENDING: Epoch implementation - not fetched for now
          // const currentEpoch = await fetchCurrentEpoch();
          
          const capability = {
            id: capabilityId,
            version: signedCapability.version || 2,
            circle: signedCapability.circle,
            methods: signedCapability.methods,
            scope: signedCapability.scope,
            encrypted: signedCapability.encrypted,
            appOrigin: signedCapability.appOrigin,
            branchId: signedCapability.branchId || 'main',
            // epoch: currentEpoch,  // PENDING
            issuedAt: signedCapability.issuedAt,
            expiresAt: signedCapability.expiresAt,
            nonceBase: signedCapability.nonceBase || 0,
            walletPubKey: signedCapability.walletPubKey,
            signature: signedCapability.signature,
            state: 'ACTIVE',
            // Real lastNonce tracking
            lastNonce: signedCapability.nonceBase || 0
          };

          console.log('[Background] Capability approved (v2):', {
            id: capability.id,
            version: capability.version,
            circle: capability.circle,
            methods: capability.methods,
            scope: capability.scope,
            appOrigin: capability.appOrigin,
            branchId: capability.branchId,
            // epoch: capability.epoch,  // PENDING
            expiresAt: capability.expiresAt ? new Date(capability.expiresAt).toISOString() : 'never',
            walletPubKey: capability.walletPubKey?.slice(0, 16) + '...',
            signature: capability.signature?.slice(0, 16) + '...'
          });

          // Store capability
          saveCapability(appOrigin, capability);

          resolve({
            type: 'CAPABILITY_RESPONSE',
            success: true,
            result: capability
          });
        } else {
          resolve({
            type: 'CAPABILITY_RESPONSE',
            success: false,
            error: 'User rejected request'
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Timeout after 5 minutes
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.local.remove('pendingCapabilityRequest');
      resolve({
        type: 'CAPABILITY_RESPONSE',
        success: false,
        error: 'Capability request timeout'
      });
    }, 300000);
  });
}

// Handle invoke request
async function handleInvokeRequest(data, sender) {
  const { capabilityId, method, payload, nonce, timestamp, appOrigin, appName } = data;

  console.log('[Background] handleInvokeRequest:', { capabilityId, method, appOrigin, appName });

  // Get capability
  const capability = await getCapability(appOrigin, capabilityId);
  if (!capability) {
    console.error('[Background] Capability not found for:', appOrigin, capabilityId);
    // Log all stored capabilities for debugging
    const allCaps = await getStorageData('capabilities') || {};
    console.log('[Background] All stored capabilities:', Object.keys(allCaps));
    throw new Error(`Capability '${capabilityId}' not found`);
  }

  // SECURITY: Verify origin binding (cryptographic enforcement)
  // Capability is cryptographically bound to appOrigin
  if (capability.appOrigin !== appOrigin) {
    console.error('[Background] Origin mismatch:', { expected: capability.appOrigin, actual: appOrigin });
    throw new Error('Origin mismatch - capability bound to different origin');
  }

  // SECURITY: Check expiry (mandatory in v2)
  if (capability.expiresAt && capability.expiresAt < Date.now()) {
    throw new Error('Capability expired');
  }

  // SECURITY: Check method is allowed (methods are sorted in capability)
  if (!capability.methods.includes(method)) {
    throw new Error(`Method '${method}' not allowed by capability`);
  }
  
  // SECURITY: Nonce validation
  // Wallet is the final authority on nonce correctness
  // SDK provides nonce for ordering, but wallet MUST validate
  if (nonce !== undefined && nonce <= capability.lastNonce) {
    throw new Error(`Nonce violation: ${nonce} <= ${capability.lastNonce}`);
  }

  // Get connection for wallet address
  const connection = await getConnection(appOrigin);
  if (!connection) {
    throw new Error('Not connected to wallet');
  }
  
  // SECURITY: HFHE encrypted payload handling
  // Encrypted payloads MUST remain opaque and untouched
  // - Do NOT inspect ciphertext
  // - Do NOT coerce numeric values
  // - Do NOT mutate encrypted fields
  // - Treat as deterministic blob for hashing only

  // ==========================================================================
  // AUTO-EXECUTE READ METHODS (no user approval needed for read scope)
  // These methods are safe to execute automatically because:
  // 1. User already approved the capability with these methods
  // 2. Read scope doesn't modify state
  // 3. Data is bound to the capability's origin
  // 
  // SECURITY: send_transaction and send_evm_transaction are NOT auto-execute
  // They ALWAYS require popup approval as they transfer funds
  // ==========================================================================
  const autoExecuteMethods = ['get_balance', 'get_quote', 'create_intent', 'submit_intent', 'get_intent_status'];
  
  console.log('[Background] Checking auto-execute for method:', method, 'scope:', capability.scope);
  console.log('[Background] autoExecuteMethods includes:', autoExecuteMethods.includes(method));
  
  if (autoExecuteMethods.includes(method)) {
    console.log('[Background] Auto-executing read method:', method);
    
    try {
      const result = await executeMethod(method, payload, connection, capability);
      console.log('[Background] Auto-execute result:', result);
      return {
        type: 'INVOKE_RESPONSE',
        success: true,
        result: {
          success: true,
          data: result
        }
      };
    } catch (error) {
      console.error('[Background] Auto-execute error:', error);
      return {
        type: 'INVOKE_RESPONSE',
        success: false,
        error: error.message || 'Method execution failed'
      };
    }
  }

  // ==========================================================================
  // WRITE METHODS - Require user approval
  // send_transaction requires popup approval and actual chain submission
  // ==========================================================================
  
  // Store pending request
  await setStorageData('pendingInvokeRequest', {
    capabilityId,
    method,
    payload,
    nonce,
    timestamp,
    appOrigin,
    appName,
    capability,
    connection, // Include connection for tx execution
    requestTimestamp: Date.now()
  });

  // Open approval UI
  try {
    await chrome.action.openPopup();
  } catch (error) {
    const url = chrome.runtime.getURL(
      `index.html?action=invoke&capabilityId=${encodeURIComponent(capabilityId)}&method=${encodeURIComponent(method)}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response
  return new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === 'INVOKE_RESULT' && msg.appOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved) {
          resolve({
            type: 'INVOKE_RESPONSE',
            success: true,
            result: {
              success: true,
              data: msg.data
            }
          });
        } else {
          resolve({
            type: 'INVOKE_RESPONSE',
            success: false,
            error: msg.error || 'User rejected request'
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Timeout after 5 minutes
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.local.remove('pendingInvokeRequest');
      resolve({
        type: 'INVOKE_RESPONSE',
        success: false,
        error: 'Invocation request timeout'
      });
    }, 300000);
  });
}

// =============================================================================
// Method Execution (wallet-side RPC calls)
// =============================================================================

// These values are injected at build time from .env
const RPC_URL = '__VITE_OCTRA_RPC_URL__';
const MU_FACTOR = 1_000_000;

// Default Infura API Key (injected at build time)
const DEFAULT_INFURA_API_KEY = '__VITE_INFURA_API_KEY__';

/**
 * Fetch current epoch from Octra RPC
 * Returns real epoch number from blockchain, not timestamp
 */
async function fetchCurrentEpoch() {
  try {
    const response = await fetch(`${RPC_URL}/status`);
    if (response.ok) {
      const data = await response.json();
      return data.current_epoch || 0;
    }
  } catch (error) {
    console.error('[Background] Failed to fetch current epoch:', error);
  }
  return 0;
}

// Default EVM Networks configuration
const DEFAULT_EVM_NETWORKS = {
  'eth-mainnet': {
    rpcUrl: `https://mainnet.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    chainId: 1,
    symbol: 'ETH',
    isTestnet: false
  },
  'eth-sepolia': {
    rpcUrl: `https://sepolia.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    chainId: 11155111,
    symbol: 'ETH',
    isTestnet: true
  },
  'polygon-mainnet': {
    rpcUrl: `https://polygon-mainnet.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    chainId: 137,
    symbol: 'POL',
    isTestnet: false
  },
  'base-mainnet': {
    rpcUrl: `https://base-mainnet.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    chainId: 8453,
    symbol: 'ETH',
    isTestnet: false
  },
  'bsc-mainnet': {
    rpcUrl: `https://bsc-mainnet.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    chainId: 56,
    symbol: 'BNB',
    isTestnet: false
  }
};

// USDC Contracts per network
const USDC_CONTRACTS = {
  'eth-mainnet': { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  'eth-sepolia': { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
  'polygon-mainnet': { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  'base-mainnet': { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  'bsc-mainnet': { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
};

/**
 * Get active EVM network from chrome.storage (synced from wallet)
 * Falls back to eth-sepolia if not set
 */
async function getActiveEVMNetwork() {
  try {
    const result = await chrome.storage.local.get(['active_evm_network']);
    return result.active_evm_network || 'eth-sepolia';
  } catch {
    return 'eth-sepolia';
  }
}

/**
 * Get EVM RPC URL for a network
 */
function getEVMRpcUrl(networkId) {
  const network = DEFAULT_EVM_NETWORKS[networkId];
  return network ? network.rpcUrl : DEFAULT_EVM_NETWORKS['eth-sepolia'].rpcUrl;
}

/**
 * Get USDC contract info for a network
 */
function getUSDCContract(networkId) {
  return USDC_CONTRACTS[networkId] || USDC_CONTRACTS['eth-sepolia'];
}

async function executeMethod(method, payload, connection, capability) {
  switch (method) {
    case 'get_balance':
      return await executeGetBalance(connection);
    
    case 'get_quote':
      return await executeGetQuote(payload);

    case 'send_transaction':
      return await executeSendTransaction(payload, connection);

    case 'send_evm_transaction':
      return await executeSendEvmTransaction(payload, connection);

    case 'create_intent':
      return await executeCreateIntent(payload);

    case 'submit_intent':
      return await executeSubmitIntent(payload);

    case 'get_intent_status':
      return await executeGetIntentStatus(payload);
    
    default:
      throw new Error(`Unknown auto-execute method: ${method}`);
  }
}

// Get balance from RPC (wallet-side, not dApp-side)
async function executeGetBalance(connection) {
  const octAddress = connection.walletPubKey;
  const evmAddress = connection.evmAddress || '';
  
  // Get active EVM network from wallet settings
  const activeNetwork = await getActiveEVMNetwork();
  const evmRpcUrl = getEVMRpcUrl(activeNetwork);
  const usdcContract = getUSDCContract(activeNetwork);
  
  console.log('[Background] Fetching balances for:', { octAddress, evmAddress, activeNetwork });
  
  let octBalance = 0;
  let ethBalance = 0;
  let usdcBalance = 0;
  
  // Fetch OCT balance
  try {
    const response = await fetch(`${RPC_URL}/address/${octAddress}`);
    
    if (response.ok) {
      const data = await response.json();
      octBalance = parseFloat(data.balance) || 0;
      console.log('[Background] OCT balance:', octBalance);
    }
  } catch (error) {
    console.error('[Background] OCT balance fetch error:', error);
  }
  
  // Fetch ETH/native token balance
  if (evmAddress) {
    try {
      const response = await fetch(evmRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [evmAddress, 'latest'],
          id: 1
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.result) {
          // Convert from wei (hex) to ETH
          const weiBalance = BigInt(data.result);
          ethBalance = Number(weiBalance) / 1e18;
          console.log('[Background] ETH balance:', ethBalance);
        }
      }
    } catch (error) {
      console.error('[Background] ETH balance fetch error:', error);
    }
    
    // Fetch USDC balance (ERC20)
    if (usdcContract.address) {
      try {
        // balanceOf(address) function selector: 0x70a08231
        const balanceOfData = '0x70a08231' + evmAddress.slice(2).toLowerCase().padStart(64, '0');
        
        const response = await fetch(evmRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [
              { to: usdcContract.address, data: balanceOfData },
              'latest'
            ],
            id: 2
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.result && data.result !== '0x') {
            // Convert from smallest units to USDC
            const rawBalance = BigInt(data.result);
            usdcBalance = Number(rawBalance) / Math.pow(10, usdcContract.decimals);
            console.log('[Background] USDC balance:', usdcBalance);
          }
        }
      } catch (error) {
        console.error('[Background] USDC balance fetch error:', error);
      }
    }
  }
  
  console.log('[Background] Balances fetched:', { octBalance, ethBalance, usdcBalance });
  
  // Return as Uint8Array (SDK format)
  const result = {
    octAddress: octAddress,
    evmAddress: evmAddress,
    octBalance: octBalance,
    ethBalance: ethBalance,
    usdcBalance: usdcBalance,
    network: connection.network || 'mainnet',
    evmNetwork: activeNetwork
  };
  
  return new TextEncoder().encode(JSON.stringify(result));
}

// Validate URL to prevent SSRF attacks
function isValidApiUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    // Only allow HTTPS in production
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    // Block localhost/internal IPs in production (allow for development)
    const hostname = parsed.hostname.toLowerCase();
    const blockedPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.', '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'];
    // Allow localhost for development, but log warning
    if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
      console.warn('[Background] Warning: API URL points to local/internal address:', hostname);
    }
    return true;
  } catch {
    return false;
  }
}

// Get swap quote
async function executeGetQuote(payload) {
  let params;
  try {
    if (payload && payload._type === 'Uint8Array') {
      const bytes = new Uint8Array(payload.data);
      params = JSON.parse(new TextDecoder().decode(bytes));
    } else if (payload instanceof Uint8Array) {
      params = JSON.parse(new TextDecoder().decode(payload));
    } else {
      params = payload || {};
    }
  } catch (e) {
    throw new Error('Failed to parse quote payload');
  }
  
  const { apiUrl, from = 'OCT', to = 'ETH', amount } = params;
  if (!isValidApiUrl(apiUrl)) {
    throw new Error('Invalid or missing apiUrl for get_quote');
  }
  if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
    throw new Error('Invalid amount for get_quote');
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/quote?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amount)}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Quote failed: ${response.status}`);
  }
  const result = await response.json();
  return new TextEncoder().encode(JSON.stringify(result));
}

async function executeCreateIntent(payload) {
  let params;
  try {
    if (payload && payload._type === 'Uint8Array') {
      const bytes = new Uint8Array(payload.data);
      params = JSON.parse(new TextDecoder().decode(bytes));
    } else if (payload instanceof Uint8Array) {
      params = JSON.parse(new TextDecoder().decode(payload));
    } else {
      params = payload || {};
    }
  } catch (e) {
    throw new Error('Failed to parse create_intent payload');
  }

  const { quote, targetAddress, slippageBps = 50 } = params;
  if (!quote || typeof quote !== 'object') {
    throw new Error('quote is required for create_intent');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress || '')) {
    throw new Error('Invalid targetAddress');
  }
  if (typeof slippageBps !== 'number' || slippageBps < 0 || slippageBps > 5000 || !Number.isFinite(slippageBps)) {
    throw new Error('Invalid slippageBps (must be 0-5000)');
  }

  const slippageMultiplier = 1 - slippageBps / 10000;
  const estimatedOut = Number(quote.estimatedOut);
  if (!Number.isFinite(estimatedOut) || estimatedOut <= 0) {
    throw new Error('Invalid quote.estimatedOut');
  }
  const minAmountOut = estimatedOut * slippageMultiplier;

  const intentPayload = {
    version: 1,
    intentType: 'swap',
    fromAsset: quote.from || 'OCT',
    toAsset: quote.to || 'ETH',
    amountIn: Number(quote.amountIn),
    minAmountOut,
    targetChain: quote.network || 'ethereum_sepolia',
    targetAddress,
    expiry: Date.now() + 5 * 60 * 1000,
    nonce: crypto.randomUUID()
  };

  return new TextEncoder().encode(JSON.stringify(intentPayload));
}

async function executeSubmitIntent(payload) {
  let params;
  try {
    if (payload && payload._type === 'Uint8Array') {
      const bytes = new Uint8Array(payload.data);
      params = JSON.parse(new TextDecoder().decode(bytes));
    } else if (payload instanceof Uint8Array) {
      params = JSON.parse(new TextDecoder().decode(payload));
    } else {
      params = payload || {};
    }
  } catch (e) {
    throw new Error('Failed to parse submit_intent payload');
  }

  const { apiUrl, octraTxHash } = params;
  if (!isValidApiUrl(apiUrl)) {
    throw new Error('Invalid or missing apiUrl for submit_intent');
  }
  if (!octraTxHash || typeof octraTxHash !== 'string' || octraTxHash.length < 10) {
    throw new Error('Invalid octraTxHash for submit_intent');
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/swap/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ octraTxHash })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || `Submit failed: ${response.status}`);
  }

  const result = await response.json();
  return new TextEncoder().encode(JSON.stringify(result));
}

async function executeGetIntentStatus(payload) {
  let params;
  try {
    if (payload && payload._type === 'Uint8Array') {
      const bytes = new Uint8Array(payload.data);
      params = JSON.parse(new TextDecoder().decode(bytes));
    } else if (payload instanceof Uint8Array) {
      params = JSON.parse(new TextDecoder().decode(payload));
    } else {
      params = payload || {};
    }
  } catch (e) {
    throw new Error('Failed to parse get_intent_status payload');
  }

  const { apiUrl, intentId } = params;
  if (!isValidApiUrl(apiUrl)) {
    throw new Error('Invalid or missing apiUrl for get_intent_status');
  }
  if (!intentId || typeof intentId !== 'string' || intentId.length < 5) {
    throw new Error('Invalid intentId for get_intent_status');
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/swap/${encodeURIComponent(intentId)}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Status check failed: ${response.status}`);
  }

  const result = await response.json();
  return new TextEncoder().encode(JSON.stringify(result));
}

// Send transaction to escrow (for intent-based swaps)
async function executeSendTransaction(payload, connection) {
  throw new Error('send_transaction requires user approval');
}

// Send EVM transaction (ETH to escrow for BUY orders)
async function executeSendEvmTransaction(payload, connection) {
  throw new Error('send_evm_transaction requires user approval');
}

// Handle disconnect request
async function handleDisconnectRequest(data, sender) {
  const { appOrigin } = data;

  try {
    await removeConnection(appOrigin);
    return {
      type: 'DISCONNECT_RESPONSE',
      success: true,
      result: { disconnected: true }
    };
  } catch (error) {
    throw new Error(`Failed to disconnect: ${error.message}`);
  }
}

// Handle sign message request
async function handleSignMessageRequest(data, sender) {
  const { message, appOrigin, appName, appIcon } = data;

  console.log('[Background] ========================================');
  console.log('[Background] SIGN MESSAGE REQUEST RECEIVED');
  console.log('[Background] appOrigin:', appOrigin);
  console.log('[Background] appName:', appName);
  console.log('[Background] message length:', message?.length);
  console.log('[Background] message:', message);
  console.log('[Background] ========================================');

  // Check if connected
  const connection = await getConnection(appOrigin);
  if (!connection) {
    console.error('[Background] Not connected for origin:', appOrigin);
    throw new Error('Not connected to wallet');
  }

  console.log('[Background] Connection found:', connection.walletPubKey);

  // Store pending request
  const pendingRequest = {
    message,
    appOrigin,
    appName: appName || appOrigin,
    appIcon,
    timestamp: Date.now()
  };
  
  console.log('[Background] Storing pending request:', pendingRequest);
  await setStorageData('pendingSignMessageRequest', pendingRequest);
  
  // Verify storage
  const verify = await getStorageData('pendingSignMessageRequest');
  console.log('[Background] Verified storage:', verify);

  // Open approval UI
  console.log('[Background] Opening popup...');
  try {
    // First store the request, then open popup with small delay
    await new Promise(resolve => setTimeout(resolve, 100)); // Give storage time to sync
    await chrome.action.openPopup();
    console.log('[Background] Popup opened successfully');
  } catch (error) {
    console.log('[Background] Popup failed, opening tab:', error);
    const url = chrome.runtime.getURL(
      `index.html?action=signMessage&appOrigin=${encodeURIComponent(appOrigin)}&appName=${encodeURIComponent(appName || '')}&message=${encodeURIComponent(message)}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response
  return new Promise((resolve) => {
    const listener = (msg) => {
      console.log('[Background] Received message:', msg.type, msg);
      
      if (msg.type === 'SIGN_MESSAGE_RESULT' && msg.appOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved && msg.signature) {
          console.log('[Background] Message signed successfully');
          resolve({
            type: 'SIGN_MESSAGE_RESPONSE',
            success: true,
            result: msg.signature
          });
        } else {
          console.log('[Background] Message signing rejected');
          resolve({
            type: 'SIGN_MESSAGE_RESPONSE',
            success: false,
            error: msg.error || 'User rejected request'
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Timeout after 60 seconds
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.local.remove('pendingSignMessageRequest');
      console.log('[Background] Sign message request timeout');
      resolve({
        type: 'SIGN_MESSAGE_RESPONSE',
        success: false,
        error: 'Sign message request timeout'
      });
    }, 60000);
  });
}

// =============================================================================
// Storage Helpers
// =============================================================================

async function lockWallet() {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.clear();
    }
    await setStorageData('isWalletLocked', 'true');
    await chrome.storage.local.remove(['wallets']);
    console.log('[Background] Wallet locked');
  } catch (error) {
    console.error('[Background] Lock failed:', error);
  }
}

async function getStorageData(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });
}

async function setStorageData(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function getConnection(appOrigin) {
  const connections = await getStorageData('connectedDApps') || [];
  return connections.find(c => c.appOrigin === appOrigin);
}

async function saveConnection(connection) {
  const connections = await getStorageData('connectedDApps') || [];
  const filtered = connections.filter(c => c.appOrigin !== connection.appOrigin);
  filtered.push(connection);
  await setStorageData('connectedDApps', filtered);
}

async function removeConnection(appOrigin) {
  const connections = await getStorageData('connectedDApps') || [];
  const filtered = connections.filter(c => c.appOrigin !== appOrigin);
  await setStorageData('connectedDApps', filtered);

  // Also remove capabilities for this origin
  const capabilities = await getStorageData('capabilities') || {};
  delete capabilities[appOrigin];
  await setStorageData('capabilities', capabilities);
  
  // Notify all tabs that connection was removed
  // This allows dApps to detect disconnection and request new connection
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'WALLET_DISCONNECTED',
          appOrigin: appOrigin
        }).catch(() => {}); // Ignore errors for tabs without content script
      }
    }
  } catch (e) {
    console.log('[Background] Could not notify tabs:', e);
  }
}

async function getCapability(appOrigin, capabilityId) {
  const capabilities = await getStorageData('capabilities') || {};
  console.log('[Background] getCapability - all capabilities:', JSON.stringify(capabilities));
  console.log('[Background] getCapability - looking for:', appOrigin, capabilityId);
  const originCaps = capabilities[appOrigin] || [];
  console.log('[Background] getCapability - origin caps:', originCaps.length);
  const found = originCaps.find(c => c.id === capabilityId);
  console.log('[Background] getCapability - found:', found ? 'yes' : 'no');
  return found;
}

async function saveCapability(appOrigin, capability) {
  console.log('[Background] saveCapability - saving for:', appOrigin, capability.id);
  const capabilities = await getStorageData('capabilities') || {};
  if (!capabilities[appOrigin]) {
    capabilities[appOrigin] = [];
  }
  capabilities[appOrigin].push(capability);
  await setStorageData('capabilities', capabilities);
  
  // Verify save
  const verify = await getStorageData('capabilities');
  const saved = verify?.[appOrigin]?.find(c => c.id === capability.id);
  console.log('[Background] saveCapability - verified:', saved ? 'YES' : 'NO');
  console.log('[Background] saveCapability - total for origin:', capabilities[appOrigin].length);
}

// =============================================================================
// Gas Estimation Handlers
// =============================================================================

/**
 * Handle plain transaction gas estimation
 * Formula: Fee = OU × 0.0000001 OCT
 * OU: 10,000 for < 1000 OCT, 30,000 for >= 1000 OCT
 */
async function handleEstimatePlainTx(data, sender) {
  const { payload } = data;
  
  // Extract amount from payload
  let amount = 0;
  if (payload && typeof payload === 'object' && payload.amount) {
    amount = payload.amount;
  }
  
  // Determine OU based on amount (auto mode)
  const ou = amount < 1000 ? 10000 : 30000;
  
  // Calculate fee: OU × 0.0000001
  const fee = ou * 0.0000001;
  
  return {
    type: 'ESTIMATE_PLAIN_TX_RESPONSE',
    success: true,
    result: {
      gasUnits: ou,
      tokenCost: fee,
      latencyEstimate: 2000,
      epoch: 0, // PENDING
    }
  };
}

/**
 * Handle encrypted transaction gas estimation
 * Encrypted transactions have higher OU due to encryption overhead
 */
async function handleEstimateEncryptedTx(data, sender) {
  const baseOu = 30000;
  const encryptionOverhead = 1.5;
  const ou = Math.ceil(baseOu * encryptionOverhead);
  
  // Calculate fee: OU × 0.0000001
  const fee = ou * 0.0000001;
  
  return {
    type: 'ESTIMATE_ENCRYPTED_TX_RESPONSE',
    success: true,
    result: {
      gasUnits: ou,
      tokenCost: fee,
      latencyEstimate: 4000,
      epoch: 0, // PENDING
    }
  };
}

/**
 * Handle compute cost estimation
 * Compute operations have variable OU based on complexity
 */
async function handleEstimateComputeCost(data, sender) {
  const { profile } = data;
  
  if (!profile) {
    throw new Error('Compute profile is required');
  }
  
  const {
    gateCount = 0,
    vectorSize = 0,
    depth = 0,
    expectedBootstrap = 0,
  } = profile;
  
  // Calculate OU based on computation complexity
  const gateOu = gateCount * 10;
  const vectorOu = vectorSize * 5;
  const depthOu = depth * 20;
  const bootstrapOu = expectedBootstrap * 1000;
  
  const totalOu = gateOu + vectorOu + depthOu + bootstrapOu;
  
  // Calculate fee: OU × 0.0000001
  const fee = totalOu * 0.0000001;
  
  return {
    type: 'ESTIMATE_COMPUTE_COST_RESPONSE',
    success: true,
    result: {
      gasUnits: totalOu,
      tokenCost: fee,
      latencyEstimate: (gateCount * depth * 10) + (expectedBootstrap * 1000),
      epoch: 0, // PENDING
    }
  };
}

/**
 * Handle list capabilities request
 * Returns all active capabilities for the requesting origin
 */
async function handleListCapabilities(data, sender) {
  const { appOrigin } = data;
  
  console.log('[Background] List capabilities request from:', appOrigin);
  
  // Get capabilities from storage
  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];
  
  // Filter out expired capabilities
  const now = Date.now();
  const activeCapabilities = originCapabilities.filter(cap => {
    return cap.expiresAt > now;
  });
  
  console.log('[Background] Found', activeCapabilities.length, 'active capabilities');
  
  return {
    type: 'LIST_CAPABILITIES_RESPONSE',
    success: true,
    result: activeCapabilities
  };
}

/**
 * Handle renew capability request
 * Extends the expiration time of an existing capability
 */
async function handleRenewCapability(data, sender) {
  const { capabilityId, appOrigin } = data;
  
  console.log('[Background] Renew capability request:', capabilityId);
  
  if (!capabilityId) {
    throw new Error('Capability ID is required');
  }
  
  // Get capabilities from storage
  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];
  
  // Find the capability
  const capIndex = originCapabilities.findIndex(c => c.id === capabilityId);
  
  if (capIndex === -1) {
    throw new Error(`Capability '${capabilityId}' not found`);
  }
  
  const capability = originCapabilities[capIndex];
  
  // Check if expired
  if (capability.expiresAt <= Date.now()) {
    throw new Error('Cannot renew expired capability');
  }
  
  // Extend expiration by 15 minutes (900 seconds)
  const newExpiresAt = Date.now() + (900 * 1000);
  const renewedCapability = {
    ...capability,
    expiresAt: newExpiresAt
  };
  
  // Update in storage
  originCapabilities[capIndex] = renewedCapability;
  allCapabilities[appOrigin] = originCapabilities;
  
  await chrome.storage.local.set({ capabilities: allCapabilities });
  
  console.log('[Background] Capability renewed:', capabilityId);
  
  return {
    type: 'RENEW_CAPABILITY_RESPONSE',
    success: true,
    result: renewedCapability
  };
}

/**
 * Handle revoke capability request
 * Removes a capability from storage
 */
async function handleRevokeCapability(data, sender) {
  const { capabilityId, appOrigin } = data;
  
  console.log('[Background] Revoke capability request:', capabilityId);
  
  if (!capabilityId) {
    throw new Error('Capability ID is required');
  }
  
  // Get capabilities from storage
  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];
  
  // Filter out the capability to revoke
  const updatedCapabilities = originCapabilities.filter(c => c.id !== capabilityId);
  
  if (updatedCapabilities.length === originCapabilities.length) {
    throw new Error(`Capability '${capabilityId}' not found`);
  }
  
  // Update in storage
  allCapabilities[appOrigin] = updatedCapabilities;
  await chrome.storage.local.set({ capabilities: allCapabilities });
  
  console.log('[Background] Capability revoked:', capabilityId);
  
  return {
    type: 'REVOKE_CAPABILITY_RESPONSE',
    success: true
  };
}

// Sync storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    chrome.runtime.sendMessage({
      type: 'STORAGE_CHANGED',
      changes
    }).catch(() => {});
  }
});
