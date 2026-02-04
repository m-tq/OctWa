/**
 * Octra Wallet Content Script
 * 
 * Bridge between web pages and extension.
 */
(function() {
  'use strict';

  // Inject provider script
  const injectProvider = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('provider.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  };

  // Handle messages from provider
  const handleMessage = (event) => {
    if (event.source !== window) return;
    if (!isSameOrigin(event)) return;
    if (event.data.source !== 'octra-provider') return;

    console.log('[Content] Received:', event.data.type);

    // Forward to background
    chrome.runtime.sendMessage({
      source: 'octra-content-script',
      type: event.data.type,
      requestId: event.data.requestId,
      data: {
        ...(event.data.data || {}),
        appOrigin: window.location.origin
      }
    }).then(response => {
      console.log('[Content] Response:', response);
      
      // Properly serialize Uint8Array in response for postMessage
      const serializedResponse = serializeResponse(response);
      
      // Forward back to provider
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: serializedResponse.type,
        success: serializedResponse.success,
        result: serializedResponse.result,
        error: serializedResponse.error
      }, getTargetOrigin());
    }).catch(error => {
      console.error('[Content] Error:', error);
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: 'ERROR_RESPONSE',
        success: false,
        error: error.message || 'Extension communication error'
      }, getTargetOrigin());
    });
  };

  // Handle messages from background (e.g., disconnect notifications)
  const handleBackgroundMessage = (message) => {
    if (message.type === 'WALLET_DISCONNECTED') {
      console.log('[Content] Wallet disconnected for origin:', message.appOrigin);
      // Forward disconnect event to provider
      window.postMessage({
        source: 'octra-content-script',
        type: 'WALLET_DISCONNECTED',
        appOrigin: message.appOrigin
      }, getTargetOrigin());
    }
  };

  // Setup
  window.addEventListener('message', handleMessage);
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectProvider);
  } else {
    injectProvider();
  }

  const getTargetOrigin = () => {
    // Security: Only use '*' for null origins (file:// protocol), otherwise use actual origin
    const origin = window.location.origin;
    if (origin === 'null') {
      // For file:// protocol, we must use '*' but log a warning
      console.warn('[Content] Using wildcard origin for file:// protocol');
      return '*';
    }
    return origin;
  };

  const isSameOrigin = (event) => {
    const origin = window.location.origin;
    // For null origins (file://), accept any origin but log warning
    if (origin === 'null') {
      console.warn('[Content] Accepting message in null origin context');
      return true;
    }
    return event.origin === origin;
  };

  // Cleanup
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('message', handleMessage);
  });

  /**
   * Serialize response to properly handle Uint8Array through postMessage
   * Chrome extension messaging converts Uint8Array to plain objects with numeric keys
   */
  function serializeResponse(response) {
    if (!response || typeof response !== 'object') return response;
    
    const result = { ...response };
    
    // Handle nested result.data (Uint8Array from background.js)
    if (result.result && result.result.data) {
      result.result = {
        ...result.result,
        data: convertToArray(result.result.data)
      };
    }
    
    return result;
  }

  /**
   * Convert object with numeric keys or Uint8Array to regular array
   */
  function convertToArray(data) {
    if (!data) return data;
    
    // Already an array
    if (Array.isArray(data)) return data;
    
    // Uint8Array (unlikely after chrome messaging, but handle it)
    if (data instanceof Uint8Array) return Array.from(data);
    
    // Object with numeric keys: {0: 123, 1: 34, ...}
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
        const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
        return sortedKeys.map(k => data[k]);
      }
    }
    
    return data;
  }
})();
