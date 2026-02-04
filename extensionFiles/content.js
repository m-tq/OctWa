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
      // Forward back to provider
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: response.type,
        success: response.success,
        result: response.result,
        error: response.error
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
})();
