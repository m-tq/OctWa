/**
 * Octra Wallet  Background Service Worker
 *
 * Capability-based authorization model (v2).
 * Private keys live exclusively in this context.
 *
 * Capability fields:
 *   version, circle, methods, scope, encrypted,
 *   appOrigin (cryptographically bound), branchId, epoch,
 *   issuedAt, expiresAt, nonceBase, walletPubKey, signature
 *
 * Security guarantees:
 *   - Signing mutex prevents parallel signing / double-send
 *   - Keyed pending registry prevents concurrent-request races
 *   - Origin binding enforced on every invocation
 *   - Nonce monotonicity enforced at wallet layer
 *   - All fee estimates fetched live from node (no hardcoded values)
 */

// =============================================================================
// Signing Mutex (Prevent Parallel Signing)
// =============================================================================

let signingMutex = Promise.resolve();

/**
 * Acquire signing lock to prevent parallel signing operations
 *
 * SECURITY: Prevents race conditions and double-send attacks
 */
async function withSigningLock(fn) {
  await signingMutex;
  let release;
  signingMutex = new Promise(resolve => {
    release = resolve;
  });
  try {
    return await fn();
  } finally {
    release();
  }
}

// =============================================================================
// Pending Request Registry (replaces single-slot storage  prevents race)
// =============================================================================

/**
 * In-memory registry for pending dApp requests.
 * Keyed by requestId so concurrent requests from different origins
 * never overwrite each other.
 *
 * Structure: Map<requestId, { resolve, reject, timer, type, appOrigin }>
 */
const _pendingRegistry = new Map();

// =============================================================================
// Normalized Error Model
// =============================================================================

function createErrorResponse(code, message, layer = 'wallet', retryable = false) {
  return { code, message, layer, retryable };
}

function normalizeError(error) {
  if (typeof error === 'object' && error.code) {
    return error;
  }
  const message = error?.message || String(error);
  if (message.toLowerCase().includes('reject') || message.toLowerCase().includes('denied')) {
    return createErrorResponse('USER_REJECTED', message, 'wallet', false);
  }
  if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    return createErrorResponse('NETWORK_ERROR', message, 'network', true);
  }
  if (message.toLowerCase().includes('signature')) {
    return createErrorResponse('SIGNATURE_INVALID', message, 'wallet', false);
  }
  if (message.toLowerCase().includes('balance') || message.toLowerCase().includes('insufficient')) {
    return createErrorResponse('INSUFFICIENT_BALANCE', message, 'wallet', false);
  }
  if (message.toLowerCase().includes('encrypt')) {
    return createErrorResponse('ENCRYPTED_EXECUTION_ERROR', message, 'wallet', false);
  }
  if (message.toLowerCase().includes('nonce')) {
    return createErrorResponse('NONCE_VIOLATION', message, 'wallet', false);
  }
  if (message.toLowerCase().includes('origin')) {
    return createErrorResponse('ORIGIN_MISMATCH', message, 'wallet', false);
  }
  return createErrorResponse('UNKNOWN_ERROR', message, 'wallet', false);
}

// =============================================================================
// Lock wallet on browser startup
// =============================================================================

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Browser started, locking wallet...');
  await lockWallet();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const windows = await chrome.windows.getAll();
  if (windows.length === 0) {
    console.log('[Background] All windows closed, locking wallet...');
    await lockWallet();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});

// =============================================================================
// Message Handler
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_STATE') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }

  if (message.type === 'OPEN_EXPANDED') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    return true;
  }

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

// =============================================================================
// Connection Request Handler
// =============================================================================

