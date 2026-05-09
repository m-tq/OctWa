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
// Popup liveness tracker
// =============================================================================
//
// MV3 does not give background service workers a reliable way to check whether
// the extension popup is currently rendered (`chrome.extension.getViews` can
// return empty even when the popup view is live). The popup heartbeats here
// so `delegateToPvacPopup` can tell fast whether to (re)open the popup vs.
// relying on the popup that is already draining a prior PVAC op.

let _lastPopupHeartbeatAt = 0;

function isPopupLikelyAlive() {
  // Treat the popup as alive if we heard from it in the last ~4 s.
  // Heartbeats fire every 1.5 s from DAppRequestHandler.
  return Date.now() - _lastPopupHeartbeatAt < 4_000;
}

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
  // Popup heartbeat — lets background know the popup view is alive without
  // relying on chrome.extension.getViews (which is unreliable in MV3 SWs).
  if (message?.type === 'POPUP_HEARTBEAT') {
    _lastPopupHeartbeatAt = Date.now();
    // acknowledge so the popup does not keep retrying
    try { sendResponse({ ok: true, at: _lastPopupHeartbeatAt }); } catch { /* noop */ }
    return false;
  }

  if (message.type === 'SYNC_STATE') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === 'OPEN_EXPANDED') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    return false;
  }

  if (message.source === 'octra-content-script') {
    handleDAppRequest(message, sender)
      .then(response => {
        try { sendResponse(response); } catch { /* sender closed channel */ }
      })
      .catch(error => {
        const normalized = normalizeError(error);
        try {
          sendResponse({
            type: 'ERROR_RESPONSE',
            success: false,
            error: normalized.message,
            errorCode: normalized.code,
            errorLayer: normalized.layer,
            retryable: normalized.retryable,
          });
        } catch { /* sender closed channel */ }
      });
    return true;
  }

  // Everything else (PVAC result messages from the offscreen, internal
  // broadcasts, etc.) is fire-and-forget. Returning `false` tells Chrome the
  // channel can close immediately so it doesn't log
  // "message channel closed before a response was received".
  return false;
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

      // ── PVAC / HFHE Crypto (Phase 7) ──────────────────────────────────────
      case 'PVAC_GET_IDENTITY':
        return await handlePvacGetIdentity(normalizedData, sender);

      case 'PVAC_COMPUTE_SHARED_SECRET':
        return await handlePvacComputeSharedSecret(normalizedData, sender);

      case 'PVAC_DECRYPT_CIPHER':
        return await handlePvacDecryptCipher(normalizedData, sender);

      case 'PVAC_ENCRYPT_VALUE':
        return await handlePvacEncryptValue(normalizedData, sender);

      case 'PVAC_SCAN_OUTPUTS':
        return await handlePvacScanOutputs(normalizedData, sender);

      case 'PVAC_SIGN_FOR_ZK':
        return await handlePvacSignForZK(normalizedData, sender);

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
  // BUT verify the active wallet hasn't changed since the connection was saved.
  // If the user switched wallets, the cached connection is stale — force a new popup.
  const existingConnection = await getConnection(appOrigin);
  if (existingConnection && existingConnection.circle === circle) {
    // Check if the currently active wallet matches the cached connection
    let activeWalletId = null;
    try {
      const stored = await chrome.storage.local.get('activeWalletId');
      activeWalletId = stored.activeWalletId || null;
    } catch { /* ignore */ }

    const walletChanged = activeWalletId && activeWalletId !== existingConnection.walletPubKey;

    if (!walletChanged) {
      console.log('[Background] Already connected, returning existing connection');
      const currentEpoch = await fetchCurrentEpoch();
      return {
        type: 'CONNECTION_RESPONSE',
        success: true,
        result: {
          circle: existingConnection.circle,
          sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          walletPubKey: existingConnection.walletPubKey,
          address: existingConnection.walletPubKey,
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

    // Active wallet changed — remove stale connection and fall through to popup
    console.log('[Background] Active wallet changed, clearing stale connection for', appOrigin);
    await removeConnection(appOrigin);
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
              address: walletAddress,
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
  const autoExecuteMethods = [
    'get_balance',
    'get_encrypted_balance',
    'stealth_scan',
    'get_evm_tokens',
    'get_evm_token_balance',
    // Phase 9 — reads (RPC pass-through)
    'get_transaction',
    'get_epoch',
    'get_recommended_fee',
    'get_contract_storage',
    'contract_call_view',
    'get_view_pubkey',
    'get_stealth_outputs',
  ];

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

    case 'key_switch':
      throw new Error('key_switch requires user approval');

    // ── Phase 9: Read-only RPC pass-throughs ─────────────────────────────────
    case 'get_transaction':
      return await executeGetTransaction(payload);

    case 'get_epoch':
      return await executeGetEpoch();

    case 'get_recommended_fee':
      return await executeGetRecommendedFee(payload);

    case 'get_contract_storage':
      return await executeGetContractStorage(payload);

    case 'contract_call_view':
      return await executeContractCallView(connection, payload);

    case 'get_view_pubkey':
      return await executeGetViewPubkey(payload);

    case 'get_stealth_outputs':
      return await executeGetStealthOutputs(payload);

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

// =============================================================================
// EVM RPC URL helper — reads Infura key from wallet settings (chrome.storage)
// No hardcoded API keys or proxy URLs here.
// =============================================================================

/**
 * Build the Infura RPC URL for a given network.
 * Priority: user-saved custom RPC → user-saved Infura key → .env default key (injected at build).
 * No hardcoded API keys — all come from wallet settings or build-time .env injection.
 */
async function getEvmRpcUrlForNetwork(networkId) {
  const INFURA_SUBDOMAINS = {
    'eth-mainnet':     'mainnet',
    'polygon-mainnet': 'polygon-mainnet',
    'base-mainnet':    'base-mainnet',
    'bsc-mainnet':     'bsc-mainnet',
    'eth-sepolia':     'sepolia',
  };

  try {
    const stored = await chrome.storage.local.get(['evm_rpc_providers', 'evm_infura_key']);

    // 1. User-saved custom RPC for this specific network takes highest priority
    const providers = stored.evm_rpc_providers ? JSON.parse(stored.evm_rpc_providers) : {};
    if (providers[networkId]) return providers[networkId];

    // 2. User-saved Infura key (set via wallet settings UI)
    const userKey = (stored.evm_infura_key || '').trim();
    const subdomain = INFURA_SUBDOMAINS[networkId];
    if (userKey && subdomain) {
      return `https://${subdomain}.infura.io/v3/${userKey}`;
    }

    // 3. Build-time default from .env (VITE_INFURA_API_KEY injected by copy-extension-files.mjs)
    const envKey = '__VITE_INFURA_API_KEY__';
    if (envKey && subdomain) {
      return `https://${subdomain}.infura.io/v3/${envKey}`;
    }
  } catch { /* fall through */ }

  return ''; // Not configured
}

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

  // Determine RPC URL for this network — reads user-configured Infura key or custom RPC
  // from chrome.storage.local (set via Wallet Settings → EVM API Keys).
  // No hardcoded API keys or proxy URLs.
  let rpcUrl = await getEvmRpcUrlForNetwork(networkId);
  if (!rpcUrl) {
    // No RPC configured — return empty token list gracefully
    return new TextEncoder().encode(JSON.stringify({ tokens: [], networkId, chainId, error: 'EVM RPC not configured. Please add your Infura API key in Wallet Settings → EVM API Keys.' }));
  }

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
  let rpcUrl = '';
  try {
    const stored = await chrome.storage.local.get(['active_evm_network', 'evm_rpc_providers']);
    if (stored.active_evm_network) networkId = stored.active_evm_network;
    rpcUrl = await getEvmRpcUrlForNetwork(networkId);
  } catch { /* use defaults */ }

  if (!rpcUrl) {
    throw new Error('EVM RPC not configured. Please add your Infura API key in Wallet Settings → EVM API Keys.');
  }

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
// Phase 9: Read-only RPC pass-throughs
// =============================================================================
//
// All of these run in background.js — no private key access needed.
// They wrap an Octra JSON-RPC call into a JSON response the SDK can decode.

/** Read payload sent by the SDK as `new TextEncoder().encode(JSON.stringify(x))`. */
function parseInvokePayload(payload) {
  if (!payload) return null;
  try {
    if (payload instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(payload));
    }
    if (payload._type === 'Uint8Array' && Array.isArray(payload.data)) {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.data)));
    }
    if (typeof payload === 'object') {
      return JSON.parse(new TextDecoder().decode(
        new Uint8Array(Object.values(payload))
      ));
    }
  } catch (e) {
    console.warn('[Background] parseInvokePayload failed:', e);
  }
  return null;
}

