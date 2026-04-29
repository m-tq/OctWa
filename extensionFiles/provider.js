(() => {
  'use strict';

  const PROVIDER_VERSION = '2.0.0';

  // Per-request timeout values (ms)
  const TIMEOUT = {
    CONNECTION:  60_000,   // 1 min  — user must approve in popup
    CAPABILITY:  300_000,  // 5 min  — user must approve in popup
    INVOKE:      300_000,  // 5 min  — user must approve write ops
    SIGN:        60_000,   // 1 min  — user must approve in popup
    QUICK:       15_000,   // 15 s   — instant ops (list, renew, revoke, disconnect)
  };

  class OctraProvider {
    constructor() {
      this.isOctra  = true;
      this.version  = PROVIDER_VERSION;

      this._eventListeners  = {};
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

    // ── Event emitter ────────────────────────────────────────────────────────

    on(event, callback) {
      if (!this._eventListeners[event]) this._eventListeners[event] = [];
      this._eventListeners[event].push(callback);
    }

    off(event, callback) {
      if (!this._eventListeners[event]) return;
      const idx = this._eventListeners[event].indexOf(callback);
      if (idx > -1) this._eventListeners[event].splice(idx, 1);
    }

    _emit(event, data) {
      (this._eventListeners[event] || []).forEach(cb => {
        try { cb(data); } catch (_) { /* never let listener errors bubble */ }
      });
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Connect to wallet. Returns session info. */
    async connect(request) {
      if (!request?.circle) throw new Error('Circle ID is required');

      return this._sendRequest('CONNECTION_REQUEST', {
        circle:                 request.circle,
        appOrigin:              request.appOrigin || window.location.origin,
        appName:                request.appName   || document.title || window.location.hostname,
        appIcon:                request.appIcon   || this._getAppIcon(),
        requestedCapabilities:  request.requestedCapabilities || [],
      }, TIMEOUT.CONNECTION);
    }

    /** Disconnect from wallet. Confirmed by background. */
    async disconnect() {
      this._state = { state: 'DISCONNECTED' };
      this._emit('disconnect');
      return this._sendRequest('DISCONNECT_REQUEST', {
        appOrigin: window.location.origin,
      }, TIMEOUT.QUICK);
    }

    /** Request a capability (permission token) from the wallet. */
    async requestCapability(request) {
      if (!request?.circle)                          throw new Error('Circle ID is required');
      if (!request.methods || !request.methods.length) throw new Error('At least one method is required');
      if (!['read', 'write', 'compute'].includes(request.scope))
        throw new Error("Scope must be 'read', 'write', or 'compute'");

      return this._sendRequest('CAPABILITY_REQUEST', {
        circle:    request.circle,
        methods:   request.methods,
        scope:     request.scope,
        encrypted: request.encrypted || false,
        ttlSeconds: request.ttlSeconds,
        branchId:  request.branchId,
        appOrigin: window.location.origin,
        appName:   document.title || window.location.hostname,
        appIcon:   this._getAppIcon(),
      }, TIMEOUT.CAPABILITY);
    }

    /** Invoke a method using a previously granted capability. */
    async invoke(call) {
      if (!call?.header || !call?.body) throw new Error('Invalid invocation structure');

      // Serialize Uint8Array for postMessage transport
      let payload = call.payload;
      if (payload instanceof Uint8Array) {
        payload = { _type: 'Uint8Array', data: Array.from(payload) };
      } else if (payload?.data instanceof Uint8Array) {
        payload = {
          ...payload,
          data:     { _type: 'Uint8Array', data: Array.from(payload.data) },
          metadata: payload.metadata instanceof Uint8Array
            ? { _type: 'Uint8Array', data: Array.from(payload.metadata) }
            : payload.metadata,
        };
      }

      return this._sendRequest('INVOKE_REQUEST', {
        capabilityId: call.body.capabilityId,
        method:       call.body.method,
        payload,
        nonce:        call.header.nonce,
        timestamp:    call.header.timestamp,
        appOrigin:    window.location.origin,
        appName:      document.title || window.location.hostname,
      }, TIMEOUT.INVOKE);
    }

    /** Sign an arbitrary UTF-8 message with the wallet key. */
    async signMessage(message) {
      if (!message || typeof message !== 'string')
        throw new Error('Message must be a non-empty string');

      return this._sendRequest('SIGN_MESSAGE_REQUEST', {
        message,
        appOrigin: window.location.origin,
        appName:   document.title || window.location.hostname,
        appIcon:   this._getAppIcon(),
      }, TIMEOUT.SIGN);
    }

    /** Estimate fee for a plain (unencrypted) transaction. */
    async estimatePlainTx(payload) {
      return this._sendRequest('ESTIMATE_PLAIN_TX', { payload }, TIMEOUT.QUICK);
    }

    /** Estimate fee for an encrypted transaction. */
    async estimateEncryptedTx(payload) {
      return this._sendRequest('ESTIMATE_ENCRYPTED_TX', { payload }, TIMEOUT.QUICK);
    }

    /** List all active capabilities for this origin. */
    async listCapabilities() {
      return this._sendRequest('LIST_CAPABILITIES_REQUEST', {}, TIMEOUT.QUICK);
    }

    /** Renew an existing capability before it expires. */
    async renewCapability(capabilityId) {
      return this._sendRequest('RENEW_CAPABILITY_REQUEST', { capabilityId }, TIMEOUT.QUICK);
    }

    /** Revoke a capability immediately. */
    async revokeCapability(capabilityId) {
      return this._sendRequest('REVOKE_CAPABILITY_REQUEST', { capabilityId }, TIMEOUT.QUICK);
    }

    // ── Response handler ─────────────────────────────────────────────────────

    _handleResponse(data) {
      const { requestId, type, success, result, error } = data;

      // Push-events (no requestId)
      if (type === 'WALLET_DISCONNECTED') {
        this._state = { state: 'DISCONNECTED' };
        this._emit('disconnect', { appOrigin: data.appOrigin });
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

      if (!this._pendingRequests.has(requestId)) return;

      const { resolve, reject } = this._pendingRequests.get(requestId);
      this._pendingRequests.delete(requestId);

      if (!success) {
        if (error === 'User rejected request') {
          this._emit('userRejectedRequest', { requestId });
        }
        reject(new Error(error || 'Unknown error'));
        return;
      }

      // Deserialize Uint8Array from transport format
      if (type === 'INVOKE_RESPONSE' && result?.data) {
        if (result.data._type === 'Uint8Array') {
          result.data = new Uint8Array(result.data.data);
        } else if (result.data.data?._type === 'Uint8Array') {
          result.data.data = new Uint8Array(result.data.data.data);
          if (result.data.metadata?._type === 'Uint8Array') {
            result.data.metadata = new Uint8Array(result.data.metadata.data);
          }
        }
      }

      // Emit side-effects
      if (type === 'CONNECTION_RESPONSE') {
        this._state = { state: 'CONNECTED', ...result };
        this._emit('connect', { connection: result });
      }
      if (type === 'CAPABILITY_RESPONSE' && result?.id) {
        this._nonceControllers.set(result.id, result.nonceBase || 0);
        this._emit('capabilityGranted', { capability: result });
      }

      resolve(result);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Send a request via postMessage and return a Promise that resolves
     * when the matching response arrives, or rejects on timeout.
     *
     * @param {string}  type     - message type
     * @param {object}  data     - payload
     * @param {number}  timeout  - ms before auto-reject
     */
    _sendRequest(type, data, timeout = TIMEOUT.QUICK) {
      return new Promise((resolve, reject) => {
        const requestId = this._generateRequestId();
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          source: 'octra-provider',
          type,
          requestId,
          data,
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error(`Request timeout: ${type}`));
          }
        }, timeout);
      });
    }

    /**
     * Generate a cryptographically random request ID.
     * crypto.randomUUID() is CSPRNG-backed — Math.random() is not.
     */
    _generateRequestId() {
      return 'req_' + crypto.randomUUID();
    }

    _getTargetOrigin() {
      return window.location.origin === 'null' ? '*' : window.location.origin;
    }

    _isSameOrigin(event) {
      const origin = window.location.origin;
      return origin === 'null' || event.origin === origin;
    }

    _getAppIcon() {
      const selectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
        'meta[property="og:image"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const href = el.getAttribute('href') || el.getAttribute('content');
          if (href) return new URL(href, window.location.origin).href;
        }
      }
      return null;
    }
  }

  // ── Inject ─────────────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.octra = new OctraProvider();

    // ── Octra Provider Discovery (analog EIP-6963) ──────────────────────────
    // Allows DApps to detect OctWa without polling window.octra.
    // Multiple Octra-compatible wallets can coexist via this event bus.
    const _providerInfo = Object.freeze({
      uuid:    crypto.randomUUID(),
      name:    'OctWa',
      rdns:    'network.octra.octwa',
      version: PROVIDER_VERSION,
    });

    const _announceProvider = () => {
      window.dispatchEvent(new CustomEvent('octra:announceProvider', {
        detail: Object.freeze({ info: _providerInfo, provider: window.octra }),
      }));
    };

    window.addEventListener('octra:requestProvider', _announceProvider);
    _announceProvider();

    // ── Legacy compat ────────────────────────────────────────────────────────
    window.dispatchEvent(new Event('octraLoaded'));

    Object.defineProperty(window, 'isOctra', {
      value: true, writable: false, configurable: false,
    });

    window.postMessage(
      { type: 'OCTRA_EXTENSION_AVAILABLE', version: PROVIDER_VERSION },
      window.location.origin === 'null' ? '*' : window.location.origin
    );
  }
})();