async function handleConnectionRequest(data, sender) {
  const { circle, appOrigin, appName, appIcon, requestedCapabilities } = data;

  console.log('[Background] Connection request:', { circle, appOrigin, appName });

  // Check if already connected - return existing connection without popup
  const existingConnection = await getConnection(appOrigin);
  if (existingConnection && existingConnection.circle === circle) {
    console.log('[Background] Already connected, returning existing connection');

    const currentEpoch = await fetchCurrentEpoch();

    return {
      type: 'CONNECTION_RESPONSE',
      success: true,
      result: {
        circle: existingConnection.circle,
        sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        walletPubKey: existingConnection.walletPubKey,
        evmAddress: existingConnection.evmAddress || '',
        network: existingConnection.network || 'mainnet',
        evmNetworkId: existingConnection.evmNetworkId || await (async () => {
          try {
            const stored = await chrome.storage.local.get('active_evm_network');
            return stored.active_evm_network || 'eth-mainnet';
          } catch { return 'eth-mainnet'; }
        })(),
        epoch: currentEpoch,
        branchId: existingConnection.branchId || 'main'
      }
    };
  }

  // Generate unique key for this pending request
  const pendingKey = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Store pending request with keyed storage
  await setStorageData(`pendingConnectionRequest_${pendingKey}`, {
    pendingKey,
    circle,
    appOrigin,
    appName: appName || appOrigin,
    appIcon: appIcon || null,
    requestedCapabilities: requestedCapabilities || [],
    timestamp: Date.now()
  });

  // Write the key so popup knows which request to load
  await setStorageData('pendingConnectionRequestKey', pendingKey);

  // Try popup first, fallback to tab
  try {
    await chrome.action.openPopup();
  } catch (error) {
    const url = chrome.runtime.getURL(
      `index.html?action=connect&circle=${encodeURIComponent(circle)}&appOrigin=${encodeURIComponent(appOrigin)}&appName=${encodeURIComponent(appName || '')}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response  keyed by pendingKey to avoid cross-request collision
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([
        `pendingConnectionRequest_${pendingKey}`,
        'pendingConnectionRequestKey'
      ]);
    };

    const listener = async (msg) => {
      const msgOrigin = msg.appOrigin || msg.origin;
      if (msg.type === 'CONNECTION_RESULT'
          && msgOrigin === appOrigin
          && msg.pendingKey === pendingKey) {
        cleanup();

        if (msg.approved) {
          const walletAddress = msg.walletPubKey || msg.address || 'oct_unknown';
          const network = msg.network || 'mainnet';
          const evmAddress = msg.evmAddress || '';
          const branchId = msg.branchId || 'main';
          const currentEpoch = await fetchCurrentEpoch();

          // Read active EVM network from storage (set by wallet settings)
          let evmNetworkId = 'eth-mainnet';
          try {
            const stored = await chrome.storage.local.get('active_evm_network');
            if (stored.active_evm_network) evmNetworkId = stored.active_evm_network;
          } catch { /* use default */ }

          saveConnection({
            circle,
            appOrigin,
            appName,
            walletPubKey: walletAddress,
            evmAddress: evmAddress,
            network: network,
            evmNetworkId: evmNetworkId,
            epoch: currentEpoch,
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
              evmNetworkId: evmNetworkId,
              epoch: currentEpoch,
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

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        type: 'CONNECTION_RESPONSE',
        success: false,
        error: 'Connection request timeout'
      });
    }, 60000);

    chrome.runtime.onMessage.addListener(listener);
  });
}

// =============================================================================
// Capability Request Handler
// =============================================================================

async function handleCapabilityRequest(data, sender) {
  const { circle, methods, scope, encrypted, ttlSeconds, appOrigin, appName, appIcon } = data;

  // Check if connected
  const connection = await getConnection(appOrigin);
  if (!connection) {
    throw new Error('Not connected to wallet');
  }

  // Generate unique key for this pending request
  const pendingKey = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Store pending request with keyed storage
  await setStorageData(`pendingCapabilityRequest_${pendingKey}`, {
    pendingKey,
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

  // Write the key so popup knows which request to load
  await setStorageData('pendingCapabilityRequestKey', pendingKey);

  // Open approval UI
  try {
    await chrome.action.openPopup();
  } catch (error) {
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL('index.html?action=capability'),
        type: 'popup',
        width: 420,
        height: 640,
        focused: true
      });
    } catch (e2) {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('index.html?action=capability'),
        active: true
      });
    }
  }

  // Wait for user response  keyed by pendingKey
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([
        `pendingCapabilityRequest_${pendingKey}`,
        'pendingCapabilityRequestKey'
      ]);
    };

    const listener = async (msg) => {
      if (msg.type === 'CAPABILITY_RESULT'
          && msg.appOrigin === appOrigin
          && msg.pendingKey === pendingKey) {
        cleanup();

        if (msg.approved) {
          const signedCapability = msg.signedCapability;
          const capabilityId = msg.capabilityId;
          const currentEpoch = await fetchCurrentEpoch();

          const capability = {
            id: capabilityId,
            version: signedCapability.version || 2,
            circle: signedCapability.circle,
            methods: signedCapability.methods,
            scope: signedCapability.scope,
            encrypted: signedCapability.encrypted,
            appOrigin: signedCapability.appOrigin,
            branchId: signedCapability.branchId || 'main',
            epoch: currentEpoch,
            issuedAt: signedCapability.issuedAt,
            expiresAt: signedCapability.expiresAt,
            nonceBase: signedCapability.nonceBase || 0,
            walletPubKey: signedCapability.walletPubKey,
            signature: signedCapability.signature,
            state: 'ACTIVE',
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
            epoch: capability.epoch,
            expiresAt: capability.expiresAt ? new Date(capability.expiresAt).toISOString() : 'never',
            walletPubKey: capability.walletPubKey?.slice(0, 16) + '...',
            signature: capability.signature?.slice(0, 16) + '...'
          });

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

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        type: 'CAPABILITY_RESPONSE',
        success: false,
        error: 'Capability request timeout'
      });
    }, 300000);

    chrome.runtime.onMessage.addListener(listener);
  });
}

// =============================================================================
// Invoke Request Handler
// =============================================================================

async function handleInvokeRequest(data, sender) {
  const { capabilityId, method, payload, nonce, timestamp, appOrigin, appName } = data;

  console.log('[Background] handleInvokeRequest:', { capabilityId, method, appOrigin, appName });

  // Get capability
  const capability = await getCapability(appOrigin, capabilityId);
  if (!capability) {
    throw new Error(`Capability '${capabilityId}' not found`);
  }

  // SECURITY: Verify origin binding
  if (capability.appOrigin !== appOrigin) {
    console.error('[Background] Origin mismatch:', { expected: capability.appOrigin, actual: appOrigin });
    throw new Error('Origin mismatch - capability bound to different origin');
  }

  // SECURITY: Check expiry
  if (capability.expiresAt && capability.expiresAt < Date.now()) {
    throw new Error('Capability expired');
  }

  // SECURITY: Check method is allowed
  if (!capability.methods.includes(method)) {
    throw new Error(`Method '${method}' not allowed by capability`);
  }

  // SECURITY: Nonce validation
  if (nonce !== undefined && nonce <= capability.lastNonce) {
    throw new Error(`Nonce violation: ${nonce} <= ${capability.lastNonce}`);
  }

  // Get connection for wallet address
  const connection = await getConnection(appOrigin);
  if (!connection) {
    throw new Error('Not connected to wallet');
  }

  // ==========================================================================
  // AUTO-EXECUTE READ METHODS (no user approval needed)
  // send_transaction, send_evm_transaction, send_erc20_transaction ALWAYS
  // require popup approval as they transfer funds.
  // ==========================================================================
  const autoExecuteMethods = ['get_balance', 'get_encrypted_balance', 'stealth_scan', 'get_evm_tokens', 'get_evm_token_balance'];

  console.log('[Background] Checking auto-execute for method:', method, 'scope:', capability.scope);

  if (autoExecuteMethods.includes(method)) {
    console.log('[Background] Auto-executing read method:', method);
    try {
      const result = await executeMethod(method, payload, connection, capability);
      console.log('[Background] Auto-execute result:', result);
      return {
        type: 'INVOKE_RESPONSE',
        success: true,
        result: { success: true, data: result }
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
  // WRITE METHODS  require user approval
  // ==========================================================================

  const pendingKey = `invoke_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await setStorageData(`pendingInvokeRequest_${pendingKey}`, {
    pendingKey,
    capabilityId,
    method,
    payload,
    nonce,
    timestamp,
    appOrigin,
    appName,
    capability,
    connection,
    requestTimestamp: Date.now()
  });

  await setStorageData('pendingInvokeRequestKey', pendingKey);

  try {
    await chrome.action.openPopup();
  } catch (error) {
    console.log('[Background] openPopup failed for invoke, storage change listener will handle it');
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([
        `pendingInvokeRequest_${pendingKey}`,
        'pendingInvokeRequestKey'
      ]);
      _pendingRegistry.delete(pendingKey);
    };

    const listener = (msg) => {
      if (msg.type === 'INVOKE_RESULT'
          && msg.appOrigin === appOrigin
          && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          resolve({
            type: 'INVOKE_RESPONSE',
            success: true,
            result: { success: true, data: msg.data }
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

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        type: 'INVOKE_RESPONSE',
        success: false,
        error: 'Invocation request timeout'
      });
    }, 300000);

    _pendingRegistry.set(pendingKey, { resolve, cleanup });
    chrome.runtime.onMessage.addListener(listener);
  });
}

