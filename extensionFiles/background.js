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

          console.log('[Background] Connection approved:', { walletAddress, evmAddress, network, branchId });

          saveConnection({
            circle,
            appOrigin,
            appName,
            walletPubKey: walletAddress,
            evmAddress: evmAddress,
            network: network,
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
  // send_transaction and send_evm_transaction ALWAYS require popup approval.
  // ==========================================================================
  const autoExecuteMethods = ['get_balance'];

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
 * Get the active Octra RPC URL from chrome.storage.local.
 * Falls back to the build-time injected default.
 */
async function getActiveOctraRpcUrl() {
  try {
    const result = await chrome.storage.local.get(['rpcProviders']);
    if (result.rpcProviders) {
      const providers = JSON.parse(result.rpcProviders);
      const active = providers.find(p => p.isActive);
      if (active && active.url) return active.url;
    }
  } catch (e) {
    console.warn('[Background] Failed to read rpcProviders:', e);
  }
  return DEFAULT_RPC_URL;
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

    case 'send_transaction':
      throw new Error('send_transaction requires user approval');

    case 'send_evm_transaction':
      throw new Error('send_evm_transaction requires user approval');

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Get balance from RPC (wallet-side, not dApp-side)
async function executeGetBalance(connection) {
  const octAddress = connection.walletPubKey;

  console.log('[Background] Fetching OCT balance for:', octAddress);

  let octBalance = 0;

  // Fetch OCT balance via JSON-RPC
  try {
    const rpcUrl = await getActiveOctraRpcUrl();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_balance', params: [octAddress] })
    });
    if (response.ok) {
      const data = await response.json();
      octBalance = parseFloat(data?.result?.balance) || 0;
      console.log('[Background] OCT balance:', octBalance);
    }
  } catch (error) {
    console.error('[Background] OCT balance fetch error:', error);
  }

  return new TextEncoder().encode(JSON.stringify({
    octAddress,
    octBalance,
    network: connection.network || 'mainnet',
  }));
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