async function callOctraRpc(method, params = []) {
  const rpcUrl = await getActiveOctraRpcUrl();
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) {
    const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error);
    throw new Error(`RPC ${method} failed: ${msg}`);
  }
  return data?.result ?? null;
}

function encodeJsonResult(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function executeGetTransaction(payload) {
  const params = parseInvokePayload(payload);
  if (!params?.hash) throw new Error('hash required');
  const t = await callOctraRpc('octra_transaction', [params.hash]);
  if (!t) return encodeJsonResult(null);
  // Normalize the node response to the SDK's TransactionInfo shape.
  const info = {
    hash:           t.tx_hash || t.hash || params.hash,
    from:           t.from || '',
    to:             t.to || t.to_ || '',
    amountRaw:      String(t.amount_raw ?? t.amount ?? '0'),
    opType:         t.op_type || 'standard',
    nonce:          t.nonce ?? 0,
    ou:             String(t.ou ?? ''),
    timestamp:      t.timestamp ?? t.rejected_at ?? 0,
    status:         t.status || 'pending',
    epoch:          t.epoch ?? t.epoch_id,
    blockHeight:    t.block_height,
    message:        typeof t.message === 'string' ? t.message : undefined,
    encryptedData:  typeof t.encrypted_data === 'string' ? t.encrypted_data : undefined,
    signature:      t.signature,
    publicKey:      t.public_key,
    rejectReason:   t.error?.reason,
    rejectType:     t.error?.type,
  };
  return encodeJsonResult(info);
}

async function executeGetEpoch() {
  const r = await callOctraRpc('epoch_current', []);
  return encodeJsonResult({
    epochId:   r?.epoch_id ?? 0,
    rootCount: r?.root_count,
  });
}

async function executeGetRecommendedFee(payload) {
  const params = parseInvokePayload(payload);
  const opType = params?.opType || 'standard';
  const r = await callOctraRpc('octra_recommendedFee', [opType]);
  // Node may return strings or numbers — normalize to strings for the SDK.
  const asString = (v, fallback) => (v === undefined || v === null ? fallback : String(v));
  return encodeJsonResult({
    minimum:     asString(r?.minimum,     asString(r?.min,  '1000')),
    base:        asString(r?.base,        asString(r?.base_fee, '1000')),
    recommended: asString(r?.recommended, '1000'),
    fast:        asString(r?.fast,        asString(r?.priority, '2000')),
  });
}

async function executeGetContractStorage(payload) {
  const params = parseInvokePayload(payload);
  if (!params?.contract) throw new Error('contract required');
  if (!params?.key)      throw new Error('key required');
  const r = await callOctraRpc('octra_contractStorage', [params.contract, params.key]);
  return encodeJsonResult({ value: r?.value ?? null });
}

async function executeContractCallView(connection, payload) {
  const params = parseInvokePayload(payload);
  if (!params?.contract) throw new Error('contract required');
  if (!params?.method)   throw new Error('method required');
  const caller = connection?.walletPubKey || '';
  const r = await callOctraRpc(
    'contract_call',
    [params.contract, params.method, params.params ?? [], caller],
  );
  return encodeJsonResult({ result: r?.result ?? r ?? null });
}

async function executeGetViewPubkey(payload) {
  const params = parseInvokePayload(payload);
  if (!params?.address) throw new Error('address required');
  const r = await callOctraRpc('octra_viewPubkey', [params.address]);
  return encodeJsonResult({ viewPubkey: r?.view_pubkey ?? null });
}

async function executeGetStealthOutputs(payload) {
  const params = parseInvokePayload(payload);
  const fromEpoch = Number.isFinite(params?.fromEpoch) ? params.fromEpoch : 0;
  const r = await callOctraRpc('octra_stealthOutputs', [fromEpoch]);
  return encodeJsonResult({ outputs: Array.isArray(r?.outputs) ? r.outputs : [] });
}

// =============================================================================
// PVAC / HFHE Crypto Handlers (Phase 7)
// =============================================================================
// All PVAC operations that require private key access are delegated to the
// wallet popup context (DAppRequestHandler) via chrome.storage.local.
// Background acts as a relay only — private keys never touch background.js.
//
// Flow for each delegated operation:
//   1. Background stores pendingPvac<Op>_${key} in chrome.storage.local
//   2. Background broadcasts STORAGE_CHANGED so popup listener fires
//   3. Popup reads the pending request, runs crypto with wallet private key
//   4. Popup sends PVAC_<OP>_RESULT message back to background
//   5. Background resolves the pending Promise and returns result to dApp
// =============================================================================

// =============================================================================
// Offscreen PVAC runner (MV3 silent path)
// =============================================================================
//
// chrome.offscreen.createDocument lets us open an invisible HTML document with
// DOM + WASM access. We use it to host the same pvac-worker that the popup
// uses, but WITHOUT ever flashing a popup window at the user. The offscreen
// document stays open as long as at least one PVAC op is in flight and is
// closed after the queue drains.

const OFFSCREEN_URL = 'offscreen.html';

// Reasons are required by the API. WORKERS is the most semantically accurate
// for our use (we host a Web Worker that runs PVAC WASM). Older Chrome
// builds rejected WORKERS; DOM_PARSER is a safe fallback that is always
// accepted. If the platform rejects this set the helper falls back to the
// popup path silently.
const OFFSCREEN_REASONS = ['WORKERS'];

/**
 * Snapshot the session-storage bits the offscreen needs to decrypt the
 * wallet. The service worker is a trusted extension context so it can read
 * `chrome.storage.session` directly; the offscreen document can't in some
 * Chrome builds. We bundle the snapshot into the PVAC request message.
 */
async function readSessionSnapshotForOffscreen() {
  try {
    if (!chrome.storage?.session) return null;
    const snap = await chrome.storage.session.get([
      'sessionKey',
      'sessionEncKey',
      'sessionWallets',
    ]);
    if (!snap?.sessionKey || !snap?.sessionEncKey) return null;
    return snap;
  } catch (err) {
    console.warn('[Background] readSessionSnapshotForOffscreen failed:', err);
    return null;
  }
}

let _offscreenReady = false;
let _offscreenInFlight = 0;
let _offscreenReadyPromise = null;
let _offscreenCloseTimer = null;
const OFFSCREEN_IDLE_CLOSE_MS = 30_000;

// The SDK operations that can run silently — no user approval is ever required.
const OFFSCREEN_OP_KEYS = new Set([
  'pendingPvacIdentity',
  'pendingPvacEcdh',
  'pendingPvacDecrypt',
  'pendingPvacEncrypt',
  'pendingPvacScan',
]);

// Map storage key → offscreen op shorthand + expected reply type.
const OFFSCREEN_OP_MAP = {
  pendingPvacIdentity: { op: 'identity', resultType: 'PVAC_IDENTITY_RESULT' },
  pendingPvacEcdh:     { op: 'ecdh',     resultType: 'PVAC_ECDH_RESULT' },
  pendingPvacDecrypt:  { op: 'decrypt',  resultType: 'PVAC_DECRYPT_RESULT' },
  pendingPvacEncrypt:  { op: 'encrypt',  resultType: 'PVAC_ENCRYPT_RESULT' },
  pendingPvacScan:     { op: 'scan',     resultType: 'PVAC_SCAN_RESULT' },
};

async function hasOffscreenDocument() {
  try {
    if (chrome.offscreen?.hasDocument) {
      return await chrome.offscreen.hasDocument();
    }
    const contexts = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('offscreen API not available');
  }

  if (await hasOffscreenDocument()) {
    if (!_offscreenReadyPromise) _offscreenReadyPromise = Promise.resolve();
    return _offscreenReadyPromise;
  }

  if (_offscreenReadyPromise) return _offscreenReadyPromise;

  _offscreenReadyPromise = new Promise(async (resolve, reject) => {
    const readyListener = (msg) => {
      if (msg?.type === 'OFFSCREEN_READY') {
        chrome.runtime.onMessage.removeListener(readyListener);
        _offscreenReady = true;
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(readyListener);

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: OFFSCREEN_REASONS,
        justification:
          'Runs the PVAC WASM worker that decrypts encrypted balances, computes shared secrets, and scans stealth outputs. Kept invisible so dApp reads never flash a popup at the user.',
      });
    } catch (error) {
      chrome.runtime.onMessage.removeListener(readyListener);
      _offscreenReady = false;
      _offscreenReadyPromise = null;
      reject(error);
      return;
    }

    // Final fallback — if OFFSCREEN_READY never arrives, still resolve after
    // 2 s so the storage-driven path can proceed (the offscreen document
    // subscribes to chrome.storage.onChanged before it ever posts the ready
    // message, so the request is processed either way).
    setTimeout(() => {
      _offscreenReady = true;
      resolve();
    }, 2_000);
  });

  return _offscreenReadyPromise;
}

