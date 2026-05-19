/**
 * Octra Wallet — Background Service Worker (RFC-O-1 Compliant)
 *
 * Routes RFC-O-1 provider methods:
 *   - Provider-native methods (octra_requestAccounts, octra_sendTransaction, etc.)
 *   - RPC pass-through (octra_balance, epoch_current, contract_call, etc.)
 *   - Privacy methods (octra_encryptBalance, octra_sendPrivateTransfer, etc.)
 *
 * Standard error codes:
 *   4001 — User rejected
 *   4100 — Unauthorized
 *   4200 — Unsupported method
 *   4900 — Disconnected
 *   4901 — Network unavailable
 *
 * Security:
 *   - Signing mutex prevents parallel signing / double-send
 *   - Origin binding enforced on every request
 *   - Permission checks before exposing accounts or signing
 *   - All fee estimates fetched live from node
 */

// =============================================================================
// Popup liveness tracker
// =============================================================================

let _lastPopupHeartbeatAt = 0;

function isPopupLikelyAlive() {
  return Date.now() - _lastPopupHeartbeatAt < 4000;
}

// =============================================================================
// Signing Mutex
// =============================================================================

let signingMutex = Promise.resolve();

async function withSigningLock(fn) {
  await signingMutex;
  let release;
  signingMutex = new Promise(resolve => { release = resolve; });
  try {
    return await fn();
  } finally {
    release();
  }
}


// =============================================================================
// Error Helpers (RFC-O-1 codes)
// =============================================================================

function rpcError(code, message, reason) {
  return { code, message, reason };
}

function errorResponse(code, message, reason) {
  return {
    success: false,
    error: message,
    errorCode: code,
    errorData: reason ? { reason } : undefined,
  };
}

function successResponse(result) {
  return { success: true, result };
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
  // Popup heartbeat
  if (message?.type === 'POPUP_HEARTBEAT') {
    _lastPopupHeartbeatAt = Date.now();
    try { sendResponse({ ok: true }); } catch {}
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

  // RFC-O-1 provider request from content script
  if (message.source === 'octra-content-script' && message.type === 'PROVIDER_REQUEST') {
    handleProviderRequest(message, sender)
      .then(response => {
        try { sendResponse(response); } catch {}
      })
      .catch(error => {
        try {
          sendResponse(errorResponse(4100, error?.message || 'Unknown error'));
        } catch {}
      });
    return true; // async response
  }

  return false;
});


// =============================================================================
// RFC-O-1 Request Router
// =============================================================================