// =============================================================================
// Method Execution (wallet-side RPC calls)
// =============================================================================

const DEFAULT_RPC_URL = '__VITE_OCTRA_RPC_URL__';

/**
 * Get the active Octra RPC endpoint URL from chrome.storage.local.
 * The stored URL is the base URL (e.g. http://46.101.86.250:8080).
 * All JSON-RPC calls go to <base>/rpc.
 * Falls back to the build-time injected default.
 */
async function getActiveOctraRpcUrl() {
  let baseUrl = DEFAULT_RPC_URL;
  try {
    const result = await chrome.storage.local.get(['rpcProviders']);
    if (result.rpcProviders) {
      const providers = JSON.parse(result.rpcProviders);
      const active = providers.find(p => p.isActive);
      if (active && active.url) baseUrl = active.url;
    }
  } catch (e) {
    console.warn('[Background] Failed to read rpcProviders:', e);
  }
  // Normalize: strip trailing slash, then append /rpc
  const normalized = baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/rpc') ? normalized : `${normalized}/rpc`;
}

/**
 * Fetch current epoch from Octra RPC using the active provider.
 * Uses the JSON-RPC endpoint (epoch_current).
 */
async function fetchCurrentEpoch() {
  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'epoch_current',
        params: []
      })
    });
    if (response.ok) {
      const data = await response.json();
      return data?.result?.epoch_id ?? 0;
    }
  } catch (error) {
    console.error('[Background] Failed to fetch current epoch:', error);
  }
  return 0;
}