function scheduleOffscreenClose() {
  if (_offscreenCloseTimer) clearTimeout(_offscreenCloseTimer);
  _offscreenCloseTimer = setTimeout(async () => {
    if (_offscreenInFlight > 0) return;
    try {
      if (await hasOffscreenDocument()) {
        await chrome.offscreen.closeDocument();
      }
    } catch {
      /* best effort */
    }
    _offscreenReady = false;
    _offscreenReadyPromise = null;
  }, OFFSCREEN_IDLE_CLOSE_MS);
}

/**
 * Run a silent PVAC op inside the offscreen document. Falls back to the
 * popup path if the offscreen API is unavailable or fails to start.
 *
 * Uses chrome.runtime.sendMessage for both directions because chrome.storage
 * change events are not reliable across offscreen documents. The offscreen
 * listens for `OFFSCREEN_PVAC_REQUEST` and replies asynchronously with the
 * mapped `PVAC_*_RESULT` message type.
 */
function runInOffscreen(storageKey, pendingKey, requestData, resultType, timeoutMs = 120_000) {
  return new Promise(async (resolve) => {
    const map = OFFSCREEN_OP_MAP[storageKey];
    if (!map) {
      resolve({ success: false, error: 'offscreen unavailable: unknown storage key ' + storageKey });
      return;
    }

    _offscreenInFlight += 1;
    if (_offscreenCloseTimer) {
      clearTimeout(_offscreenCloseTimer);
      _offscreenCloseTimer = null;
    }

    try {
      await ensureOffscreenDocument();
    } catch (error) {
      _offscreenInFlight = Math.max(0, _offscreenInFlight - 1);
      resolve({ success: false, error: 'offscreen unavailable: ' + (error?.message || String(error)) });
      return;
    }

    let settled = false;

    const listener = (msg) => {
      if (settled) return;
      if (msg?.type === resultType && msg?.pendingKey === pendingKey) {
        settled = true;
        cleanup();
        resolve(msg);
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        success: false,
        error:
          `${resultType} timed out after ${Math.round(timeoutMs / 1000)} s ` +
          `in the offscreen runner. Retry, or open the wallet popup to warm the PVAC WASM worker.`,
      });
    }, timeoutMs);

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      _offscreenInFlight = Math.max(0, _offscreenInFlight - 1);
      if (_offscreenInFlight === 0) scheduleOffscreenClose();
    };

    chrome.runtime.onMessage.addListener(listener);

    // Read the session snapshot here in the trusted service-worker context
    // and forward it to the offscreen. This removes the offscreen's need to
    // access chrome.storage.session, which is gated in some Chrome builds.
    const sessionSnapshot = await readSessionSnapshotForOffscreen();

    // Push the request directly to the offscreen. We use sendMessage so we
    // don't depend on storage-change events firing in the offscreen context.
    const pvacMsg = {
      type: 'OFFSCREEN_PVAC_REQUEST',
      op: map.op,
      pendingKey,
      sessionSnapshot,
      ...(requestData || {}),
    };

    const trySend = () => {
      try {
        // Fire-and-forget — the real reply arrives via chrome.runtime.sendMessage
        // from the offscreen with type `PVAC_*_RESULT`. Using no callback here
        // avoids "message channel closed" noise in the console.
        const p = chrome.runtime.sendMessage(pvacMsg);
        if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
      } catch {
        /* ignore — retry below if still pending */
      }
    };

    trySend();

    // Small retry in case the very first sendMessage races with the
    // offscreen's onMessage registration.
    setTimeout(() => {
      if (!settled) trySend();
    }, 250);
  });
}

