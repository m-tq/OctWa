/**
 * Octra Provider — RFC-O-1 Compliant
 *
 * Implements the standard Octra Provider JavaScript API as defined in RFC-O-1.
 * Exposes window.octra with request(), on(), removeListener().
 *
 * Standard error codes:
 *   4001 — User rejected
 *   4100 — Unauthorized
 *   4200 — Unsupported method
 *   4900 — Disconnected from all networks
 *   4901 — Network unavailable
 */
(() => {
  'use strict';

  const PROVIDER_VERSION = '3.0.0';

  // ── Timeouts per method category (ms) ──────────────────────────────────────

  const TIMEOUT = {
    USER_APPROVAL: 300_000,  // 5 min — methods requiring popup confirmation
    READ:          30_000,   // 30 s  — read-only RPC pass-through
    QUICK:         15_000,   // 15 s  — instant ops (accounts, networkId)
    PRIVACY_HEAVY: 300_000,  // 5 min — PVAC/HFHE ops (encrypt, decrypt, scan)
  };

  // ── Method classification ──────────────────────────────────────────────────

  const PROVIDER_NATIVE_METHODS = new Set([
    'octra_requestAccounts',
    'octra_accounts',
    'octra_disconnect',
    'octra_networkId',
    'octra_networkInfo',
    'octra_permissions',
    'octra_switchNetwork',
    'octra_signMessage',
    'octra_sendTransaction',
    'octra_signTransaction',
    'octra_submitTransaction',
    'octra_callContract',
    'octra_sendContractTransaction',
    'octra_getContractReceipt',
    'octra_getEncryptedBalance',
    'octra_encryptBalance',
    'octra_decryptBalance',
    'octra_sendPrivateTransfer',
    'octra_scanStealth',
    'octra_claimStealth',
    // EVM methods
    'evm_getDerivedAddress',
    'evm_getChainId',
    'evm_getNetworkInfo',
    'evm_getBalance',
    'evm_switchChain',
    'evm_sendTransaction',
    'evm_signMessage',
    'evm_signTypedData',
    'evm_getTokenBalance',
    'evm_getTokenInfo',
    'evm_transferToken',
    'evm_approveToken',
    'evm_getAllowance',
    'evm_call',
    'evm_estimateGas',
    'evm_getGasPrice',
  ]);

  const CONFIRMATION_REQUIRED = new Set([
    'octra_requestAccounts',
    'octra_switchNetwork',
    'octra_signMessage',
    'octra_sendTransaction',
    'octra_signTransaction',
    'octra_submitTransaction',
    'octra_sendContractTransaction',
    'octra_encryptBalance',
    'octra_decryptBalance',
    'octra_sendPrivateTransfer',
    'octra_claimStealth',
    // EVM write methods
    'evm_sendTransaction',
    'evm_signMessage',
    'evm_signTypedData',
    'evm_transferToken',
    'evm_approveToken',
    'evm_switchChain',
  ]);

  const PRIVACY_HEAVY_METHODS = new Set([
    'octra_encryptBalance',
    'octra_decryptBalance',
    'octra_sendPrivateTransfer',
    'octra_scanStealth',
    'octra_claimStealth',
    'octra_getEncryptedBalance',
  ]);

  // Read-only RPC pass-through methods (from RFC-O-1 table)
  const RPC_PASSTHROUGH_METHODS = new Set([
    // Node
    'node_version', 'node_status', 'node_stats', 'node_metrics',
    // Accounts
    'octra_balance', 'octra_account', 'octra_nonce', 'octra_publicKey',
    'octra_validateAddress', 'octra_supply',
    // Transactions
    'octra_transaction', 'octra_recentTransactions', 'octra_transactions',
    'octra_transactionsByAddress', 'octra_transactionsByEpoch',
    'octra_totalTransactions', 'octra_search',
    // Epochs
    'epoch_current', 'epoch_get', 'epoch_list', 'epoch_summaries',
    // Fees and staging
    'octra_recommendedFee', 'staging_view', 'staging_stats', 'staging_estimateOu',
    // Contracts
    'vm_contract', 'octra_contractAbi', 'octra_contractStorage',
    'octra_listContracts', 'contract_receipt', 'contract_call',
    'octra_computeContractAddress',
    // Compilation
    'octra_compileAssembly', 'octra_compileAml', 'octra_compileAmlMulti',
    // Privacy (read)
    'octra_encryptedCipher', 'octra_encryptedBalance', 'octra_pvacPubkey',
    'octra_viewPubkey', 'octra_stealthOutputs',
    // Contract source
    'contract_source',
  ]);

  // Sensitive write methods that need confirmation when passed through
  const SENSITIVE_WRITE_METHODS = new Set([
    'octra_submit', 'octra_submitBatch', 'octra_privateTransfer',
    'octra_registerPublicKey', 'octra_registerPvacPubkey',
    'staging_remove', 'contract_verify', 'contract_saveAbi',
  ]);

  // ── Error factory ──────────────────────────────────────────────────────────

  class OctraProviderError extends Error {
    constructor(code, message, data) {
      super(message);
      this.name = 'OctraProviderError';
      this.code = code;
      this.data = data;
    }
  }

  function providerError(code, message, reason) {
    return new OctraProviderError(code, message, reason ? { reason } : undefined);
  }

  // ── Provider class ─────────────────────────────────────────────────────────

  class OctraProvider {
    constructor() {
      Object.defineProperty(this, 'isOctra', { value: true, writable: false, configurable: false });
      this.providerId = 'octwa';
      this.version = PROVIDER_VERSION;

      this._listeners = {};
      this._pendingRequests = new Map();
      this._connected = false;
      this._networkId = null;

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!this._isSameOrigin(event)) return;
        if (event.data.source !== 'octra-content-script') return;
        this._handleMessage(event.data);
      });
    }

    // ── RFC-O-1 Core Interface ─────────────────────────────────────────────

    /**
     * Single entry point for all provider requests.
     * @param {OctraRequestArguments} args - { method, params? }
     * @returns {Promise<unknown>}
     */
    async request(args) {
      if (!args || typeof args.method !== 'string') {
        throw providerError(4200, 'Invalid request: method is required');
      }

      const { method, params } = args;

      // Determine timeout based on method type
      let timeout = TIMEOUT.READ;
      if (CONFIRMATION_REQUIRED.has(method)) timeout = TIMEOUT.USER_APPROVAL;
      else if (PRIVACY_HEAVY_METHODS.has(method)) timeout = TIMEOUT.PRIVACY_HEAVY;
      else if (method === 'octra_accounts' || method === 'octra_networkId' ||
               method === 'octra_networkInfo' || method === 'octra_permissions' ||
               method === 'octra_disconnect' ||
               method === 'evm_getDerivedAddress' || method === 'evm_getChainId' ||
               method === 'evm_getNetworkInfo') {
        timeout = TIMEOUT.QUICK;
      }

      // Check if method is supported
      const isSupported = PROVIDER_NATIVE_METHODS.has(method) ||
                          RPC_PASSTHROUGH_METHODS.has(method) ||
                          SENSITIVE_WRITE_METHODS.has(method);

      if (!isSupported) {
        throw providerError(4200, `Unsupported method: ${method}`);
      }

      // Send to background via content script
      return this._sendRequest(method, params, timeout);
    }

    /**
     * Subscribe to provider events.
     * @param {string} event
     * @param {Function} listener
     * @returns {this}
     */
    on(event, listener) {
      if (typeof listener !== 'function') return this;
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(listener);
      return this;
    }

    /**
     * Unsubscribe from provider events.
     * @param {string} event
     * @param {Function} listener
     * @returns {this}
     */
    removeListener(event, listener) {
      if (!this._listeners[event]) return this;
      const idx = this._listeners[event].indexOf(listener);
      if (idx > -1) this._listeners[event].splice(idx, 1);
      return this;
    }

    // ── Internal: event emission ─────────────────────────────────────────────

    _emit(event, ...args) {
      const handlers = this._listeners[event];
      if (!handlers) return;
      for (const handler of handlers) {
        try { handler(...args); } catch (_) { /* never let listener errors bubble */ }
      }
    }

    // ── Internal: message handling ───────────────────────────────────────────

    _handleMessage(data) {
      const { requestId, type, success, result, error, errorCode, errorData } = data;

      // Push events (no requestId) — map to RFC-O-1 events
      if (type === 'PROVIDER_EVENT') {
        this._handleProviderEvent(data);
        return;
      }

      // Legacy push events for backward compat during transition
      if (type === 'WALLET_DISCONNECTED') {
        this._connected = false;
        this._networkId = null;
        this._emit('disconnect', providerError(4900, 'Disconnected'));
        return;
      }
      if (type === 'NETWORK_CHANGED') {
        this._networkId = data.networkId;
        this._emit('networkChanged', data.networkInfo);
        return;
      }
      if (type === 'ACCOUNTS_CHANGED') {
        this._emit('accountsChanged', data.accounts || []);
        return;
      }

      // Response to a pending request
      if (!requestId || !this._pendingRequests.has(requestId)) return;

      const { resolve, reject } = this._pendingRequests.get(requestId);
      this._pendingRequests.delete(requestId);

      if (!success) {
        const code = errorCode || 4100;
        const err = new OctraProviderError(code, error || 'Unknown error', errorData);
        reject(err);
        return;
      }

      resolve(result);
    }

    _handleProviderEvent(data) {
      const { event, payload } = data;
      switch (event) {
        case 'connect':
          this._connected = true;
          this._networkId = payload?.networkId;
          this._emit('connect', payload);
          break;
        case 'disconnect':
          this._connected = false;
          this._networkId = null;
          this._emit('disconnect', providerError(4900, 'Disconnected'));
          break;
        case 'networkChanged':
          this._networkId = payload?.id;
          this._emit('networkChanged', payload);
          break;
        case 'accountsChanged':
          this._emit('accountsChanged', payload);
          break;
        case 'permissionsChanged':
          this._emit('permissionsChanged', payload);
          break;
        case 'balanceChanged':
          this._emit('balanceChanged', payload);
          break;
        case 'transactionChanged':
          this._emit('transactionChanged', payload);
          break;
        case 'message':
          this._emit('message', payload);
          break;
      }
    }

    // ── Internal: request transport ──────────────────────────────────────────

    _sendRequest(method, params, timeout) {
      return new Promise((resolve, reject) => {
        const requestId = 'req_' + crypto.randomUUID();
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          source: 'octra-provider',
          type: 'PROVIDER_REQUEST',
          requestId,
          data: { method, params },
        }, this._getTargetOrigin());

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(providerError(4900, `Request timeout: ${method}`));
          }
        }, timeout);
      });
    }

    _getTargetOrigin() {
      return window.location.origin === 'null' ? '*' : window.location.origin;
    }

    _isSameOrigin(event) {
      const origin = window.location.origin;
      return origin === 'null' || event.origin === origin;
    }
  }

  // ── Inject ─────────────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.octra = new OctraProvider();

    // ── Provider Discovery (analog EIP-6963) ────────────────────────────────
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

    // Legacy compat
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