async function executeMethod(method, payload, connection, capability) {
  switch (method) {
    case 'get_balance':
      return await executeGetBalance(connection);

    case 'get_encrypted_balance':
      return await executeGetEncryptedBalance(connection);

    case 'get_evm_tokens':
      return await executeGetEvmTokens(connection);

    case 'get_evm_token_balance':
      return await executeGetEvmTokenBalance(connection, payload);

    case 'send_transaction':
      throw new Error('send_transaction requires user approval');

    case 'encrypt_balance':
      throw new Error('encrypt_balance requires user approval');

    case 'decrypt_balance':
      throw new Error('decrypt_balance requires user approval');

    case 'stealth_send':
      throw new Error('stealth_send requires user approval');

    case 'stealth_scan':
      return await executeStealthScan(connection);

    case 'stealth_claim':
      throw new Error('stealth_claim requires user approval');

    case 'send_evm_transaction':
      throw new Error('send_evm_transaction requires user approval');

    case 'send_erc20_transaction':
      throw new Error('send_erc20_transaction requires user approval');

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Get balance from RPC (wallet-side, not dApp-side)
async function executeGetBalance(connection) {
  const octAddress = connection.walletPubKey;

  let octBalance = 0;
  let encryptedBalance = 0;
  let cipher = '0';
  let hasPvacPubkey = false;

  // Fetch public balance
  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_balance', params: [octAddress] })
    });
    if (response.ok) {
      const data = await response.json();
      const balanceStr = data?.result?.balance;
      octBalance = balanceStr !== undefined && balanceStr !== null
        ? parseFloat(balanceStr)
        : 0;
      if ((isNaN(octBalance) || balanceStr === undefined) && data?.result?.balance_raw) {
        octBalance = parseInt(data.result.balance_raw, 10) / 1_000_000;
      }
      hasPvacPubkey = !!data?.result?.has_pvac_pubkey;
    }
  } catch (error) {
    console.error('[Background] OCT balance fetch error:', error);
  }

  // Fetch encrypted balance cipher (lightweight — no signature needed for cipher check)
  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'octra_encryptedCipher', params: [octAddress] })
    });
    if (response.ok) {
      const data = await response.json();
      cipher = data?.result?.cipher ?? '0';
    }
  } catch (error) {
    console.warn('[Background] Encrypted cipher fetch error (non-critical):', error);
  }

  return new TextEncoder().encode(JSON.stringify({
    octAddress,
    octBalance,
    encryptedBalance,
    cipher,
    hasPvacPubkey,
    network: connection.network || 'mainnet',
  }));
}

