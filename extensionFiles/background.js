/**
 * Octra Wallet Background Script
 * 
 * Handles capability-based authorization model.
 */

// Lock wallet on browser startup
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
      .catch(error => sendResponse({
        type: 'ERROR_RESPONSE',
        success: false,
        error: error.message || 'Unknown error'
      }));
    return true;
  }

  return true;
});

// =============================================================================
// Request Handlers
// =============================================================================

async function handleDAppRequest(message, sender) {
  const { type, requestId, data } = message;

  try {
    switch (type) {
      case 'CONNECTION_REQUEST':
        return await handleConnectionRequest(data, sender);

      case 'CAPABILITY_REQUEST':
        return await handleCapabilityRequest(data, sender);

      case 'INVOKE_REQUEST':
        return await handleInvokeRequest(data, sender);

      case 'DISCONNECT_REQUEST':
        return await handleDisconnectRequest(data, sender);

      default:
        throw new Error(`Unknown request type: ${type}`);
    }
  } catch (error) {
    console.error('[Background] Request error:', error);
    throw error;
  }
}

// Handle connection request (NO signing)
async function handleConnectionRequest(data, sender) {
  const { circle, appOrigin, appName, appIcon, requestedCapabilities } = data;

  console.log('[Background] Connection request:', { circle, appOrigin, appName });

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
    const listener = (msg) => {
      console.log('[Background] Received message:', msg.type, msg);
      
      // Handle both old format (origin) and new format (appOrigin)
      const msgOrigin = msg.appOrigin || msg.origin;
      
      if (msg.type === 'CONNECTION_RESULT' && msgOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved) {
          // Get wallet address from either walletPubKey or address field
          const walletAddress = msg.walletPubKey || msg.address || 'unknown';
          const network = msg.network || 'mainnet';
          
          console.log('[Background] Connection approved:', { walletAddress, network });

          // Store connection
          saveConnection({
            circle,
            appOrigin,
            appName,
            walletPubKey: walletAddress,
            network: network,
            connectedAt: Date.now()
          });

          resolve({
            type: 'CONNECTION_RESPONSE',
            success: true,
            result: {
              circle,
              sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              walletPubKey: walletAddress,
              network: network
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
    const listener = (msg) => {
      if (msg.type === 'CAPABILITY_RESULT' && msg.appOrigin === appOrigin) {
        chrome.runtime.onMessage.removeListener(listener);

        if (msg.approved) {
          // Use the signed capability from DAppRequestHandler
          const signedCapability = msg.signedCapability;
          const capabilityId = msg.capabilityId;
          
          const capability = {
            id: capabilityId,
            ...signedCapability
          };

          console.log('[Background] Capability approved:', {
            id: capability.id,
            circle: capability.circle,
            methods: capability.methods,
            scope: capability.scope,
            issuerPubKey: capability.issuerPubKey?.slice(0, 16) + '...'
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
  const { capabilityId, method, payload, nonce, timestamp, appOrigin } = data;

  // Get capability
  const capability = await getCapability(appOrigin, capabilityId);
  if (!capability) {
    throw new Error('Capability not found');
  }

  // Check expiry
  if (capability.expiresAt && capability.expiresAt < Date.now()) {
    throw new Error('Capability expired');
  }

  // Check method is allowed
  if (!capability.methods.includes(method)) {
    throw new Error(`Method '${method}' not allowed by capability`);
  }

  // Store pending request
  await setStorageData('pendingInvokeRequest', {
    capabilityId,
    method,
    payload,
    nonce,
    timestamp,
    appOrigin,
    capability,
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
}

async function getCapability(appOrigin, capabilityId) {
  const capabilities = await getStorageData('capabilities') || {};
  const originCaps = capabilities[appOrigin] || [];
  return originCaps.find(c => c.id === capabilityId);
}

async function saveCapability(appOrigin, capability) {
  const capabilities = await getStorageData('capabilities') || {};
  if (!capabilities[appOrigin]) {
    capabilities[appOrigin] = [];
  }
  capabilities[appOrigin].push(capability);
  await setStorageData('capabilities', capabilities);
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
