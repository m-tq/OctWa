/**
 * Octra Wallet Content Script — RFC-O-1 Compliant
 *
 * Bridge between web page (provider.js) and extension (background.js).
 * Relays RFC-O-1 request() calls as PROVIDER_REQUEST messages.
 */
(function() {
  'use strict';

  // Whitelist of inbound message types we forward to the background.
  // Anything else is silently dropped — content scripts run in an isolated
  // world but still need defence-in-depth against malicious page scripts
  // that try to impersonate the provider.
  const VALID_MESSAGE_TYPES = new Set(['PROVIDER_REQUEST']);
  const MAX_REQUEST_ID_LENGTH = 128;

  // Inject provider script into page context
  const injectProvider = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('provider.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  };

  // ── Message handling: page → background ────────────────────────────────────

  const handlePageMessage = (event) => {
    if (event.source !== window) return;
    if (!isSameOrigin(event)) return;
    if (event.data.source !== 'octra-provider') return;
    if (!VALID_MESSAGE_TYPES.has(event.data.type)) return;

    const { requestId, data } = event.data;

    // Validate requestId
    if (typeof requestId !== 'string' || requestId.length > MAX_REQUEST_ID_LENGTH) {
      console.warn('[Content] Rejected invalid requestId');
      return;
    }

    // Validate method
    if (!data || typeof data.method !== 'string') {
      sendErrorToPage(requestId, 4200, 'Invalid request: method is required');
      return;
    }

    // Sanitize params for structured clone (BigInt, Uint8Array, etc.)
    let sanitizedData;
    try {
      sanitizedData = JSON.parse(JSON.stringify(data, (_k, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (v instanceof Uint8Array) return { _type: 'Uint8Array', data: Array.from(v) };
        if (ArrayBuffer.isView(v)) return { _type: 'Uint8Array', data: Array.from(new Uint8Array(v.buffer)) };
        if (typeof v === 'function') return undefined;
        if (typeof v === 'symbol') return undefined;
        return v;
      }));
    } catch (e) {
      sendErrorToPage(requestId, 4200, `Request could not be serialized: ${e?.message || e}`);
      return;
    }

    // Forward to background
    chrome.runtime.sendMessage({
      source: 'octra-content-script',
      type: 'PROVIDER_REQUEST',
      requestId,
      appOrigin: window.location.origin,
      data: sanitizedData,
    }).then(response => {
      if (!response) {
        sendErrorToPage(requestId, 4001, 'Wallet closed before responding');
        return;
      }

      // Forward response back to provider
      window.postMessage({
        source: 'octra-content-script',
        requestId,
        type: 'PROVIDER_RESPONSE',
        success: response.success,
        result: response.result,
        error: response.error,
        errorCode: response.errorCode,
        errorData: response.errorData,
      }, getTargetOrigin());
    }).catch(error => {
      const msg = error?.message || String(error);
      sendErrorToPage(requestId, 4900, msg);
    });
  };

  // ── Message handling: background → page (push events) ──────────────────────

  const handleBackgroundMessage = (message) => {
    // Provider events (accountsChanged, networkChanged, etc.)
    if (message.type === 'PROVIDER_EVENT') {
      window.postMessage({
        source: 'octra-content-script',
        type: 'PROVIDER_EVENT',
        event: message.event,
        payload: message.payload,
      }, getTargetOrigin());
      return;
    }

    // Legacy disconnect notification
    if (message.type === 'WALLET_DISCONNECTED') {
      window.postMessage({
        source: 'octra-content-script',
        type: 'WALLET_DISCONNECTED',
        appOrigin: message.appOrigin,
      }, getTargetOrigin());
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sendErrorToPage(requestId, code, message) {
    window.postMessage({
      source: 'octra-content-script',
      requestId,
      type: 'PROVIDER_RESPONSE',
      success: false,
      error: message,
      errorCode: code,
    }, getTargetOrigin());
  }

  function getTargetOrigin() {
    const origin = window.location.origin;
    if (origin === 'null') {
      console.warn('[Content] Using wildcard origin for file:// protocol');
      return '*';
    }
    return origin;
  }

  function isSameOrigin(event) {
    const origin = window.location.origin;
    if (origin === 'null') return true;
    return event.origin === origin;
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  window.addEventListener('message', handlePageMessage);
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectProvider);
  } else {
    injectProvider();
  }

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('message', handlePageMessage);
  });
})();