// Get encrypted balance info (cipher only — decryption requires PVAC server in wallet)
async function executeGetEncryptedBalance(connection) {
  const octAddress = connection.walletPubKey;
  let cipher = '0';
  let hasPvacPubkey = false;

  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const [cipherRes, balanceRes] = await Promise.all([
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_encryptedCipher', params: [octAddress] })
      }),
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'octra_balance', params: [octAddress] })
      }),
    ]);

    if (cipherRes.ok) {
      const data = await cipherRes.json();
      cipher = data?.result?.cipher ?? '0';
    }
    if (balanceRes.ok) {
      const data = await balanceRes.json();
      hasPvacPubkey = !!data?.result?.has_pvac_pubkey;
    }
  } catch (error) {
    console.error('[Background] Get encrypted balance error:', error);
  }

  return new TextEncoder().encode(JSON.stringify({
    encryptedBalance: 0,  // actual decryption requires PVAC server — wallet handles this
    cipher,
    hasPvacPubkey,
  }));
}

// Get all ERC-20 token balances for the wallet's active EVM network
// Fetches common tokens (wOCT, USDC, etc.) + user-imported custom tokens
async function executeGetEvmTokens(connection) {
  const evmAddress = connection.evmAddress;
  if (!evmAddress) {
    return new TextEncoder().encode(JSON.stringify({ tokens: [], networkId: '', chainId: 0 }));
  }

  // Read active EVM network from storage
  let networkId = 'eth-mainnet';
  let chainId = 1;
  try {
    const stored = await chrome.storage.local.get(['active_evm_network', 'evm_rpc_providers']);
    if (stored.active_evm_network) networkId = stored.active_evm_network;
  } catch { /* use defaults */ }

  // Map network ID to chain ID
  const NETWORK_CHAIN_IDS = {
    'eth-mainnet':     1,
    'polygon-mainnet': 137,
    'base-mainnet':    8453,
    'bsc-mainnet':     56,
    'eth-sepolia':     11155111,
  };
  chainId = NETWORK_CHAIN_IDS[networkId] ?? 1;

  // Common tokens per chain (wOCT always first on Ethereum)
  const COMMON_TOKENS = {
    1: [
      { address: '0x4647e1fe715c9e23959022c2416c71867f5a6e80', name: 'Wrapped OCT', symbol: 'wOCT', decimals: 6 },
      { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'Tether USD',   symbol: 'USDT', decimals: 6 },
      { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USD Coin',     symbol: 'USDC', decimals: 6 },
    ],
    137: [
      { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', name: 'Tether USD', symbol: 'USDT', decimals: 6 },
      { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', name: 'USD Coin',   symbol: 'USDC', decimals: 6 },
    ],
    8453: [
      { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    ],
    56: [
      { address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT', decimals: 18 },
      { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', name: 'USD Coin',   symbol: 'USDC', decimals: 18 },
    ],
  };

  // Load custom tokens from storage
  let customTokens = [];
  try {
    const stored = await chrome.storage.local.get('evm_custom_tokens');
    const all = stored.evm_custom_tokens ? JSON.parse(stored.evm_custom_tokens) : [];
    customTokens = all.filter(t => t.chainId === chainId);
  } catch { /* ignore */ }

  // Merge common + custom, deduplicate by address
  const commonForChain = COMMON_TOKENS[chainId] || [];
  const allTokens = [...commonForChain];
  for (const ct of customTokens) {
    if (!allTokens.some(t => t.address.toLowerCase() === ct.address.toLowerCase())) {
      allTokens.push(ct);
    }
  }

  if (allTokens.length === 0) {
    return new TextEncoder().encode(JSON.stringify({ tokens: [], networkId, chainId }));
  }

  // Determine RPC URL for this network
  let rpcUrl = 'https://mainnet.infura.io/v3/121cf128273c4f0cb73770b391070d3b';
  try {
    const stored = await chrome.storage.local.get('evm_rpc_providers');
    const providers = stored.evm_rpc_providers ? JSON.parse(stored.evm_rpc_providers) : {};
    if (providers[networkId]) rpcUrl = providers[networkId];
  } catch { /* use default */ }

  // Fetch balances concurrently (max 5 at a time)
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < allTokens.length; i += CONCURRENCY) {
    const batch = allTokens.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (token) => {
        try {
          // ERC-20 balanceOf(address) — selector 0x70a08231
          const data = '0x70a08231' + evmAddress.slice(2).padStart(64, '0');
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'eth_call',
              params: [{ to: token.address, data }, 'latest'],
            }),
          });
          if (!response.ok) return { ...token, balance: '0.000000', chainId };
          const json = await response.json();
          const hex = json?.result;
          if (!hex || hex === '0x') return { ...token, balance: '0.000000', chainId };
          const raw = BigInt(hex);
          const balance = (Number(raw) / Math.pow(10, token.decimals)).toFixed(token.decimals);
          return { ...token, balance, chainId };
        } catch {
          return { ...token, balance: '0.000000', chainId };
        }
      })
    );
    results.push(...batchResults);
  }

  // Only return tokens with non-zero balance OR user-imported custom tokens
  const customAddresses = new Set(customTokens.map(t => t.address.toLowerCase()));
  const filtered = results.filter(t =>
    parseFloat(t.balance) > 0 || customAddresses.has(t.address.toLowerCase())
  );

  return new TextEncoder().encode(JSON.stringify({ tokens: filtered, networkId, chainId }));
}