// =============================================================================
// delegateToPvacPopup — single entry point used by every PVAC silent op
// =============================================================================
//
// Now smart: prefers the silent offscreen runner when possible. Only falls
// back to opening the real popup if the offscreen path is unavailable (e.g.
// browser doesn't expose chrome.offscreen, or wallet is locked and we
// genuinely need the user to unlock it through the popup UI).

/**
 * Shared helper: store a pending PVAC request and wait for the first runner
 * (offscreen preferred, popup fallback) to resolve it.
 *
 * @param {string} storageKey  - base key name, e.g. "pendingPvacDecrypt"
 * @param {string} pendingKey  - unique request ID
 * @param {object} requestData - data to store for runner
 * @param {string} resultType  - message type the runner sends back
 * @param {number} timeoutMs   - how long to wait before failing
 */
async function delegateToPvacPopup(storageKey, pendingKey, requestData, resultType, timeoutMs = 120_000) {
  const canUseOffscreen =
    typeof chrome !== 'undefined' &&
    !!chrome.offscreen?.createDocument &&
    OFFSCREEN_OP_KEYS.has(storageKey);

  if (canUseOffscreen) {
    const offscreenResult = await runInOffscreen(storageKey, pendingKey, requestData, resultType, timeoutMs);
    // Only fall back to the popup path when the offscreen runner itself
    // failed to start or the wallet is locked. Real PVAC errors (bad
    // cipher, decrypt failure, user data issue) surface directly.
    const shouldFallBack =
      offscreenResult?.success === false &&
      typeof offscreenResult.error === 'string' &&
      (offscreenResult.error.includes('offscreen unavailable') ||
        offscreenResult.error === 'Wallet locked');
    if (!shouldFallBack) return offscreenResult;
  }

  return delegateToPvacPopupLegacy(storageKey, pendingKey, requestData, resultType, timeoutMs);
}

