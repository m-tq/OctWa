// Background script for Chrome extension
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open expanded view when extension is first installed
    chrome.tabs.create({
      url: chrome.runtime.getURL('index.html')
    });
  }
});

// Handle messages between popup and expanded views, plus dApp communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle existing message types
  if (message.type === 'SYNC_STATE') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  } else if (message.type === 'OPEN_EXPANDED') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('index.html')
    });
    return true;
  }

  // Handle dApp communication requests
  if (message.source === 'octra-content-script') {
    handleDAppRequest(message, sender)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({
        type: 'ERROR_RESPONSE',
        success: false,
        error: error.message || 'Unknown error'
      }));
    return true; // Indicates async response
  }

  return true;
});

// Handle dApp requests
async function handleDAppRequest(message, sender) {
  const { type, requestId, data } = message;
  
  try {
    switch (type) {
      case 'CONNECTION_REQUEST':
        return await handleConnectionRequest(data, sender);
        
      case 'TRANSACTION_REQUEST':
        return await handleTransactionRequest(data, sender);
        
      case 'CONTRACT_REQUEST':
        return await handleContractRequest(data, sender);
        
      case 'GET_BALANCE':
        return await handleBalanceRequest(data, sender);
        
      case 'SIGN_MESSAGE':
        return await handleSignMessageRequest(data, sender);
        
      case 'DISCONNECT_REQUEST':
        return await handleDisconnectRequest(data, sender);
        
      default:
        throw new Error(`Unknown request type: ${type}`);
    }
  } catch (error) {
    console.error('dApp request error:', error);
    throw error;
  }
}

// Handle connection request
async function handleConnectionRequest(data, sender) {
  const { origin, appName, appIcon, permissions } = data;
  
  // Check if already connected
  const connectionsData = await getStorageData('connectedDApps');
  const connections = Array.isArray(connectionsData) ? connectionsData : [];
  const existingConnection = connections.find(conn => conn.origin === origin);
  
  // FIXED: Always show connection approval to allow wallet selection
  // Remove automatic return of existing connection
  console.log('Connection request from:', origin, existingConnection ? '(existing connection found)' : '(new connection)');
  
  // Store connection request data for popup to access
  await setStorageData('pendingConnectionRequest', {
    origin,
    appName: appName || origin,
    appIcon: appIcon || null,
    permissions,
    timestamp: Date.now(),
    existingConnection: existingConnection // Pass existing connection info to UI
  });
  
  // Try to open popup first
  try {
    await chrome.action.openPopup();
  } catch (error) {
    // If popup fails (e.g., user interaction required), fall back to tab
    console.log('Popup failed, opening tab:', error);
    const connectionUrl = chrome.runtime.getURL(`index.html?action=connect&origin=${encodeURIComponent(origin)}&appName=${encodeURIComponent(appName || '')}&appIcon=${encodeURIComponent(appIcon || '')}&permissions=${encodeURIComponent(JSON.stringify(permissions))}`);
    
    await chrome.tabs.create({
      url: connectionUrl,
      active: true
    });
  }
  
  // Wait for user approval/rejection
  return new Promise((resolve) => {
    const messageListener = (msg) => {
      if (msg.type === 'CONNECTION_RESULT' && msg.origin === origin) {
        chrome.runtime.onMessage.removeListener(messageListener);
        
        if (msg.approved) {
          // FIXED: Store/update connection with the user-selected address
          const newConnection = {
            origin,
            selectedAddress: msg.address, // Use the user-selected wallet address
            permissions,
            connectedAt: Date.now()
          };
          
          getStorageData('connectedDApps').then(connectionsData => {
            const connections = Array.isArray(connectionsData) ? connectionsData : [];
            // Remove existing connection for this origin first
            const filteredConnections = connections.filter(conn => conn.origin !== origin);
            // Add the new/updated connection with selected address
            const updatedConnections = [...filteredConnections, newConnection];
            setStorageData('connectedDApps', updatedConnections);
            console.log('Connection updated for', origin, 'with wallet:', msg.address);
          });
        }
        
        resolve({
          type: 'CONNECTION_RESPONSE',
          success: msg.approved,
          result: msg.approved ? { address: msg.address, permissions } : null,
          error: msg.approved ? null : 'User rejected request'
        });
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Cleanup timeout after 60 seconds
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.local.remove('pendingConnectionRequest');
      resolve({
        type: 'CONNECTION_RESPONSE',
        success: false,
        error: 'Connection request timeout'
      });
    }, 60000);
  });
}