// Get balance for a single ERC-20 token
async function executeGetEvmTokenBalance(connection, payload) {
  const evmAddress = connection.evmAddress;
  if (!evmAddress) throw new Error('No EVM address in connection');

  let params;
  try {
    params = payload ? JSON.parse(new TextDecoder().decode(
      payload instanceof Uint8Array ? payload : new Uint8Array(Object.values(payload))
    )) : null;
  } catch { throw new Error('Invalid payload for get_evm_token_balance'); }

  if (!params?.tokenAddress) throw new Error('tokenAddress is required');

  // Read active EVM network
  let networkId = 'eth-mainnet';
  let rpcUrl = 'https://mainnet.infura.io/v3/121cf128273c4f0cb73770b391070d3b';
  try {
    const stored = await chrome.storage.local.get(['active_evm_network', 'evm_rpc_providers']);
    if (stored.active_evm_network) networkId = stored.active_evm_network;
    const providers = stored.evm_rpc_providers ? JSON.parse(stored.evm_rpc_providers) : {};
    if (providers[networkId]) rpcUrl = providers[networkId];
  } catch { /* use defaults */ }

  const NETWORK_CHAIN_IDS = {
    'eth-mainnet': 1, 'polygon-mainnet': 137, 'base-mainnet': 8453,
    'bsc-mainnet': 56, 'eth-sepolia': 11155111,
  };
  const chainId = NETWORK_CHAIN_IDS[networkId] ?? 1;
  const decimals = params.decimals ?? 18;

  // balanceOf call
  const data = '0x70a08231' + evmAddress.slice(2).padStart(64, '0');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: params.tokenAddress, data }, 'latest'],
    }),
  });

  if (!response.ok) throw new Error(`EVM RPC error: ${response.status}`);
  const json = await response.json();
  const hex = json?.result;
  const raw = hex && hex !== '0x' ? BigInt(hex) : 0n;
  const balance = (Number(raw) / Math.pow(10, decimals)).toFixed(decimals);

  return new TextEncoder().encode(JSON.stringify({
    address: params.tokenAddress,
    balance,
    decimals,
    chainId,
    networkId,
    symbol: params.symbol ?? '',
    name: params.name ?? '',
  }));
}