/**
 * Original popup-delegated path, kept as a fallback. Opens the real popup
 * so the user can unlock the wallet or approve explicitly. Used when the
 * offscreen runner isn't available.
 */
function delegateToPvacPopupLegacy(storageKey, pendingKey, requestData, resultType, timeoutMs = 120_000) {
  return new Promise(async (resolve) => {
    await setStorageData(`${storageKey}_${pendingKey}`, { ...requestData, pendingKey, timestamp: Date.now() });
    await setStorageData(`${storageKey}Key`, pendingKey);

    // If the popup is already live (heartbeat within the last ~4 s) it will
    // pick up the new request via its chrome.storage.onChanged listener.
    // No need to call openPopup() again — which can fail silently and would
    // also race with the existing popup's own rendering.
    const popupAlive = isPopupLikelyAlive();
    let popupOpenedNow = false;

    if (!popupAlive) {
      try {
        await chrome.action.openPopup();
        popupOpenedNow = true;
        // openPopup() resolved, assume popup will heartbeat momentarily.
        _lastPopupHeartbeatAt = Date.now();
      } catch {
        popupOpenedNow = false;
      }
    }

    // Final fallback: when openPopup() failed and no heartbeat is active,
    // give the user 3 s to click the extension icon manually. If a heartbeat
    // arrives in that window, we keep waiting for the real result.
    let fastFailTimer = null;
    if (!popupAlive && !popupOpenedNow) {
      fastFailTimer = setTimeout(() => {
        if (isPopupLikelyAlive()) return; // user opened the popup manually
        cleanup();
        resolve({
          success: false,
          error:
            'Popup not open. Click the OctWa extension icon to unlock the popup, ' +
            'then retry. (PVAC delegation needs the popup to run the wallet private-key ops.)',
        });
      }, 3000);
    }

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      if (fastFailTimer) clearTimeout(fastFailTimer);
      chrome.storage.local.remove([`${storageKey}_${pendingKey}`, `${storageKey}Key`]);
    };

    const listener = (msg) => {
      if (msg.type === resultType && msg.pendingKey === pendingKey) {
        cleanup();
        resolve(msg);
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        success: false,
        error:
          `${resultType} timed out after ${Math.round(timeoutMs / 1000)} s. ` +
          `If this persists, click the OctWa extension icon to unlock the popup and retry. ` +
          `Some PVAC ops (first-call WASM boot, range proofs, scan of many outputs) can be slow.`,
      });
    }, timeoutMs);

    chrome.runtime.onMessage.addListener(listener);
  });
}

