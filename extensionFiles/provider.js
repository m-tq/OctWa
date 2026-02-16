(() => {
  'use strict';

  const PROVIDER_VERSION = '2.0.0';

  class OctraProvider {
    constructor() {
      this.isOctra = true;
      this.version = PROVIDER_VERSION;
      this._eventListeners = {};
      this._pendingRequests = new Map();
      this._nonceControllers = new Map();
      this._state = { state: 'DISCONNECTED' };

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!this._isSameOrigin(event)) return;
        if (event.data.source !== 'octra-content-script') return;
        this._handleResponse(event.data);
      });
    }

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
            // Ignore
          }
        });
      }
    }

    async connect(request) {
      return new Promise((resolve, reject) => {
        if (!request || !request.circle) {
          reject(new Error('Circle ID is required'));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          source: 'octra-provider',
          type: 'CONNECTION_REQUEST',
          requestId,
          data: {
            circle: request.circle,
            appOrigin: request.appOrigin || window.location.origin,
            appName: request.appName || document.title || window.location.hostname,
            appIcon: request.appIcon || this._getAppIcon(),
            requestedCapabilities: request.requestedCapabilities || []
          }
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Connection request timeout'));
          }
        }, 60000);
      });
    }

    async disconnect() {
      this._emit('disconnect');
      window.postMessage({
        source: 'octra-provider',
        type: 'DISCONNECT_REQUEST',
        data: { appOrigin: window.location.origin }
      }, this._getTargetOrigin());
    }

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
        this._pendingRequests.set(requestId, { resolve, reject });

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
            branchId: request.branchId,
            appOrigin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon()
          }
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Capability request timeout'));
          }
        }, 300000);
      });
    }

    async renewCapability(capabilityId) {
      return this._sendRequest('RENEW_CAPABILITY_REQUEST', { capabilityId });
    }

    async revokeCapability(capabilityId) {
      return this._sendRequest('REVOKE_CAPABILITY_REQUEST', { capabilityId });
    }

    async listCapabilities() {
      return this._sendRequest('LIST_CAPABILITIES_REQUEST', {});
    }

    async invoke(call) {
      return new Promise((resolve, reject) => {
        if (!call || !call.header || !call.body) {
          reject(new Error('Invalid invocation structure'));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests.set(requestId, { resolve, reject });

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
            capabilityId: call.body.capabilityId,
            method: call.body.method,
            payload,
            nonce: call.header.nonce,
            timestamp: call.header.timestamp,
            appOrigin: window.location.origin,
            appName: document.title || window.location.hostname
          }
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Invocation request timeout'));
          }
        }, 300000);
      });
    }

    async invokeCompute(request) {
      return this._sendRequest('COMPUTE_REQUEST', request);
    }

    async estimatePlainTx(payload) {
      return this._sendRequest('ESTIMATE_PLAIN_TX', { payload });
    }

    async estimateEncryptedTx(payload) {
      return this._sendRequest('ESTIMATE_ENCRYPTED_TX', { payload });
    }

    async estimateComputeCost(profile) {
      return this._sendRequest('ESTIMATE_COMPUTE_COST', { profile });
    }

    async signMessage(message) {
      return new Promise((resolve, reject) => {
        if (!message || typeof message !== 'string') {
          reject(new Error('Message must be a non-empty string'));
          return;
        }

        const requestId = this._generateRequestId();
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          source: 'octra-provider',
          type: 'SIGN_MESSAGE_REQUEST',
          requestId,
          data: {
            message,
            appOrigin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon()
          }
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Sign message request timeout'));
          }
        }, 60000);
      });
    }

    _handleResponse(data) {
      const { requestId, type, success, result, error, appOrigin } = data;

      if (type === 'WALLET_DISCONNECTED') {
        this._emit('disconnect', { appOrigin });
        return;
      }

      if (type === 'BRANCH_CHANGED') {
        this._emit('branchChanged', { branchId: data.branchId, epoch: data.epoch });
        return;
      }

      if (type === 'EPOCH_CHANGED') {
        this._emit('epochChanged', { epoch: data.epoch });
        return;
      }

      if (!this._pendingRequests || !this._pendingRequests.has(requestId)) {
        return;
      }

      const { resolve, reject } = this._pendingRequests.get(requestId);
      this._pendingRequests.delete(requestId);

      if (success) {
        switch (type) {
          case 'CONNECTION_RESPONSE':
            this._emit('connect', { connection: result });
            resolve(result);
            break;

          case 'CAPABILITY_RESPONSE':
            if (result && result.id) {
              this._nonceControllers.set(result.id, result.nonceBase || 0);
            }
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

          case 'SIGN_MESSAGE_RESPONSE':
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

    _sendRequest(type, data) {
      return new Promise((resolve, reject) => {
        const requestId = this._generateRequestId();
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          source: 'octra-provider',
          type,
          requestId,
          data
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Request timeout'));
          }
        }, 300000);
      });
    }

    _generateRequestId() {
      return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    _getTargetOrigin() {
      return window.location.origin === 'null' ? '*' : window.location.origin;
    }

    _isSameOrigin(event) {
      const origin = window.location.origin;
      return origin === 'null' || event.origin === origin;
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
    }, window.location.origin === 'null' ? '*' : window.location.origin);
  }
})();