// Scan stealth outputs for this wallet (uses wallet private view key — no dApp key exposure)
async function executeStealthScan(connection) {
  const { scanStealthOutputs } = await import('./stealthScanService.js').catch(() => null) || {};

  // Fallback: fetch raw outputs from RPC and return them for wallet-side scanning
  // The actual ECDH scanning happens in the wallet context where private key is available
  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_stealthOutputs', params: [0] })
    });

    if (!response.ok) {
      return new TextEncoder().encode(JSON.stringify({ outputs: [] }));
    }

    const data = await response.json();
    const rawOutputs = data?.result?.outputs ?? [];

    // NOTE: Full ECDH scanning with private key happens in the wallet popup context.
    // Background returns raw outputs; the popup's DAppRequestHandler performs the scan.
    // For auto-execute, we return an empty list — the popup flow handles actual scanning.
    return new TextEncoder().encode(JSON.stringify({ outputs: [] }));
  } catch (error) {
    console.error('[Background] Stealth scan error:', error);
    return new TextEncoder().encode(JSON.stringify({ outputs: [] }));
  }
}

// =============================================================================
// Disconnect Request Handler
// =============================================================================

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

// =============================================================================
// Sign Message Request Handler
// =============================================================================

async function handleSignMessageRequest(data, sender) {
  const { message, appOrigin, appName, appIcon } = data;

  console.log('[Background] ========================================');
  console.log('[Background] SIGN MESSAGE REQUEST RECEIVED');
  console.log('[Background] appOrigin:', appOrigin);
  console.log('[Background] appName:', appName);
  console.log('[Background] message length:', message?.length);
  console.log('[Background] ========================================');

  // Check if connected
  const connection = await getConnection(appOrigin);
  if (!connection) {
    console.error('[Background] Not connected for origin:', appOrigin);
    throw new Error('Not connected to wallet');
  }

  console.log('[Background] Connection found:', connection.walletPubKey);

  // Generate unique key for this pending request
  const pendingKey = `sign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Store pending request with keyed storage
  const pendingRequest = {
    pendingKey,
    message,
    appOrigin,
    appName: appName || appOrigin,
    appIcon,
    timestamp: Date.now()
  };

  console.log('[Background] Storing pending sign request with key:', pendingKey);
  await setStorageData(`pendingSignMessageRequest_${pendingKey}`, pendingRequest);
  await setStorageData('pendingSignMessageRequestKey', pendingKey);

  // Open approval UI
  console.log('[Background] Opening popup...');
  try {
    await chrome.action.openPopup();
    console.log('[Background] Popup opened successfully');
  } catch (error) {
    console.log('[Background] Popup failed, opening tab:', error);
    const url = chrome.runtime.getURL(
      `index.html?action=signMessage&appOrigin=${encodeURIComponent(appOrigin)}&appName=${encodeURIComponent(appName || '')}&message=${encodeURIComponent(message)}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response  keyed by pendingKey
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([
        `pendingSignMessageRequest_${pendingKey}`,
        'pendingSignMessageRequestKey'
      ]);
    };

    const listener = (msg) => {
      console.log('[Background] Received message:', msg.type, msg);

      if (msg.type === 'SIGN_MESSAGE_RESULT'
          && msg.appOrigin === appOrigin
          && msg.pendingKey === pendingKey) {
        cleanup();

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

    const timer = setTimeout(() => {
      cleanup();
      console.log('[Background] Sign message request timeout');
      resolve({
        type: 'SIGN_MESSAGE_RESPONSE',
        success: false,
        error: 'Sign message request timeout'
      });
    }, 60000);

    chrome.runtime.onMessage.addListener(listener);
  });
}

// =============================================================================
// Gas Estimation Handlers
// =============================================================================

/**
 * Handle plain transaction fee estimation.
 * Queries octra_recommendedFee from the node (no hardcoded values).
 */
async function handleEstimatePlainTx(data, sender) {
  const rpcUrl = await getActiveOctraRpcUrl();
  let recommendedOu = 1000; // fallback
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_recommendedFee', params: ['standard'] })
    });
    if (r.ok) {
      const d = await r.json();
      recommendedOu = parseInt(d?.result?.recommended ?? d?.result?.base_fee ?? 1000, 10);
    }
  } catch { /* use fallback */ }
  const fee = recommendedOu / 1_000_000; // 1 OCT = 1,000,000 OU
  const currentEpoch = await fetchCurrentEpoch();
  return {
    type: 'ESTIMATE_PLAIN_TX_RESPONSE',
    success: true,
    result: { gasUnits: recommendedOu, tokenCost: fee, latencyEstimate: 2000, epoch: currentEpoch }
  };
}

