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
    if (event.data.source !== 'octra-provider') return;

    console.log('[Content] Received:', event.data.type);

    // Forward to background
    chrome.runtime.sendMessage({
      source: 'octra-content-script',
      type: event.data.type,
      requestId: event.data.requestId,
      data: event.data.data
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
      }, '*');
    }).catch(error => {
      console.error('[Content] Error:', error);
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: 'ERROR_RESPONSE',
        success: false,
        error: error.message || 'Extension communication error'
      }, '*');
    });
  };

  // Setup
  window.addEventListener('message', handleMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectProvider);
  } else {
    injectProvider();
  }

  // Cleanup
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('message', handleMessage);
  });
})();