/**
 * PVAC_GET_IDENTITY — return wallet crypto identity to dApp.
 * Delegates to popup (needs private key to derive Curve25519 view keypair).
 * Auto-executes — no popup approval needed.
 */
async function handlePvacGetIdentity(data, sender) {
  const { appOrigin } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  const pendingKey = `pvac_identity_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await delegateToPvacPopup(
    'pendingPvacIdentity', pendingKey,
    { appOrigin, walletAddress: connection.walletPubKey },
    'PVAC_IDENTITY_RESULT'
  );

  if (!result.success) {
    return { type: 'PVAC_GET_IDENTITY_RESPONSE', success: false, error: result.error };
  }
  return { type: 'PVAC_GET_IDENTITY_RESPONSE', success: true, result: result.identity };
}

/**
 * PVAC_COMPUTE_SHARED_SECRET — ECDH with counterparty view pubkey.
 * Delegates to popup (needs private key for view keypair derivation).
 * Auto-executes — no popup approval needed.
 */
async function handlePvacComputeSharedSecret(data, sender) {
  const { theirViewPubkey, appOrigin } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  const pendingKey = `pvac_ecdh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await delegateToPvacPopup(
    'pendingPvacEcdh', pendingKey,
    { appOrigin, theirViewPubkey, walletAddress: connection.walletPubKey },
    'PVAC_ECDH_RESULT'
  );

  if (!result.success) {
    return { type: 'PVAC_COMPUTE_SHARED_SECRET_RESPONSE', success: false, error: result.error };
  }
  return { type: 'PVAC_COMPUTE_SHARED_SECRET_RESPONSE', success: true, result: result.sharedSecretResult };
}