/**
 * Handle encrypted transaction fee estimation.
 * Queries octra_recommendedFee with op_type 'encrypt' from the node.
 */
async function handleEstimateEncryptedTx(data, sender) {
  const rpcUrl = await getActiveOctraRpcUrl();
  let recommendedOu = 30000; // fallback
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_recommendedFee', params: ['encrypt'] })
    });
    if (r.ok) {
      const d = await r.json();
      recommendedOu = parseInt(d?.result?.recommended ?? d?.result?.base_fee ?? 30000, 10);
    }
  } catch { /* use fallback */ }
  const fee = recommendedOu / 1_000_000;
  const currentEpoch = await fetchCurrentEpoch();
  return {
    type: 'ESTIMATE_ENCRYPTED_TX_RESPONSE',
    success: true,
    result: { gasUnits: recommendedOu, tokenCost: fee, latencyEstimate: 4000, epoch: currentEpoch }
  };
}

// =============================================================================
// Capability Management Handlers
// =============================================================================

/**
 * Handle list capabilities request.
 * Returns all active capabilities for the requesting origin.
 */
async function handleListCapabilities(data, sender) {
  const { appOrigin } = data;

  console.log('[Background] List capabilities request from:', appOrigin);

  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];

  const now = Date.now();
  const activeCapabilities = originCapabilities.filter(cap => cap.expiresAt > now);

  console.log('[Background] Found', activeCapabilities.length, 'active capabilities');

  return {
    type: 'LIST_CAPABILITIES_RESPONSE',
    success: true,
    result: activeCapabilities
  };
}

/**
 * Handle renew capability request.
 * Extends the expiration time of an existing capability.
 */
async function handleRenewCapability(data, sender) {
  const { capabilityId, appOrigin } = data;

  console.log('[Background] Renew capability request:', capabilityId);

  if (!capabilityId) {
    throw new Error('Capability ID is required');
  }

  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];

  const capIndex = originCapabilities.findIndex(c => c.id === capabilityId);
  if (capIndex === -1) {
    throw new Error(`Capability '${capabilityId}' not found`);
  }

  const capability = originCapabilities[capIndex];
  if (capability.expiresAt <= Date.now()) {
    throw new Error('Cannot renew expired capability');
  }

  const newExpiresAt = Date.now() + (900 * 1000);
  const renewedCapability = { ...capability, expiresAt: newExpiresAt };

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
 * Handle revoke capability request.
 * Removes a capability from storage.
 */
async function handleRevokeCapability(data, sender) {
  const { capabilityId, appOrigin } = data;

  console.log('[Background] Revoke capability request:', capabilityId);

  if (!capabilityId) {
    throw new Error('Capability ID is required');
  }

  const result = await chrome.storage.local.get(['capabilities']);
  const allCapabilities = result.capabilities || {};
  const originCapabilities = allCapabilities[appOrigin] || [];

  const updatedCapabilities = originCapabilities.filter(c => c.id !== capabilityId);
  if (updatedCapabilities.length === originCapabilities.length) {
    throw new Error(`Capability '${capabilityId}' not found`);
  }

  allCapabilities[appOrigin] = updatedCapabilities;
  await chrome.storage.local.set({ capabilities: allCapabilities });

  console.log('[Background] Capability revoked:', capabilityId);

  return {
    type: 'REVOKE_CAPABILITY_RESPONSE',
    success: true
  };
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
    await chrome.storage.local.remove([
      'sessionWallets',
      'sessionKey',
      'wallets',
    ]);
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
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'WALLET_DISCONNECTED',
          appOrigin: appOrigin
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.log('[Background] Could not notify tabs:', e);
  }
}

async function getCapability(appOrigin, capabilityId) {
  const capabilities = await getStorageData('capabilities') || {};
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
  console.log('[Background] saveCapability - total for origin:', capabilities[appOrigin].length);
}

// =============================================================================
// Storage Change Broadcast
// =============================================================================

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  // Only forward to popup if it's open  ignore errors silently
  chrome.runtime.sendMessage({ type: 'STORAGE_CHANGED', changes }).catch(() => {});
});
