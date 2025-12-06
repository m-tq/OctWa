// Content script untuk komunikasi antara web pages dan Octra extension
(function() {
  'use strict';

  // Inject Octra provider ke dalam window object
  const injectOctraProvider = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('provider.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  };

  // Message handler untuk komunikasi dengan extension
  const handleProviderMessage = (event) => {
    if (event.source !== window) return;
    if (event.data.source !== 'octra-provider') return;
    
    // Forward message ke extension background script
    chrome.runtime.sendMessage({
      source: 'octra-content-script',
      type: event.data.type,
      requestId: event.data.requestId,
      data: event.data.data
    }).then(response => {
      // Forward response kembali ke provider
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: response.type,
        success: response.success,
        result: response.result,
        error: response.error
      }, '*');
    }).catch(error => {
      // Handle error
      window.postMessage({
        source: 'octra-content-script',
        requestId: event.data.requestId,
        type: 'ERROR_RESPONSE',
        success: false,
        error: error.message || 'Extension communication error'
      }, '*');
    });
  };

  // Setup message listener
  window.addEventListener('message', handleProviderMessage);

  // Inject provider saat DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectOctraProvider);
  } else {
    injectOctraProvider();
  }

  // Cleanup saat page unload
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('message', handleProviderMessage);
  });
})();