// Handle transaction request
async function handleTransactionRequest(data, sender) {
  const { origin, appName, appIcon, to, amount, message } = data;
  
  // Check if dApp is connected
  const connectionsData = await getStorageData('connectedDApps');
  const connections = Array.isArray(connectionsData) ? connectionsData : [];
  const connection = connections.find(conn => conn.origin === origin);
  
  if (!connection) {
    throw new Error('dApp not connected');
  }
  
  // Open transaction approval popup
  const approvalUrl = chrome.runtime.getURL(`index.html?action=transaction&origin=${encodeURIComponent(origin)}&appName=${encodeURIComponent(appName || '')}&appIcon=${encodeURIComponent(appIcon || '')}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amount)}&message=${encodeURIComponent(message || '')}&connectedAddress=${encodeURIComponent(connection.selectedAddress)}`);
  
  const tab = await chrome.tabs.create({
    url: approvalUrl,
    active: true
  });
  
  // Wait for user approval/rejection
  return new Promise((resolve) => {
    const messageListener = (msg) => {
      if (msg.type === 'TRANSACTION_RESULT' && msg.origin === origin) {
        chrome.runtime.onMessage.removeListener(messageListener);
        resolve({
          type: 'TRANSACTION_RESPONSE',
          success: msg.approved,
          result: msg.approved ? { hash: msg.txHash } : null,
          error: msg.approved ? null : (msg.error || 'User rejected request')
        });
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Cleanup jika tab ditutup tanpa response
    chrome.tabs.onRemoved.addListener(function tabRemovedListener(tabId) {
      if (tabId === tab.id) {
        chrome.tabs.onRemoved.removeListener(tabRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);
        resolve({
          type: 'TRANSACTION_RESPONSE',
          success: false,
          error: 'User closed popup'
        });
      }
    });
  });
}

// Handle contract request
async function handleContractRequest(data, sender) {
  const { 
    origin, 
    appName, 
    appIcon, 
    contractAddress, 
    methodName, 
    methodType, 
    params, 
    gasLimit, 
    gasPrice, 
    value, 
    description 
  } = data;
  
  // Check if dApp is connected
  const connectionsData = await getStorageData('connectedDApps');
  const connections = Array.isArray(connectionsData) ? connectionsData : [];
  const connection = connections.find(conn => conn.origin === origin);
  
  if (!connection) {
    throw new Error('dApp not connected');
  }
  
  // Store contract request data for popup to access
  await setStorageData('pendingContractRequest', {
    origin,
    appName: appName || origin,
    appIcon: appIcon || null,
    contractAddress,
    methodName,
    methodType,
    params,
    gasLimit,
    gasPrice,
    value,
    description,
    connectedAddress: connection.selectedAddress,
    timestamp: Date.now()
  });
  
  // Try to open popup first
  try {
    await chrome.action.openPopup();
  } catch (error) {
    // If popup fails, fall back to tab
    console.log('Popup failed for contract request, opening tab:', error);
    
    // Build URL parameters for contract request
    const urlParams = new URLSearchParams({
      action: 'contract',
      origin: encodeURIComponent(origin),
      contractAddress: encodeURIComponent(contractAddress),
      methodName: encodeURIComponent(methodName),
      methodType: encodeURIComponent(methodType),
      connectedAddress: encodeURIComponent(connection.selectedAddress)
    });
    
    // Add optional parameters
    if (appName) urlParams.set('appName', encodeURIComponent(appName));
    if (appIcon) urlParams.set('appIcon', encodeURIComponent(appIcon));
    if (params && params.length > 0) urlParams.set('params', encodeURIComponent(JSON.stringify(params)));
    if (gasLimit) urlParams.set('gasLimit', encodeURIComponent(gasLimit.toString()));
    if (gasPrice) urlParams.set('gasPrice', encodeURIComponent(gasPrice.toString()));
    if (value) urlParams.set('value', encodeURIComponent(value));
    if (description) urlParams.set('description', encodeURIComponent(description));
    
    const approvalUrl = chrome.runtime.getURL(`index.html?${urlParams.toString()}`);
    
    await chrome.tabs.create({
      url: approvalUrl,
      active: true
    });
  }
  
  // Wait for user approval/rejection
  return new Promise((resolve) => {
    const messageListener = (msg) => {
      if (msg.type === 'CONTRACT_RESULT' && msg.origin === origin) {
        chrome.runtime.onMessage.removeListener(messageListener);
        resolve({
          type: 'CONTRACT_RESPONSE',
          success: msg.approved,
          result: msg.approved ? msg.result : null,
          error: msg.approved ? null : (msg.error || 'User rejected contract call')
        });
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Cleanup timeout after 5 minutes for contract calls
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.local.remove('pendingContractRequest');
      resolve({
        type: 'CONTRACT_RESPONSE',
        success: false,
        error: 'Contract call request timeout'
      });
    }, 300000); // 5 minutes
  });
}

// Handle balance request
async function handleBalanceRequest(data, sender) {
  const { address } = data;
  
  try {
    // This would typically call your API
    // For now, return a placeholder response
    return {
      type: 'BALANCE_RESPONSE',
      success: true,
      result: {
        balance: 0, // This should be fetched from your API
        address: address
      }
    };
  } catch (error) {
    throw new Error(`Failed to get balance: ${error.message}`);
  }
}

// Handle sign message request
async function handleSignMessageRequest(data, sender) {
  const { message, origin } = data;
  
  // Check if dApp is connected
  const connectionsData = await getStorageData('connectedDApps');
  const connections = Array.isArray(connectionsData) ? connectionsData : [];
  const connection = connections.find(conn => conn.origin === origin);
  
  if (!connection) {
    throw new Error('dApp not connected');
  }
  
  // For now, return not implemented
  throw new Error('Message signing not yet implemented');
}

// Handle disconnect request
async function handleDisconnectRequest(data, sender) {
  const { origin } = data;
  
  try {
    const connectionsData = await getStorageData('connectedDApps');
    const connections = Array.isArray(connectionsData) ? connectionsData : [];
    const updatedConnections = connections.filter(conn => conn.origin !== origin);
    await setStorageData('connectedDApps', updatedConnections);
    
    return {
      type: 'DISCONNECT_RESPONSE',
      success: true,
      result: { disconnected: true }
    };
  } catch (error) {
    throw new Error(`Failed to disconnect: ${error.message}`);
  }
}

// Storage helper functions
async function getStorageData(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

async function setStorageData(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}

// Sync storage changes across all extension pages
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // Broadcast storage changes to all extension pages
    chrome.runtime.sendMessage({
      type: 'STORAGE_CHANGED',
      changes: changes
    }).catch(() => {
      // Ignore errors if no listeners
    });
  }
});