/**
 * PVAC_DECRYPT_CIPHER — decrypt an hfhe_v1|... cipher using wallet PVAC key.
 * Delegates to popup WASM context.
 * Auto-executes — no popup approval needed.
 */
async function handlePvacDecryptCipher(data, sender) {
  const { cipher, appOrigin } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  if (!cipher || cipher === '0') {
    return { type: 'PVAC_DECRYPT_CIPHER_RESPONSE', success: true, result: { valueRaw: '0', valueOct: 0 } };
  }

  const pendingKey = `pvac_decrypt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await delegateToPvacPopup(
    'pendingPvacDecrypt', pendingKey,
    { appOrigin, cipher, walletAddress: connection.walletPubKey },
    'PVAC_DECRYPT_RESULT'
  );

  if (!result.success) {
    return { type: 'PVAC_DECRYPT_CIPHER_RESPONSE', success: false, error: result.error };
  }
  return {
    type: 'PVAC_DECRYPT_CIPHER_RESPONSE', success: true,
    result: { valueRaw: result.valueRaw, valueOct: result.valueOct },
  };
}

/**
 * PVAC_ENCRYPT_VALUE — encrypt a value using wallet PVAC public key.
 * Delegates to popup WASM context.
 * Auto-executes — no popup approval needed.
 */
async function handlePvacEncryptValue(data, sender) {
  const { valueRaw, appOrigin } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  const pendingKey = `pvac_encrypt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await delegateToPvacPopup(
    'pendingPvacEncrypt', pendingKey,
    { appOrigin, valueRaw, walletAddress: connection.walletPubKey },
    'PVAC_ENCRYPT_RESULT'
  );

  if (!result.success) {
    return { type: 'PVAC_ENCRYPT_VALUE_RESPONSE', success: false, error: result.error };
  }
  return { type: 'PVAC_ENCRYPT_VALUE_RESPONSE', success: true, result: { cipher: result.cipher } };
}