async function handleProviderRequest(message, sender) {
  const { requestId, appOrigin, data } = message;
  const { method, params } = data;

  const senderOrigin = getSenderOrigin(sender);
  if (!senderOrigin) {
    return errorResponse(4100, 'Unable to determine sender origin');
  }

  // Origin validation
  const origin = appOrigin || senderOrigin;
  if (senderOrigin !== origin && senderOrigin !== chrome.runtime.getURL('').slice(0, -1)) {
    return errorResponse(4100, 'Origin mismatch');
  }

  console.log('[Background] RFC-O-1 request:', method, 'from:', origin);

  try {
    switch (method) {
      // ── Account/Permission methods ──────────────────────────────────────
      case 'octra_requestAccounts':
        return await handleRequestAccounts(origin, params, sender);
      case 'octra_disconnect':
        return await handleDisconnect(origin);
      case 'octra_accounts':
        return await handleAccounts(origin);
      case 'octra_networkId':
        return await handleNetworkId();
      case 'octra_networkInfo':
        return await handleNetworkInfo();
      case 'octra_permissions':
        return await handlePermissions(origin);
      case 'octra_switchNetwork':
        return await handleSwitchNetwork(origin, params, sender);

      // ── Transaction methods ─────────────────────────────────────────────
      case 'octra_signMessage':
        return await handleSignMessage(origin, params, sender);
      case 'octra_sendTransaction':
        return await handleSendTransaction(origin, params, sender);
      case 'octra_signTransaction':
        return await handleSignTransaction(origin, params, sender);
      case 'octra_submitTransaction':
        return await handleSubmitTransaction(origin, params, sender);

      // ── Contract methods ────────────────────────────────────────────────
      case 'octra_callContract':
        return await handleCallContract(origin, params);
      case 'octra_sendContractTransaction':
        return await handleSendContractTransaction(origin, params, sender);
      case 'octra_getContractReceipt':
        return await handleGetContractReceipt(params);

      // ── Privacy methods ─────────────────────────────────────────────────
      case 'octra_getEncryptedBalance':
        return await handleGetEncryptedBalance(origin, params);
      case 'octra_encryptBalance':
        return await handleEncryptBalance(origin, params, sender);
      case 'octra_decryptBalance':
        return await handleDecryptBalance(origin, params, sender);
      case 'octra_sendPrivateTransfer':
        return await handleSendPrivateTransfer(origin, params, sender);
      case 'octra_scanStealth':
        return await handleScanStealth(origin, params);
      case 'octra_claimStealth':
        return await handleClaimStealth(origin, params, sender);

      // ── EVM methods ─────────────────────────────────────────────────────
      case 'evm_getDerivedAddress':
        return await handleEvmGetDerivedAddress(origin);
      case 'evm_getChainId':
        return await handleEvmGetChainId();
      case 'evm_getNetworkInfo':
        return await handleEvmGetNetworkInfo();
      case 'evm_getBalance':
        return await handleEvmGetBalance(origin, params);
      case 'evm_switchChain':
        return await handleEvmSwitchChain(origin, params, sender);
      case 'evm_sendTransaction':
        return await handleEvmSendTransaction(origin, params, sender);
      case 'evm_signMessage':
        return await handleEvmSignMessage(origin, params, sender);
      case 'evm_signTypedData':
        return await handleEvmSignTypedData(origin, params, sender);
      case 'evm_getTokenBalance':
        return await handleEvmGetTokenBalance(origin, params);
      case 'evm_getTokenInfo':
        return await handleEvmGetTokenInfo(origin, params);
      case 'evm_transferToken':
        return await handleEvmTransferToken(origin, params, sender);
      case 'evm_approveToken':
        return await handleEvmApproveToken(origin, params, sender);
      case 'evm_getAllowance':
        return await handleEvmGetAllowance(origin, params);
      case 'evm_call':
        return await handleEvmCall(origin, params);
      case 'evm_estimateGas':
        return await handleEvmEstimateGas(origin, params);
      case 'evm_getGasPrice':
        return await handleEvmGetGasPrice(origin);

      // ── Sensitive write pass-through (confirmation required) ────────────
      case 'octra_submit':
      case 'octra_submitBatch':
      case 'octra_privateTransfer':
      case 'octra_registerPublicKey':
      case 'octra_registerPvacPubkey':
      case 'staging_remove':
      case 'contract_verify':
      case 'contract_saveAbi':
        return await handleSensitiveWrite(origin, method, params, sender);

      // ── RPC pass-through (read-only) ────────────────────────────────────
      default:
        return await handleRpcPassthrough(method, params);
    }
  } catch (error) {
    console.error('[Background] Request error:', method, error);
    return errorResponse(4100, error?.message || 'Request failed');
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
// RPC Infrastructure
// =============================================================================

const DEFAULT_RPC_URL        = '__VITE_OCTRA_RPC_URL__';
const DEFAULT_RPC_URL_DEVNET = '__VITE_OCTRA_RPC_URL_DEVNET__';

/**
 * Hostname-substring matcher used to classify a stored RPC URL as devnet.
 * Driven by build-time `__VITE_OCTRA_RPC_URL_DEVNET__` so rotating the devnet
 * IP only requires updating `.env`. The legacy hostname `devnet.octrascan` is
 * kept so older user installs that still have it stored continue to be
 * recognised correctly.
 */
function isDevnetRpcUrl(url) {
  if (!url) return false;
  const lower = String(url).toLowerCase();
  if (DEFAULT_RPC_URL_DEVNET) {
    const host = DEFAULT_RPC_URL_DEVNET.replace(/^https?:\/\//, '').toLowerCase();
    if (host && lower.includes(host)) return true;
  }
  return lower.includes('devnet.octrascan');
}

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
  const normalized = baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/rpc') ? normalized : `${normalized}/rpc`;
}

async function rpcCall(method, params = []) {
  const rpcUrl = await getActiveOctraRpcUrl();
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP error: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data.result;
}

async function fetchCurrentEpoch() {
  try {
    const result = await rpcCall('epoch_current', []);
    return result?.epoch_id ?? 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// Network Configuration
// =============================================================================

async function getActiveNetwork() {
  try {
    const result = await chrome.storage.local.get(['rpcProviders', 'activeNetworkId']);
    let networkId = result.activeNetworkId || 'octra:mainnet-alpha';

    if (result.rpcProviders) {
      const providers = JSON.parse(result.rpcProviders);
      const active = providers.find(p => p.isActive);
      if (active) {
        if (isDevnetRpcUrl(active.url)) {
          networkId = 'octra:devnet';
        }
      }
    }
    return networkId;
  } catch {
    return 'octra:mainnet-alpha';
  }
}

async function getNetworkInfo() {
  const networkId = await getActiveNetwork();
  const rpcUrl = await getActiveOctraRpcUrl();
  const isDevnet = networkId.includes('devnet');

  return {
    id: networkId,
    name: isDevnet ? 'Octra Devnet' : 'Octra Mainnet Alpha',
    rpcUrl: rpcUrl.replace('/rpc', ''),
    explorerUrl: isDevnet ? 'https://devnet.octrascan.io' : 'https://octrascan.io',
    supportsPrivacy: true,
    isTestnet: isDevnet,
  };
}


// =============================================================================
// Permission / Connection Storage
// =============================================================================

function canonicalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  try { return new URL(trimmed).origin; } catch { return trimmed.toLowerCase(); }
}

async function getConnection(appOrigin) {
  const key = canonicalizeOrigin(appOrigin);
  try {
    const result = await chrome.storage.local.get(['connectedDApps']);
    const dapps = result.connectedDApps || {};
    return dapps[key] || null;
  } catch { return null; }
}

async function saveConnection(connection) {
  const key = canonicalizeOrigin(connection.appOrigin);
  try {
    const result = await chrome.storage.local.get(['connectedDApps']);
    const dapps = result.connectedDApps || {};
    dapps[key] = connection;
    await chrome.storage.local.set({ connectedDApps: dapps });
  } catch (e) {
    console.error('[Background] Failed to save connection:', e);
  }
}

async function removeConnection(appOrigin) {
  const key = canonicalizeOrigin(appOrigin);
  try {
    const result = await chrome.storage.local.get(['connectedDApps']);
    const dapps = result.connectedDApps || {};
    const existed = Boolean(dapps[key]);
    delete dapps[key];
    await chrome.storage.local.set({ connectedDApps: dapps });
    if (existed) {
      // Notify the dApp that the wallet revoked its session.
      broadcastEvent('disconnect', { reason: 'connection_removed' });
      broadcastEvent('accountsChanged', []);
    }
  } catch {}
}

async function getPermissions(appOrigin) {
  const connection = await getConnection(appOrigin);
  return connection?.permissions || [];
}

async function savePermissions(appOrigin, permissions) {
  const connection = await getConnection(appOrigin);
  if (connection) {
    connection.permissions = permissions;
    await saveConnection(connection);
  }
}

async function hasPermission(appOrigin, permission) {
  const perms = await getPermissions(appOrigin);
  return perms.includes(permission);
}

async function getActiveWalletAddress() {
  try {
    const stored = await chrome.storage.local.get(['activeWalletId']);
    return stored.activeWalletId || null;
  } catch { return null; }
}

async function lockWallet() {
  try {
    await chrome.storage.local.set({ walletLocked: true });
  } catch {}
}

async function isWalletLocked() {
  try {
    const result = await chrome.storage.local.get(['walletLocked']);
    return result.walletLocked === true;
  } catch { return true; }
}

// Helper to set storage data
async function setStorageData(key, value) {
  await chrome.storage.local.set({ [key]: value });
}


// =============================================================================
// Account / Permission Handlers
// =============================================================================

async function handleRequestAccounts(origin, params, sender) {
  const requestedPerms = params?.[0]?.permissions || ['read_address', 'read_balance'];
  const networkId = params?.[0]?.networkId;

  // Check if already connected with same wallet
  const existing = await getConnection(origin);
  if (existing) {
    const activeWallet = await getActiveWalletAddress();
    if (activeWallet && activeWallet === existing.walletAddress) {
      // Already connected, merge permissions
      const currentPerms = existing.permissions || [];
      const merged = [...new Set([...currentPerms, ...requestedPerms])];
      await savePermissions(origin, merged);
      return successResponse([existing.walletAddress]);
    }
    // Wallet changed — clear stale connection
    await removeConnection(origin);
  }

  // Need user approval — open popup
  const pendingKey = `connect_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await setStorageData(`pendingConnectRequest_${pendingKey}`, {
    pendingKey,
    appOrigin: origin,
    appName: new URL(origin).hostname,
    permissions: requestedPerms,
    networkId,
    timestamp: Date.now(),
  });
  await setStorageData('pendingConnectRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {
    const url = chrome.runtime.getURL(
      `index.html?action=connect&appOrigin=${encodeURIComponent(origin)}`
    );
    await chrome.tabs.create({ url, active: true });
  }

  // Wait for user response
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([
        `pendingConnectRequest_${pendingKey}`,
        'pendingConnectRequestKey',
      ]);
    };

    const listener = async (msg) => {
      if (msg.type === 'CONNECTION_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          const walletAddress = msg.walletPubKey || msg.address;
          await saveConnection({
            appOrigin: origin,
            walletAddress,
            permissions: requestedPerms,
            network: msg.network || 'mainnet',
            connectedAt: Date.now(),
          });

          // Clear stale per-origin EVM chain so dApp starts on the global chain
          await clearOriginEvmChain(origin);

          // RFC-O-1 events: a successful connect MUST emit accountsChanged
          // and connect so dApps can pick up the freshly-authorized session
          // without having to re-poll. The network info goes into the
          // connect payload so dApps can hydrate networkId/networkInfo
          // in one shot.
          try {
            const networkInfo = await getNetworkInfo();
            broadcastEvent('connect', {
              networkId: networkInfo.id,
              networkInfo,
            });
            broadcastEvent('accountsChanged', [walletAddress]);
            broadcastEvent('permissionsChanged', requestedPerms);
          } catch (err) {
            console.warn('[bg] failed to broadcast connect events', err);
          }

          resolve(successResponse([walletAddress]));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
    }, 300000);

    chrome.runtime.onMessage.addListener(listener);
  });
}

async function handleAccounts(origin) {
  const connection = await getConnection(origin);
  if (!connection) return successResponse([]);
  return successResponse([connection.walletAddress]);
}

/**
 * Revoke the dApp's session for this origin and clear any per-origin EVM
 * chain preference. Subsequent `connect()` calls will trigger a fresh
 * approval popup, letting the user pick a different wallet if desired.
 */
async function handleDisconnect(origin) {
  await clearOriginEvmChain(origin);
  await removeConnection(origin);
  return successResponse({ disconnected: true });
}

async function handleNetworkId() {
  const networkId = await getActiveNetwork();
  return successResponse(networkId);
}

async function handleNetworkInfo() {
  const info = await getNetworkInfo();
  return successResponse(info);
}

async function handlePermissions(origin) {
  const perms = await getPermissions(origin);
  return successResponse(perms);
}

async function handleSwitchNetwork(origin, params, sender) {
  const networkId = params?.[0]?.networkId;
  if (!networkId) return errorResponse(4200, 'networkId is required');

  // Validate format per RFC-O-1 — Octra ids look like `octra:<chain>`.
  if (!networkId.startsWith('octra:')) {
    return errorResponse(4901, 'Invalid network ID format', 'invalid_network');
  }

  // Find a stored RPC provider that serves the requested network.
  let providers = [];
  try {
    const result = await chrome.storage.local.get(['rpcProviders']);
    if (result.rpcProviders) providers = JSON.parse(result.rpcProviders);
  } catch { /* providers stays empty */ }

  const wantsDevnet = networkId.includes('devnet');
  const matchProvider = (p) => {
    if (!p?.url) return false;
    if (p.network === 'devnet') return wantsDevnet;
    if (p.network === 'mainnet') return !wantsDevnet;
    return wantsDevnet ? isDevnetRpcUrl(p.url) : !isDevnetRpcUrl(p.url);
  };

  const target = providers.find(matchProvider);
  if (!target) {
    return errorResponse(
      4901,
      `No RPC provider configured for network: ${networkId}`,
      'invalid_network',
    );
  }

  // If already on the target network, return immediately without popup
  const currentNetworkId = await getActiveNetwork();
  if (currentNetworkId === networkId) {
    const info = await getNetworkInfo();
    return successResponse(info);
  }

  // Require user approval before switching
  const pendingKey = `switchnet_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const currentInfo = await getNetworkInfo();
  await setStorageData(`pendingSwitchNetworkRequest_${pendingKey}`, {
    pendingKey, appOrigin: origin,
    fromNetworkId: currentNetworkId, fromName: currentInfo.name,
    toNetworkId: networkId, toName: wantsDevnet ? 'Octra Devnet' : 'Octra Mainnet Alpha',
    timestamp: Date.now(),
  });
  await setStorageData('pendingSwitchNetworkRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingSwitchNetworkRequest_${pendingKey}`, 'pendingSwitchNetworkRequestKey']);
    };

    const listener = async (msg) => {
      if (msg.type === 'SWITCH_NETWORK_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          // Flip isActive on providers
          const next = providers.map((p) => ({ ...p, isActive: p.id === target.id }));
          await chrome.storage.local.set({
            rpcProviders: JSON.stringify(next),
            activeNetworkId: networkId,
            selectedNetwork: target.network ?? (wantsDevnet ? 'devnet' : 'mainnet'),
          });

          const info = await getNetworkInfo();
          if (info.id !== networkId) {
            resolve(errorResponse(4901, `Failed to activate ${networkId} (active is ${info.id})`, 'invalid_network'));
            return;
          }

          // Notify wallet UI to sync localStorage (background can't access localStorage)
          broadcastInternalSync('SYNC_RPC_PROVIDERS', { rpcProviders: JSON.stringify(next), selectedNetwork: target.network ?? (wantsDevnet ? 'devnet' : 'mainnet') });
          broadcastEvent('networkChanged', info);
          resolve(successResponse(info));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 60000);
    chrome.runtime.onMessage.addListener(listener);
  });
}


// =============================================================================
// Transaction Handlers
// =============================================================================

async function handleSignMessage(origin, params, sender) {
  if (!await hasPermission(origin, 'sign_messages')) {
    return errorResponse(4100, 'Unauthorized: sign_messages permission required', 'unauthorized');
  }

  const message = params?.[0]?.message;
  const address = params?.[0]?.address;
  if (!message || typeof message !== 'string') {
    return errorResponse(4200, 'message is required');
  }

  // Require user approval
  const pendingKey = `sign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingSignRequest_${pendingKey}`, {
    pendingKey, appOrigin: origin, message, address, timestamp: Date.now(),
  });
  await setStorageData('pendingSignRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingSignRequest_${pendingKey}`, 'pendingSignRequestKey']);
    };

    const listener = (msg) => {
      if (msg.type === 'SIGN_MESSAGE_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          resolve(successResponse({
            address: msg.address,
            publicKey: msg.publicKey,
            signature: msg.signature,
          }));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 60000);
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function handleSendTransaction(origin, params, sender) {
  if (!await hasPermission(origin, 'send_transactions')) {
    return errorResponse(4100, 'Unauthorized: send_transactions permission required', 'unauthorized');
  }

  const txParams = params?.[0];
  if (!txParams?.to) return errorResponse(4200, 'to address is required', 'invalid_address');
  if (!txParams?.amount) return errorResponse(4200, 'amount is required', 'invalid_amount');

  return withSigningLock(async () => {
    const pendingKey = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingTxRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      to: txParams.to, amount: txParams.amount,
      fee: txParams.fee, message: txParams.message,
      timestamp: Date.now(),
    });
    await setStorageData('pendingTxRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingTxRequest_${pendingKey}`, 'pendingTxRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'TX_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleSignTransaction(origin, params, sender) {
  if (!await hasPermission(origin, 'send_transactions')) {
    return errorResponse(4100, 'Unauthorized: send_transactions permission required', 'unauthorized');
  }

  const txParams = params?.[0];
  if (!txParams?.to) return errorResponse(4200, 'to address is required', 'invalid_address');
  if (!txParams?.amount) return errorResponse(4200, 'amount is required', 'invalid_amount');
  if (!txParams?.fee) return errorResponse(4200, 'fee is required', 'fee_too_low');

  return withSigningLock(async () => {
    const pendingKey = `signtx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingSignTxRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      to: txParams.to, amount: txParams.amount,
      fee: txParams.fee, nonce: txParams.nonce, message: txParams.message,
      timestamp: Date.now(),
    });
    await setStorageData('pendingSignTxRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingSignTxRequest_${pendingKey}`, 'pendingSignTxRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'SIGN_TX_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            resolve(successResponse(msg.signedTx));
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleSubmitTransaction(origin, params, sender) {
  if (!await hasPermission(origin, 'send_transactions')) {
    return errorResponse(4100, 'Unauthorized: send_transactions permission required', 'unauthorized');
  }

  const signedTx = params?.[0]?.tx;
  if (!signedTx) return errorResponse(4200, 'Signed transaction is required');

  try {
    const result = await rpcCall('octra_submit', [signedTx]);
    const hash = result?.hash || result?.tx_hash;
    return await pendingTxResponse({
      hash,
      // Mirror the RFC-O-1 result shape — submitTransaction may not have
      // popped a popup (the tx was pre-signed by signTransaction) so the
      // nonce / ou come straight from the signed payload.
      nonce:  signedTx.nonce,
      ouCost: typeof signedTx.ou === 'string' ? signedTx.ou : String(signedTx.ou ?? ''),
    });
  } catch (error) {
    return errorResponse(4100, error.message, 'submission_failed');
  }
}


// =============================================================================
// Contract Handlers
// =============================================================================

async function handleCallContract(origin, params) {
  const p = params?.[0];
  if (!p?.address) return errorResponse(4200, 'Contract address is required');
  if (!p?.method) return errorResponse(4200, 'Method name is required');

  try {
    const result = await rpcCall('contract_call', [p.address, p.method, p.params || [], p.caller || '']);
    return successResponse(result);
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleSendContractTransaction(origin, params, sender) {
  if (!await hasPermission(origin, 'contract_calls')) {
    return errorResponse(4100, 'Unauthorized: contract_calls permission required', 'unauthorized');
  }

  const p = params?.[0];
  if (!p?.address) return errorResponse(4200, 'Contract address is required');
  if (!p?.method) return errorResponse(4200, 'Method name is required');

  return withSigningLock(async () => {
    const pendingKey = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingContractRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      address: p.address, method: p.method,
      params: p.params || [], amount: p.amount || '0', fee: p.fee,
      timestamp: Date.now(),
    });
    await setStorageData('pendingContractRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingContractRequest_${pendingKey}`, 'pendingContractRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'CONTRACT_TX_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleGetContractReceipt(params) {
  const hash = params?.[0]?.hash;
  if (!hash) return errorResponse(4200, 'Transaction hash is required');

  try {
    const result = await rpcCall('contract_receipt', [hash]);
    return successResponse(result);
  } catch (error) {
    // The node returns "not found" until the contract tx has actually
    // landed on-chain. That's a *temporal* condition, not an auth
    // failure — surface it as 4900 with reason `receipt_not_found`
    // so dApps can poll instead of treating it as a hard error.
    const msg = String(error?.message ?? error);
    if (/not\s*found/i.test(msg)) {
      return errorResponse(4900, 'Receipt not yet available', 'receipt_not_found');
    }
    return errorResponse(4100, msg);
  }
}


// =============================================================================
// Privacy Handlers
// =============================================================================

async function handleGetEncryptedBalance(origin, params) {
  if (!await hasPermission(origin, 'view_encrypted_balance')) {
    return errorResponse(4100, 'Unauthorized: view_encrypted_balance permission required', 'unauthorized');
  }

  const connection = await getConnection(origin);
  if (!connection) return errorResponse(4100, 'Not connected', 'unauthorized');

  const address = params?.[0]?.address || connection.walletAddress;

  try {
    // Check if PVAC pubkey is registered
    let hasPvacPubkey = false;
    try {
      const pvacResult = await rpcCall('octra_pvacPubkey', [address]);
      hasPvacPubkey = !!pvacResult && pvacResult !== '0' && pvacResult !== '';
    } catch {}

    // Fetch the encrypted-balance cipher. The node has historically
    // returned the cipher in one of three shapes:
    //   - bare string: "hfhe_v1|..." or just "0"
    //   - bare "0" string when no encrypted balance exists
    //   - an object: { cipher: "...", cipher_type: "pvac_fhe" }
    // Be defensive about all three so we never hand a non-string to
    // .startsWith — the previous version threw "cipher.startsWith is
    // not a function" whenever the node returned the object shape.
    let cipher = '0';
    let nodeCipherType;
    try {
      const cipherResult = await rpcCall('octra_encryptedCipher', [address]);
      cipher = extractCipherString(cipherResult);
      // The node may also report its own cipher type (e.g. "pvac_fhe")
      // directly in the response — surface it verbatim when present.
      if (cipherResult && typeof cipherResult === 'object') {
        const ct = cipherResult.cipher_type ?? cipherResult.cipherType;
        if (typeof ct === 'string') nodeCipherType = ct;
      }
    } catch {}

    // Background.js can't run PVAC WASM (service workers can't host
    // pthread-enabled modules) so we can't decrypt on demand here.
    // The wallet UI persists its decrypted-balance result in the
    // shared apiCache after the user unlocks privacy mode — surface
    // that value when it's still fresh so dApps don't need to ask
    // the user to open the wallet just to read the encrypted balance.
    const decryptedAmount = await readCachedDecryptedAmount(address);

    // Detect the wire prefix the wallet's PVAC client uses ('hfhe_v1|') and
    // fall back to the node-reported cipher_type if one was supplied.
    const cipherType = typeof cipher === 'string' && cipher.startsWith('hfhe_v1|')
      ? 'hfhe_v1'
      : (nodeCipherType ?? undefined);

    return successResponse({
      address,
      cipher,
      cipherType,
      hasPvacPubkey,
      decryptedAmount,
    });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

/**
 * Normalise whatever shape `octra_encryptedCipher` returns into a plain
 * string. Returns '0' for any payload that doesn't carry a usable cipher.
 */
function extractCipherString(value) {
  if (typeof value === 'string') return value || '0';
  if (value && typeof value === 'object') {
    if (typeof value.cipher === 'string')          return value.cipher || '0';
    if (typeof value.encrypted_data === 'string')  return value.encrypted_data || '0';
    if (typeof value.value === 'string')           return value.value || '0';
  }
  return '0';
}

/**
 * Pull the wallet's most recently decrypted encrypted-balance value out of
 * the shared apiCache (`chrome.storage.local.octwa_api_cache`). Returns the
 * raw OU figure as a string per RFC-O-1's `decryptedAmount` shape, or
 * undefined when no fresh entry exists.
 *
 * Strategy:
 *   1. Try the existing apiCache — fast, populated whenever the wallet UI
 *      has decrypted recently.
 *   2. Fall back to a delegated request to any open wallet page. The
 *      page (WalletDashboard) listens for BG_DECRYPT_BALANCE_REQUEST,
 *      runs the PVAC worker, and posts the result back. We can't run
 *      PVAC WASM inside the MV3 service worker itself.
 *   3. If neither path returns within the timeout, give up and let the
 *      dApp see `decryptedAmount: undefined` — honest contract.
 */
async function readCachedDecryptedAmount(address) {
  // 1. apiCache lookup
  try {
    const stored = await chrome.storage.local.get(['octwa_api_cache']);
    const cache = stored?.octwa_api_cache;
    if (cache?.encryptedBalance) {
      const networkKey = await deriveNetworkCacheKey();
      const candidates = [
        `${networkKey}:${address}`,
        `mainnet:${address}`,
        `devnet:${address}`,
      ];
      for (const key of candidates) {
        const entry = cache.encryptedBalance[key];
        const raw = entry?.data?.encrypted_raw;
        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
          return String(raw);
        }
      }
    }
  } catch { /* fall through to delegation */ }

  // 2. Delegated decrypt to any open wallet page
  try {
    const delegated = await delegateDecryptToWallet(address, 4000);
    if (delegated !== undefined) return delegated;
  } catch { /* swallow */ }

  return undefined;
}

/**
 * Ask any open wallet page (popup / expanded / dApp request handler) to
 * decrypt the encrypted balance for `address` and return the raw OU value
 * as a string. Resolves with undefined on timeout.
 */
function delegateDecryptToWallet(address, timeoutMs) {
  return new Promise((resolve) => {
    const requestId = `bg_decrypt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve(value);
    };

    const listener = (msg) => {
      if (msg?.type === 'BG_DECRYPT_BALANCE_RESPONSE' && msg.requestId === requestId) {
        if (msg.success && msg.decryptedAmount !== undefined) {
          finish(String(msg.decryptedAmount));
        } else {
          finish(undefined);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    const timer = setTimeout(() => finish(undefined), timeoutMs);

    try {
      chrome.runtime.sendMessage({
        type: 'BG_DECRYPT_BALANCE_REQUEST',
        requestId,
        address,
      });
    } catch {
      // No listener at all — wallet not open. Give up.
      finish(undefined);
    }
  });
}

/**
 * Mirror `getNetworkCacheKey` from utils/api.ts so the apiCache lookup keys
 * line up. The wallet UI uses the same logic, but the source there reads
 * from `localStorage` (UI-side); here we read from chrome.storage so the
 * service worker has access.
 */
async function deriveNetworkCacheKey() {
  try {
    const stored = await chrome.storage.local.get(['rpcProviders']);
    if (!stored?.rpcProviders) return 'mainnet';
    const providers = JSON.parse(stored.rpcProviders);
    const active = providers.find((p) => p.isActive);
    if (!active?.url) return 'mainnet';
    const url = String(active.url).replace(/\/$/, '').toLowerCase();
    if (url.includes('devnet')) return 'devnet';
    const host = url.replace(/https?:\/\//, '').split('/')[0].split(':')[0];
    return host.replace(/\./g, '_');
  } catch {
    return 'mainnet';
  }
}

async function handleEncryptBalance(origin, params, sender) {
  if (!await hasPermission(origin, 'encrypt_balance')) {
    return errorResponse(4100, 'Unauthorized: encrypt_balance permission required', 'unauthorized');
  }

  const amount = params?.[0]?.amount;
  if (!amount) return errorResponse(4200, 'amount is required', 'invalid_amount');

  return withSigningLock(async () => {
    const pendingKey = `encrypt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingEncryptRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin, amount, fee: params?.[0]?.fee, timestamp: Date.now(),
    });
    await setStorageData('pendingEncryptRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingEncryptRequest_${pendingKey}`, 'pendingEncryptRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'ENCRYPT_BALANCE_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleDecryptBalance(origin, params, sender) {
  if (!await hasPermission(origin, 'decrypt_balance')) {
    return errorResponse(4100, 'Unauthorized: decrypt_balance permission required', 'unauthorized');
  }

  const amount = params?.[0]?.amount;
  if (!amount) return errorResponse(4200, 'amount is required', 'invalid_amount');

  return withSigningLock(async () => {
    const pendingKey = `decrypt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingDecryptRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin, amount, fee: params?.[0]?.fee, timestamp: Date.now(),
    });
    await setStorageData('pendingDecryptRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingDecryptRequest_${pendingKey}`, 'pendingDecryptRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'DECRYPT_BALANCE_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleSendPrivateTransfer(origin, params, sender) {
  if (!await hasPermission(origin, 'private_transfers')) {
    return errorResponse(4100, 'Unauthorized: private_transfers permission required', 'unauthorized');
  }

  const p = params?.[0];
  if (!p?.to) return errorResponse(4200, 'to address is required', 'invalid_address');
  if (!p?.amount) return errorResponse(4200, 'amount is required', 'invalid_amount');

  return withSigningLock(async () => {
    const pendingKey = `stealth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingStealthRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin, to: p.to, amount: p.amount, fee: p.fee, timestamp: Date.now(),
    });
    await setStorageData('pendingStealthRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingStealthRequest_${pendingKey}`, 'pendingStealthRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'STEALTH_SEND_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleScanStealth(origin, params) {
  if (!await hasPermission(origin, 'stealth_scan')) {
    return errorResponse(4100, 'Unauthorized: stealth_scan permission required', 'unauthorized');
  }

  const fromEpoch = params?.[0]?.fromEpoch || 0;

  try {
    const outputs = await rpcCall('octra_stealthOutputs', [fromEpoch]);
    return successResponse(outputs || []);
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleClaimStealth(origin, params, sender) {
  if (!await hasPermission(origin, 'stealth_claim')) {
    return errorResponse(4100, 'Unauthorized: stealth_claim permission required', 'unauthorized');
  }

  const outputId = params?.[0]?.outputId;
  if (!outputId) return errorResponse(4200, 'outputId is required');

  return withSigningLock(async () => {
    const pendingKey = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await setStorageData(`pendingClaimRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin, outputId, fee: params?.[0]?.fee, timestamp: Date.now(),
    });
    await setStorageData('pendingClaimRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingClaimRequest_${pendingKey}`, 'pendingClaimRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'STEALTH_CLAIM_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            pendingTxResponse(msg).then(resolve);
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}


// =============================================================================
// RPC Pass-Through (Read-Only)
// =============================================================================

const RPC_PASSTHROUGH_METHODS = new Set([
  'node_version', 'node_status', 'node_stats', 'node_metrics',
  'octra_balance', 'octra_account', 'octra_nonce', 'octra_publicKey',
  'octra_validateAddress', 'octra_supply',
  'octra_transaction', 'octra_recentTransactions', 'octra_transactions',
  'octra_transactionsByAddress', 'octra_transactionsByEpoch',
  'octra_totalTransactions', 'octra_search',
  'epoch_current', 'epoch_get', 'epoch_list', 'epoch_summaries',
  'octra_recommendedFee', 'staging_view', 'staging_stats', 'staging_estimateOu',
  'vm_contract', 'octra_contractAbi', 'octra_contractStorage',
  'octra_listContracts', 'contract_receipt', 'contract_call',
  'octra_computeContractAddress',
  'octra_compileAssembly', 'octra_compileAml', 'octra_compileAmlMulti',
  'octra_encryptedCipher', 'octra_encryptedBalance', 'octra_pvacPubkey',
  'octra_viewPubkey', 'octra_stealthOutputs',
  'contract_source',
  'octra_tokensByAddress',
]);

async function handleRpcPassthrough(method, params) {
  if (!RPC_PASSTHROUGH_METHODS.has(method)) {
    return errorResponse(4200, `Unsupported method: ${method}`);
  }

  // Native RPC uses positional array params
  const rpcParams = Array.isArray(params) ? params : [];

  try {
    const result = await rpcCall(method, rpcParams);
    return successResponse(result);
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

// =============================================================================
// Sensitive Write Pass-Through (Confirmation Required)
// =============================================================================

async function handleSensitiveWrite(origin, method, params, sender) {
  const connection = await getConnection(origin);
  if (!connection) {
    return errorResponse(4100, 'Not connected', 'unauthorized');
  }

  // These methods require explicit user confirmation
  const pendingKey = `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingSensitiveWrite_${pendingKey}`, {
    pendingKey, appOrigin: origin, method, params, timestamp: Date.now(),
  });
  await setStorageData('pendingSensitiveWriteKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingSensitiveWrite_${pendingKey}`, 'pendingSensitiveWriteKey']);
    };

    const listener = async (msg) => {
      if (msg.type === 'SENSITIVE_WRITE_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          try {
            const rpcParams = Array.isArray(params) ? params : [];
            const result = await rpcCall(method, rpcParams);
            resolve(successResponse(result));
          } catch (error) {
            resolve(errorResponse(4100, error.message));
          }
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
    chrome.runtime.onMessage.addListener(listener);
  });
}

// =============================================================================
// Event Broadcasting
// =============================================================================

/**
 * Build a successful pending-tx response and announce it to every
 * connected dApp so they can react to the new pending hash without
 * polling. Used by every popup-driven write handler.
 *
 * Adds an `explorerUrl` synthesised from the active network so the
 * dApp can deep-link the user straight to the tx page. Async so it
 * can resolve the active network without forcing every caller to
 * pre-warm a cache.
 */
async function pendingTxResponse(msg) {
  if (msg.hash) broadcastEvent('transactionChanged', { hash: msg.hash, status: 'pending' });

  let explorerUrl = msg.explorerUrl;
  if (!explorerUrl && msg.hash) {
    try {
      const networkId = await getActiveNetwork();
      const base = networkId.includes('devnet')
        ? 'https://devnet.octrascan.io'
        : 'https://octrascan.io';
      explorerUrl = `${base}/tx.html?hash=${msg.hash}`;
    } catch { /* keep undefined */ }
  }

  return successResponse({
    hash:        msg.hash,
    accepted:    true,
    status:      'pending',
    nonce:       msg.nonce,
    ouCost:      msg.ouCost,
    explorerUrl,
  });
}

function broadcastEvent(event, payload) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'PROVIDER_EVENT',
          event,
          payload,
        }).catch(() => {});
      } catch {}
    }
  });
}

/**
 * Broadcast an internal sync message to all extension pages (popup, expanded,
 * tabs showing the wallet). These messages are picked up by chrome.runtime
 * listeners inside the wallet UI to mirror storage changes to localStorage.
 */
function broadcastInternalSync(type, data) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
}


// =============================================================================
// EVM Per-Origin Chain Scoping
// =============================================================================

/**
 * Each dApp origin can have its own preferred EVM chain. When a dApp calls
 * evm_getChainId / evm_getBalance / evm_sendTransaction, the wallet resolves
 * the active chain by:
 *   1. Per-origin override (if the dApp previously called switchChain)
 *   2. Global active_evm_network (fallback — what the wallet UI shows)
 *
 * This keeps parallel dApps on different chains from interfering with each
 * other while maintaining backward-compatible global behavior for dApps that
 * never call switchChain.
 */

async function saveOriginEvmChain(origin, networkId) {
  try {
    const key = canonicalizeOrigin(origin);
    const result = await chrome.storage.local.get(['evmOriginChains']);
    const map = result.evmOriginChains ? JSON.parse(result.evmOriginChains) : {};
    map[key] = networkId;
    await chrome.storage.local.set({ evmOriginChains: JSON.stringify(map) });
  } catch (e) {
    console.warn('[Background] Failed to save origin EVM chain:', e);
  }
}

async function getOriginEvmChain(origin) {
  try {
    const key = canonicalizeOrigin(origin);
    const result = await chrome.storage.local.get(['evmOriginChains']);
    const map = result.evmOriginChains ? JSON.parse(result.evmOriginChains) : {};
    return map[key] || null;
  } catch {
    return null;
  }
}

async function clearOriginEvmChain(origin) {
  try {
    const key = canonicalizeOrigin(origin);
    const result = await chrome.storage.local.get(['evmOriginChains']);
    const map = result.evmOriginChains ? JSON.parse(result.evmOriginChains) : {};
    if (map[key]) {
      delete map[key];
      await chrome.storage.local.set({ evmOriginChains: JSON.stringify(map) });
    }
  } catch {}
}

/**
 * Resolve the effective EVM network for a given origin.
 * Returns the per-origin chain if set, otherwise the global active chain.
 */
async function getEffectiveEvmNetwork(origin) {
  const originChainId = await getOriginEvmChain(origin);
  if (originChainId) {
    const all = await getAllEvmNetworks();
    const found = all.find(n => n.id === originChainId);
    if (found) return found;
  }
  return await getActiveEvmNetwork();
}


// =============================================================================
// EVM Signing Mutex (separate from Octra signing lock)
// =============================================================================

let evmSigningMutex = Promise.resolve();

async function withEvmSigningLock(fn) {
  await evmSigningMutex;
  let release;
  evmSigningMutex = new Promise(resolve => { release = resolve; });
  try {
    return await fn();
  } finally {
    release();
  }
}


// =============================================================================
// EVM Network Infrastructure
// =============================================================================

const DEFAULT_EVM_NETWORKS = [
  { id: 'eth-mainnet',     name: 'Ethereum',  chainId: 1,        symbol: 'ETH',  explorerUrl: 'https://etherscan.io' },
  { id: 'polygon-mainnet', name: 'Polygon',   chainId: 137,      symbol: 'POL',  explorerUrl: 'https://polygonscan.com' },
  { id: 'base-mainnet',    name: 'Base',      chainId: 8453,     symbol: 'ETH',  explorerUrl: 'https://basescan.org' },
  { id: 'bsc-mainnet',     name: 'BSC',       chainId: 56,       symbol: 'BNB',  explorerUrl: 'https://bscscan.com' },
  { id: 'eth-sepolia',     name: 'Sepolia',   chainId: 11155111, symbol: 'ETH',  explorerUrl: 'https://sepolia.etherscan.io' },
];

async function getActiveEvmNetwork() {
  try {
    const result = await chrome.storage.local.get(['active_evm_network', 'evm_custom_networks']);
    const activeId = result.active_evm_network || 'eth-mainnet';
    const customs = result.evm_custom_networks ? JSON.parse(result.evm_custom_networks) : [];
    const all = [...DEFAULT_EVM_NETWORKS, ...customs];
    return all.find(n => n.id === activeId) || DEFAULT_EVM_NETWORKS[0];
  } catch {
    return DEFAULT_EVM_NETWORKS[0];
  }
}

const DEFAULT_EVM_INFURA_KEY = '__VITE_INFURA_API_KEY__';

async function getEvmRpcUrl(networkId) {
  try {
    // Check user-defined custom RPC
    const result = await chrome.storage.local.get(['evm_rpc_providers', 'evm_infura_key']);
    if (result.evm_rpc_providers) {
      const providers = JSON.parse(result.evm_rpc_providers);
      if (providers[networkId]) return providers[networkId];
    }
    // Infura fallback: user-saved key → build-time .env key
    const key = result.evm_infura_key || DEFAULT_EVM_INFURA_KEY || '';
    const subdomains = {
      'eth-mainnet':     'mainnet',
      'polygon-mainnet': 'polygon-mainnet',
      'base-mainnet':    'base-mainnet',
      'bsc-mainnet':     null,
      'eth-sepolia':     'sepolia',
    };
    const sub = subdomains[networkId];
    if (key && sub) return `https://${sub}.infura.io/v3/${key}`;
    // Well-known public RPCs as last resort
    const publicRpcs = {
      'eth-mainnet':     'https://eth.llamarpc.com',
      'polygon-mainnet': 'https://polygon-rpc.com',
      'bsc-mainnet':     'https://bsc-dataseed.binance.org',
      'base-mainnet':    'https://mainnet.base.org',
      'eth-sepolia':     'https://rpc.sepolia.org',
    };
    return publicRpcs[networkId] || '';
  } catch {
    return '';
  }
}

async function evmJsonRpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`EVM RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}


// =============================================================================
// EVM Permission Helpers
// =============================================================================

async function hasEvmPermission(origin, permission) {
  const perms = await getPermissions(origin);
  return perms.includes(permission);
}


// =============================================================================
// EVM Read Handlers (no popup, no signing)
// =============================================================================

async function handleEvmGetDerivedAddress(origin) {
  const connection = await getConnection(origin);
  if (!connection) return errorResponse(4100, 'Not connected', 'unauthorized');

  // Try the pre-computed address map first (populated on wallet unlock)
  try {
    const result = await chrome.storage.local.get(['evmAddressMap']);
    const map = result.evmAddressMap ? JSON.parse(result.evmAddressMap) : {};
    const evmAddr = map[connection.walletAddress];
    if (evmAddr) return successResponse(evmAddr);
  } catch {}

  // Fallback: derive from the active wallet's public key + address
  // The EVM address map is populated asynchronously after unlock, so on
  // fast connect() calls it might not be ready yet. Request the wallet
  // UI to derive and return it via a delegated message (same pattern
  // as the decrypted balance delegation).
  try {
    const delegated = await delegateEvmAddressDerivation(connection.walletAddress, 5000);
    if (delegated) return successResponse(delegated);
  } catch {}

  return errorResponse(4100, 'EVM address not available yet. The wallet is still deriving it — retry in a moment.', 'evm_not_initialized');
}

/**
 * Ask any open wallet page to derive and return the EVM address for the
 * given Octra address. The wallet page has access to the session wallets
 * and can run deriveEvmFromOctraKey synchronously.
 */
function delegateEvmAddressDerivation(octraAddress, timeoutMs) {
  return new Promise((resolve) => {
    const requestId = `bg_evm_addr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve(value);
    };

    const listener = (msg) => {
      if (msg?.type === 'BG_EVM_ADDRESS_RESPONSE' && msg.requestId === requestId) {
        finish(msg.evmAddress || null);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      chrome.runtime.sendMessage({
        type: 'BG_EVM_ADDRESS_REQUEST',
        requestId,
        octraAddress,
      });
    } catch {
      finish(null);
    }
  });
}

async function handleEvmGetChainId(origin) {
  const network = await getEffectiveEvmNetwork(origin);
  return successResponse(network.chainId);
}

async function handleEvmGetNetworkInfo(origin) {
  const network = await getEffectiveEvmNetwork(origin);
  return successResponse(network);
}

async function handleEvmGetBalance(origin, params) {
  const connection = await getConnection(origin);
  if (!connection) return errorResponse(4100, 'Not connected', 'unauthorized');

  let address = params?.[0]?.address;
  if (!address) {
    // Default to derived EVM address
    try {
      const result = await chrome.storage.local.get(['evmAddressMap']);
      const map = result.evmAddressMap ? JSON.parse(result.evmAddressMap) : {};
      address = map[connection.walletAddress];
    } catch {}
  }
  if (!address) return errorResponse(4200, 'No EVM address available');

  const networkId = params?.[0]?.networkId;
  const network = networkId
    ? (await getAllEvmNetworks()).find(n => n.id === networkId) || await getEffectiveEvmNetwork(origin)
    : await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured for this network');

  try {
    const balHex = await evmJsonRpc(rpcUrl, 'eth_getBalance', [address, 'latest']);
    const balWei = safeBigInt(balHex);
    const eth = Number(balWei) / 1e18;
    return successResponse({ address, balance: eth.toFixed(6), balanceWei: balWei.toString(), chainId: network.chainId });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmGetTokenBalance(origin, params) {
  const connection = await getConnection(origin);
  if (!connection) return errorResponse(4100, 'Not connected', 'unauthorized');

  const token = params?.[0]?.token;
  if (!token) return errorResponse(4200, 'token contract address is required');

  let owner = params?.[0]?.owner;
  if (!owner) {
    try {
      const result = await chrome.storage.local.get(['evmAddressMap']);
      const map = result.evmAddressMap ? JSON.parse(result.evmAddressMap) : {};
      owner = map[connection.walletAddress];
    } catch {}
  }
  if (!owner) return errorResponse(4200, 'No EVM address available');

  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    // balanceOf(address) = 0x70a08231
    const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
    const result = await evmJsonRpc(rpcUrl, 'eth_call', [{ to: token, data }, 'latest']);
    const balance = safeBigInt(result).toString();
    return successResponse({ token, owner, balance });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmGetTokenInfo(origin, params) {
  const token = params?.[0]?.token;
  if (!token) return errorResponse(4200, 'token contract address is required');

  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    // name() = 0x06fdde03, symbol() = 0x95d89b41, decimals() = 0x313ce567
    const [nameHex, symbolHex, decimalsHex] = await Promise.all([
      evmJsonRpc(rpcUrl, 'eth_call', [{ to: token, data: '0x06fdde03' }, 'latest']),
      evmJsonRpc(rpcUrl, 'eth_call', [{ to: token, data: '0x95d89b41' }, 'latest']),
      evmJsonRpc(rpcUrl, 'eth_call', [{ to: token, data: '0x313ce567' }, 'latest']),
    ]);
    const decodeName = (hex) => {
      try {
        if (!hex || hex === '0x') return '';
        const bytes = hexToBytes(hex.slice(2));
        const offset = Number(BigInt('0x' + bytesToHex(bytes.slice(0, 32))));
        const len = Number(BigInt('0x' + bytesToHex(bytes.slice(offset, offset + 32))));
        return new TextDecoder().decode(bytes.slice(offset + 32, offset + 32 + len)).replace(/\0/g, '');
      } catch { return ''; }
    };
    return successResponse({
      token,
      name: decodeName(nameHex),
      symbol: decodeName(symbolHex),
      decimals: Number(safeBigInt(decimalsHex)),
    });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmGetAllowance(origin, params) {
  const p = params?.[0];
  if (!p?.token || !p?.owner || !p?.spender) {
    return errorResponse(4200, 'token, owner, and spender are required');
  }

  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    // allowance(owner, spender) = 0xdd62ed3e
    const data = '0xdd62ed3e'
      + p.owner.slice(2).padStart(64, '0')
      + p.spender.slice(2).padStart(64, '0');
    const result = await evmJsonRpc(rpcUrl, 'eth_call', [{ to: p.token, data }, 'latest']);
    return successResponse({ allowance: safeBigInt(result).toString() });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmCall(origin, params) {
  const p = params?.[0];
  if (!p?.to) return errorResponse(4200, 'to address is required');

  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    const callObj = { to: p.to };
    if (p.data) callObj.data = p.data;
    if (p.from) callObj.from = p.from;
    if (p.value) callObj.value = p.value;
    const result = await evmJsonRpc(rpcUrl, 'eth_call', [callObj, 'latest']);
    return successResponse(result);
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmEstimateGas(origin, params) {
  const p = params?.[0];
  if (!p?.to) return errorResponse(4200, 'to address is required');

  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    const callObj = { to: p.to };
    if (p.data) callObj.data = p.data;
    if (p.from) callObj.from = p.from;
    if (p.value) callObj.value = p.value;
    const gasHex = await evmJsonRpc(rpcUrl, 'eth_estimateGas', [callObj]);
    return successResponse({ gas: Number(safeBigInt(gasHex)).toString(), gasHex });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}

async function handleEvmGetGasPrice(origin) {
  const network = await getEffectiveEvmNetwork(origin);
  const rpcUrl = await getEvmRpcUrl(network.id);
  if (!rpcUrl) return errorResponse(4901, 'No EVM RPC configured');

  try {
    const priceHex = await evmJsonRpc(rpcUrl, 'eth_gasPrice', []);
    const priceWei = safeBigInt(priceHex);
    const priceGwei = Number(priceWei) / 1e9;
    return successResponse({ gasPriceWei: priceWei.toString(), gasPriceGwei: priceGwei.toFixed(2) });
  } catch (error) {
    return errorResponse(4100, error.message);
  }
}


// =============================================================================
// EVM Switch Chain
// =============================================================================

async function handleEvmSwitchChain(origin, params, sender) {
  const connection = await getConnection(origin);
  if (!connection) return errorResponse(4100, 'Not connected', 'unauthorized');

  const chainId = params?.[0]?.chainId;
  if (!chainId) return errorResponse(4200, 'chainId is required');

  const all = await getAllEvmNetworks();
  const target = all.find(n => n.chainId === chainId);
  if (!target) return errorResponse(4901, `Unsupported EVM chain: ${chainId}`, 'unsupported_chain');

  // Resolve the current chain for this origin — use GLOBAL active network
  // for display purposes (that's what the user sees in the wallet UI),
  // regardless of stale per-origin cache from previous sessions.
  const current = await getActiveEvmNetwork();

  // Require user approval — chain switch has security implications
  const pendingKey = `evm_switch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingEvmSwitchRequest_${pendingKey}`, {
    pendingKey, appOrigin: origin,
    fromChainId: current.chainId, fromName: current.name,
    toChainId: target.chainId, toName: target.name, toSymbol: target.symbol,
    timestamp: Date.now(),
  });
  await setStorageData('pendingEvmSwitchRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingEvmSwitchRequest_${pendingKey}`, 'pendingEvmSwitchRequestKey']);
    };

    const listener = async (msg) => {
      if (msg.type === 'EVM_SWITCH_CHAIN_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          // Persist the per-origin chain preference
          await saveOriginEvmChain(origin, target.id);
          // Also update the global active chain
          await chrome.storage.local.set({ active_evm_network: target.id });
          // Sync to wallet UI localStorage
          broadcastInternalSync('SYNC_EVM_NETWORK', { activeEvmNetwork: target.id });
          broadcastEvent('evmChainChanged', target.chainId);
          resolve(successResponse(target));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 60000);
    chrome.runtime.onMessage.addListener(listener);
  });
}


// =============================================================================
// EVM Write Handlers (popup approval required)
// =============================================================================

async function handleEvmSendTransaction(origin, params, sender) {
  if (!await hasEvmPermission(origin, 'evm_send_transactions')) {
    // Fall back to the broader permission
    if (!await hasEvmPermission(origin, 'send_transactions')) {
      return errorResponse(4100, 'Unauthorized: evm_send_transactions permission required', 'unauthorized');
    }
  }

  const p = params?.[0];
  if (!p?.to) return errorResponse(4200, 'to address is required');

  return withEvmSigningLock(async () => {
    const pendingKey = `evm_tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const network = await getEffectiveEvmNetwork(origin);
    await setStorageData(`pendingEvmTxRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      to: p.to, value: p.value || '0', data: p.data,
      gasLimit: p.gasLimit, chainId: network.chainId,
      networkName: network.name, symbol: network.symbol,
      timestamp: Date.now(),
    });
    await setStorageData('pendingEvmTxRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingEvmTxRequest_${pendingKey}`, 'pendingEvmTxRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'EVM_TX_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            broadcastEvent('evmTransactionSent', { hash: msg.hash, chainId: msg.chainId });
            resolve(successResponse({ hash: msg.hash, chainId: msg.chainId }));
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleEvmSignMessage(origin, params, sender) {
  if (!await hasEvmPermission(origin, 'evm_sign_messages')) {
    if (!await hasEvmPermission(origin, 'sign_messages')) {
      return errorResponse(4100, 'Unauthorized: evm_sign_messages permission required', 'unauthorized');
    }
  }

  const message = params?.[0]?.message;
  if (!message) return errorResponse(4200, 'message is required');

  const pendingKey = `evm_sign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingEvmSignRequest_${pendingKey}`, {
    pendingKey, appOrigin: origin, message, timestamp: Date.now(),
  });
  await setStorageData('pendingEvmSignRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingEvmSignRequest_${pendingKey}`, 'pendingEvmSignRequestKey']);
    };

    const listener = (msg) => {
      if (msg.type === 'EVM_SIGN_MESSAGE_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          resolve(successResponse({ signature: msg.signature, address: msg.address }));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 60000);
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function handleEvmSignTypedData(origin, params, sender) {
  if (!await hasEvmPermission(origin, 'evm_sign_messages')) {
    if (!await hasEvmPermission(origin, 'sign_messages')) {
      return errorResponse(4100, 'Unauthorized: evm_sign_messages permission required', 'unauthorized');
    }
  }

  const p = params?.[0];
  if (!p?.domain || !p?.types || !p?.value) {
    return errorResponse(4200, 'domain, types, and value are required for EIP-712');
  }

  const pendingKey = `evm_typed_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await setStorageData(`pendingEvmTypedDataRequest_${pendingKey}`, {
    pendingKey, appOrigin: origin,
    domain: p.domain, types: p.types, value: p.value, primaryType: p.primaryType,
    timestamp: Date.now(),
  });
  await setStorageData('pendingEvmTypedDataRequestKey', pendingKey);

  try { await chrome.action.openPopup(); } catch {}

  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      chrome.storage.local.remove([`pendingEvmTypedDataRequest_${pendingKey}`, 'pendingEvmTypedDataRequestKey']);
    };

    const listener = (msg) => {
      if (msg.type === 'EVM_TYPED_DATA_RESULT' && msg.pendingKey === pendingKey) {
        cleanup();
        if (msg.approved) {
          resolve(successResponse({ signature: msg.signature, address: msg.address }));
        } else {
          resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
        }
      }
    };

    const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 60000);
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function handleEvmTransferToken(origin, params, sender) {
  if (!await hasEvmPermission(origin, 'evm_send_transactions')) {
    if (!await hasEvmPermission(origin, 'send_transactions')) {
      return errorResponse(4100, 'Unauthorized: evm_send_transactions permission required', 'unauthorized');
    }
  }

  const p = params?.[0];
  if (!p?.token || !p?.to || !p?.amount) {
    return errorResponse(4200, 'token, to, and amount are required');
  }

  return withEvmSigningLock(async () => {
    const pendingKey = `evm_token_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const network = await getEffectiveEvmNetwork(origin);
    await setStorageData(`pendingEvmTokenRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      token: p.token, to: p.to, amount: p.amount,
      chainId: network.chainId, networkName: network.name, symbol: network.symbol,
      timestamp: Date.now(),
    });
    await setStorageData('pendingEvmTokenRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingEvmTokenRequest_${pendingKey}`, 'pendingEvmTokenRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'EVM_TOKEN_TX_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            resolve(successResponse({ hash: msg.hash, chainId: msg.chainId }));
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function handleEvmApproveToken(origin, params, sender) {
  if (!await hasEvmPermission(origin, 'evm_send_transactions')) {
    if (!await hasEvmPermission(origin, 'send_transactions')) {
      return errorResponse(4100, 'Unauthorized: evm_send_transactions permission required', 'unauthorized');
    }
  }

  const p = params?.[0];
  if (!p?.token || !p?.spender) {
    return errorResponse(4200, 'token and spender are required');
  }
  const amount = p.amount || '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'; // max uint256

  return withEvmSigningLock(async () => {
    const pendingKey = `evm_approve_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const network = await getEffectiveEvmNetwork(origin);
    await setStorageData(`pendingEvmApproveRequest_${pendingKey}`, {
      pendingKey, appOrigin: origin,
      token: p.token, spender: p.spender, amount,
      chainId: network.chainId, networkName: network.name,
      timestamp: Date.now(),
    });
    await setStorageData('pendingEvmApproveRequestKey', pendingKey);

    try { await chrome.action.openPopup(); } catch {}

    return new Promise((resolve) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        chrome.storage.local.remove([`pendingEvmApproveRequest_${pendingKey}`, 'pendingEvmApproveRequestKey']);
      };

      const listener = (msg) => {
        if (msg.type === 'EVM_APPROVE_RESULT' && msg.pendingKey === pendingKey) {
          cleanup();
          if (msg.approved) {
            resolve(successResponse({ hash: msg.hash, chainId: msg.chainId }));
          } else {
            resolve(errorResponse(4001, 'User rejected the request', 'user_rejected'));
          }
        }
      };

      const timer = setTimeout(() => { cleanup(); resolve(errorResponse(4001, 'User rejected the request')); }, 300000);
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}


// =============================================================================
// EVM Helpers
// =============================================================================

async function getAllEvmNetworks() {
  try {
    const result = await chrome.storage.local.get(['evm_custom_networks']);
    const customs = result.evm_custom_networks ? JSON.parse(result.evm_custom_networks) : [];
    return [...DEFAULT_EVM_NETWORKS, ...customs];
  } catch {
    return DEFAULT_EVM_NETWORKS;
  }
}

/**
 * Safely parse a hex string to BigInt. Returns 0n for empty/invalid values
 * like '0x' which the EVM RPC returns when a contract doesn't exist or a
 * function returns nothing.
 */
function safeBigInt(hex) {
  if (!hex || hex === '0x' || hex === '0x0' || hex === '0X') return 0n;
  try { return BigInt(hex); } catch { return 0n; }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
