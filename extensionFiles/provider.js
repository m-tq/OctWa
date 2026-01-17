/**
 * Octra Wallet Provider
 * 
 * Implements capability-based authorization model.
 * Synced with @octwa/sdk types.
 */
(function() {
  'use strict';

  const PROVIDER_VERSION = '2.0.0';

  class OctraProvider {
    constructor() {
      this.isOctra = true;
      this.version = PROVIDER_VERSION;
      this._eventListeners = {};
      this._pendingRequests = {};

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.source !== 'octra-content-script') return;
        this._handleResponse(event.data);
      });
    }

    // =========================================================================
    // Event Management
    // =========================================================================

    on(event, callback) {
      if (!this._eventListeners[event]) {
        this._eventListeners[event] = [];
      }
      this._eventListeners[event].push(callback);
    }

    off(event, callback) {
      if (!this._eventListeners[event]) return;
      const index = this._eventListeners[event].indexOf(callback);
      if (index > -1) {
        this._eventListeners[event].splice(index, 1);
      }
    }

    _emit(event, data) {
      if (this._eventListeners[event]) {
        this._eventListeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (e) {
            console.error('[Octra Provider] Event callback error:', e);
          }
        });
      }
    }

    // =========================================================================
    // Public API - Capability-Based Model
    // =========================================================================

    /**
     * Connect to a Circle (NO signing popup)
     * @param {Object} request - ConnectRequest
     * @returns {Promise<Connection>}
     */
    async connect(request) {
      return new Promise((resolve, reject) => {
        if (!request || !request.circle) {
          reject(new Error('Circle ID is required'));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests[requestId] = { resolve, reject };

        window.postMessage({
          source: 'octra-provider',
          type: 'CONNECTION_REQUEST',
          requestId,
          data: {
            circle: request.circle,
            appOrigin: request.appOrigin || window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            requestedCapabilities: request.requestedCapabilities || []
          }
        }, '*');

        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Connection request timeout'));
          }
        }, 60000);
      });
    }

    /**
     * Disconnect from Circle
     */
    async disconnect() {
      this._emit('disconnect');
      window.postMessage({
        source: 'octra-provider',
        type: 'DISCONNECT_REQUEST',
        data: { appOrigin: window.location.origin }
      }, '*');
    }

    /**
     * Request a capability from user
     * @param {Object} request - CapabilityRequest
     * @returns {Promise<Capability>} - Signed capability with all required fields
     */
    async requestCapability(request) {
      return new Promise((resolve, reject) => {
        if (!request || !request.circle) {
          reject(new Error('Circle ID is required'));
          return;
        }
        if (!request.methods || request.methods.length === 0) {
          reject(new Error('At least one method is required'));
          return;
        }
        if (!['read', 'write', 'compute'].includes(request.scope)) {
          reject(new Error("Scope must be 'read', 'write', or 'compute'"));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests[requestId] = { resolve, reject };

        window.postMessage({
          source: 'octra-provider',
          type: 'CAPABILITY_REQUEST',
          requestId,
          data: {
            circle: request.circle,
            methods: request.methods,
            scope: request.scope,
            encrypted: request.encrypted || false,
            ttlSeconds: request.ttlSeconds,
            appOrigin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon()
          }
        }, '*');

        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Capability request timeout'));
          }
        }, 300000);
      });
    }

    /**
     * Invoke a method using a capability
     * @param {Object} call - SignedInvocation
     * @returns {Promise<InvocationResult>}
     */
    async invoke(call) {
      return new Promise((resolve, reject) => {
        if (!call || !call.capabilityId) {
          reject(new Error('Capability ID is required'));
          return;
        }
        if (!call.method) {
          reject(new Error('Method is required'));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests[requestId] = { resolve, reject };

        let payload = call.payload;
        if (payload instanceof Uint8Array) {
          payload = { _type: 'Uint8Array', data: Array.from(payload) };
        } else if (payload && payload.data instanceof Uint8Array) {
          payload = {
            ...payload,
            data: { _type: 'Uint8Array', data: Array.from(payload.data) },
            metadata: payload.metadata instanceof Uint8Array 
              ? { _type: 'Uint8Array', data: Array.from(payload.metadata) }
              : payload.metadata
          };
        }

        window.postMessage({
          source: 'octra-provider',
          type: 'INVOKE_REQUEST',
          requestId,
          data: {
            capabilityId: call.capabilityId,
            method: call.method,
            payload: payload,
            nonce: call.nonce,
            timestamp: call.timestamp,
            appOrigin: window.location.origin,
            appName: document.title || window.location.hostname
          }
        }, '*');

        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Invocation request timeout'));
          }
        }, 300000);
      });
    }

    // =========================================================================
    // Response Handler
    // =========================================================================

    _handleResponse(data) {
      const { requestId, type, success, result, error, appOrigin } = data;

      // Handle disconnect notification from wallet
      if (type === 'WALLET_DISCONNECTED') {
        console.log('[Octra Provider] Wallet disconnected notification received');
        this._emit('disconnect', { appOrigin });
        return;
      }

      if (!this._pendingRequests || !this._pendingRequests[requestId]) {
        return;
      }

      const { resolve, reject } = this._pendingRequests[requestId];
      delete this._pendingRequests[requestId];

      if (success) {
        switch (type) {
          case 'CONNECTION_RESPONSE':
            this._emit('connect', { connection: result });
            resolve(result);
            break;

          case 'CAPABILITY_RESPONSE':
            this._emit('capabilityGranted', { capability: result });
            resolve(result);
            break;

          case 'INVOKE_RESPONSE':
            if (result && result.data) {
              if (result.data._type === 'Uint8Array') {
                result.data = new Uint8Array(result.data.data);
              } else if (result.data.data && result.data.data._type === 'Uint8Array') {
                result.data.data = new Uint8Array(result.data.data.data);
                if (result.data.metadata && result.data.metadata._type === 'Uint8Array') {
                  result.data.metadata = new Uint8Array(result.data.metadata.data);
                }
              }
            }
            resolve(result);
            break;

          default:
            resolve(result);
        }
      } else {
        if (error === 'User rejected request') {
          this._emit('userRejectedRequest', { requestId });
        }
        reject(new Error(error || 'Unknown error'));
      }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    _generateRequestId() {
      return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    _getAppIcon() {
      const iconSelectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
        'meta[property="og:image"]'
      ];

      for (const selector of iconSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const href = element.getAttribute('href') || element.getAttribute('content');
          if (href) {
            return new URL(href, window.location.origin).href;
          }
        }
      }

      return null;
    }
  }

  // Inject provider
  if (typeof window !== 'undefined') {
    window.octra = new OctraProvider();
    window.dispatchEvent(new Event('octraLoaded'));

    Object.defineProperty(window, 'isOctra', {
      value: true,
      writable: false,
      configurable: false
    });

    window.postMessage({
      type: 'OCTRA_EXTENSION_AVAILABLE',
      version: PROVIDER_VERSION
    }, '*');

    console.log(`[Octra] Wallet Provider v${PROVIDER_VERSION} injected (Capability-based model)`);
  }
})();