/**
 * PVAC_SCAN_OUTPUTS — scan stealth outputs using wallet private view key.
 * Delegates to popup (needs private key for ECDH per output).
 * Auto-executes — no popup approval needed. 5 min timeout for large sets.
 */
async function handlePvacScanOutputs(data, sender) {
  const { outputs, appOrigin } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  if (!Array.isArray(outputs) || outputs.length === 0) {
    return {
      type: 'PVAC_SCAN_OUTPUTS_RESPONSE', success: true,
      result: { outputs: [], totalScanned: 0, matched: 0 },
    };
  }

  const pendingKey = `pvac_scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await delegateToPvacPopup(
    'pendingPvacScan', pendingKey,
    { appOrigin, outputs, walletAddress: connection.walletPubKey },
    'PVAC_SCAN_RESULT',
    300_000  // 5 min — large output sets can take time
  );

  if (!result.success) {
    return { type: 'PVAC_SCAN_OUTPUTS_RESPONSE', success: false, error: result.error };
  }
  return { type: 'PVAC_SCAN_OUTPUTS_RESPONSE', success: true, result: result.scanResult };
}

/**
 * PVAC_SIGN_FOR_ZK — sign data for use as ZK proof public input.
 * Always opens a popup for user approval (write operation).
 */
async function handlePvacSignForZK(data, sender) {
  const { data: dataArray, domain, appOrigin, appName, appIcon } = data;
  const connection = await getConnection(appOrigin);
  if (!connection) throw new Error('Not connected to wallet');

  const pendingKey = `pvac_zk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingPvacZkSign_${pendingKey}`, {
    pendingKey, data: dataArray, domain, appOrigin, appName, appIcon,
    walletAddress: connection.walletPubKey, timestamp: Date.now(),
  });
  await setStorageData('pendingPvacZkSignKey', pendingKey);

  // ZK sign requires user approval — open popup
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`index.html?action=zkSign&pendingKey=${pendingKey}`),
      active: true,
    });
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingPvacZkSign_${pendingKey}`, 'pendingPvacZkSignKey']);
    };

    const listener = (msg) => {
      if (msg.type === 'PVAC_ZK_SIGN_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          resolve({
            type: 'PVAC_SIGN_FOR_ZK_RESPONSE', success: true,
            result: { signature: msg.signature, publicKey: msg.publicKey, dataHash: msg.dataHash },
          });
        } else {
          resolve({
            type: 'PVAC_SIGN_FOR_ZK_RESPONSE', success: false,
            error: msg.error || 'User rejected ZK sign request',
          });
        }
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ type: 'PVAC_SIGN_FOR_ZK_RESPONSE', success: false, error: 'ZK sign request timeout' });
    }, 60_000);

    chrome.runtime.onMessage.addListener(listener);
  });
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
