(function() {
  // Octra Provider API
  class OctraProvider {
    constructor() {
      this.isOctra = true;
      this.isConnected = false;
      this.selectedAddress = null;
      this.networkId = 'octra-mainnet';
      this.chainId = '0x1'; // Octra chain ID
      this._eventListeners = {};
      
      // Setup message listener untuk response dari extension
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.source !== 'octra-content-script') return;
        
        this._handleResponse(event.data);
      });
    }

    // Event listener management
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
        this._eventListeners[event].forEach(callback => callback(data));
      }
    }

    // Request connection to wallet
    async connect(permissions = ['view_address', 'view_balance']) {
      return new Promise((resolve, reject) => {
        const requestId = this._generateRequestId();
        
        // Store resolver untuk response
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        // Send request ke content script
        window.postMessage({
          source: 'octra-provider',
          type: 'CONNECTION_REQUEST',
          requestId,
          data: {
            origin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            permissions
          }
        }, '*');
        
        // Timeout setelah 60 detik
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Connection request timeout'));
          }
        }, 60000);
      });
    }

    // Disconnect from wallet
    async disconnect() {
      this.isConnected = false;
      this.selectedAddress = null;
      this._emit('disconnect', {});
      
      window.postMessage({
        source: 'octra-provider',
        type: 'DISCONNECT_REQUEST',
        data: {
          origin: window.location.origin
        }
      }, '*');
    }

    // Get current connected account
    async getAccount() {
      if (!this.isConnected) {
        throw new Error('Not connected to wallet');
      }
      return this.selectedAddress;
    }

    // Get account balance
    async getBalance(address = null) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected && !address) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'GET_BALANCE',
          requestId,
          data: {
            address: address || this.selectedAddress
          }
        }, '*');
        
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Get balance request timeout'));
          }
        }, 30000);
      });
    }

    // Send transaction
    async sendTransaction(transactionRequest) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        // Validate transaction request
        if (!transactionRequest.to || !transactionRequest.amount) {
          reject(new Error('Invalid transaction request: missing to or amount'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'TRANSACTION_REQUEST',
          requestId,
          data: {
            origin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            to: transactionRequest.to,
            amount: transactionRequest.amount.toString(),
            message: transactionRequest.message || ''
          }
        }, '*');
        
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Transaction request timeout'));
          }
        }, 300000); // 5 minutes timeout untuk transaction
      });
    }

    // Sign message (for future implementation)
    async signMessage(message) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'SIGN_MESSAGE',
          requestId,
          data: {
            message,
            origin: window.location.origin
          }
        }, '*');
        
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Sign message request timeout'));
          }
        }, 60000);
      });
    }

    // Check if wallet is installed
    async isInstalled() {
      return true; // Content script sudah inject, berarti extension installed
    }

    // Get network info
    async getNetwork() {
      return {
        chainId: this.chainId,
        networkId: this.networkId,
        name: 'Octra Network'
      };
    }

    // Call smart contract view method
    async callContract(contractAddress, methodName, params = {}) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'CONTRACT_REQUEST',
          requestId,
          data: {
            origin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            contractAddress,
            methodName,
            methodType: 'view',
            params: this._convertParamsToArray(params),
            description: `Call view method ${methodName} on contract ${contractAddress}`
          }
        }, '*');
        
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Contract call request timeout'));
          }
        }, 60000);
      });
    }

    // Invoke smart contract transaction method
    async invokeContract(contractAddress, methodName, params = {}, options = {}) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'CONTRACT_REQUEST',
          requestId,
          data: {
            origin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            contractAddress,
            methodName,
            methodType: 'call',
            params: this._convertParamsToArray(params),
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice,
            value: options.value,
            description: `Execute transaction method ${methodName} on contract ${contractAddress}`
          }
        }, '*');
        
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Contract invocation request timeout'));
          }
        }, 300000); // 5 minutes timeout
      });
    }

    // Enhanced contract method call with full parameter specification
    async callContractMethod(contractAddress, methodName, methodType, parameters = [], options = {}) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('Not connected to wallet'));
          return;
        }
        
        const requestId = this._generateRequestId();
        this._pendingRequests = this._pendingRequests || {};
        this._pendingRequests[requestId] = { resolve, reject };
        
        window.postMessage({
          source: 'octra-provider',
          type: 'CONTRACT_REQUEST',
          requestId,
          data: {
            origin: window.location.origin,
            appName: document.title || window.location.hostname,
            appIcon: this._getAppIcon(),
            contractAddress,
            methodName,
            methodType,
            params: parameters,
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice,
            value: options.value,
            description: options.description || `${methodType === 'view' ? 'Call' : 'Execute'} method ${methodName} on contract ${contractAddress}`
          }
        }, '*');
        
        const timeout = methodType === 'view' ? 60000 : 300000;
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Enhanced contract call request timeout'));
          }
        }, timeout);
      });
    }

    // Handle responses dari extension
    _handleResponse(data) {
      const { requestId, type, success, result, error } = data;
      
      if (!this._pendingRequests || !this._pendingRequests[requestId]) {
        return;
      }
      
      const { resolve, reject } = this._pendingRequests[requestId];
      delete this._pendingRequests[requestId];
      
      if (success) {
        // Handle different response types
        switch (type) {
          case 'CONNECTION_RESPONSE':
            this.isConnected = true;
            this.selectedAddress = result.address;
            this._emit('connect', { address: result.address });
            resolve(result);
            break;
            
          case 'TRANSACTION_RESPONSE':
            this._emit('transaction', { hash: result.hash });
            resolve(result);
            break;
            
          case 'BALANCE_RESPONSE':
            resolve(result);
            break;
            
          case 'SIGN_RESPONSE':
            resolve(result);
            break;
            
          case 'CONTRACT_RESPONSE':
            this._emit('contractCall', { result });
            resolve(result);
            break;
            
          default:
            resolve(result);
        }
      } else {
        // Handle errors
        if (error === 'User rejected request') {
          this._emit('userRejectedRequest', { requestId });
        }
        reject(new Error(error || 'Unknown error'));
      }
    }

    // Helper methods
    _generateRequestId() {
      return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    _convertParamsToArray(params) {
      // Convert object params to array format expected by contract handler
      if (Array.isArray(params)) {
        return params;
      }
      
      return Object.keys(params).map(key => ({
        name: key,
        type: this._inferParamType(params[key]),
        value: params[key],
        required: true
      }));
    }

    _inferParamType(value) {
      if (typeof value === 'number') return 'number';
      if (typeof value === 'string') {
        if (value.startsWith('oct') || value.startsWith('0x')) return 'address';
        return 'string';
      }
      if (typeof value === 'boolean') return 'bool';
      return 'string';
    }

    _getAppIcon() {
      // Try to get app icon dari berbagai sources
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

  // Inject provider ke window
  if (typeof window !== 'undefined') {
    window.octra = new OctraProvider();
    
    // Dispatch event untuk notify bahwa provider sudah ready
    window.dispatchEvent(new Event('octraLoaded'));
    
    // Untuk compatibility dengan dApp yang expect ethereum-like interface
    if (!window.ethereum) {
      window.ethereum = window.octra;
    }
  }
    
    // Make the provider globally detectable
    // Similar to how MetaMask makes window.ethereum available
    Object.defineProperty(window, 'isOctra', {
      value: true,
      writable: false,
      configurable: false
    });
    
    // Add extension ID for SDK compatibility
    Object.defineProperty(window.octra, 'extensionId', {
      value: chrome.runtime.id || 'unknown',
      writable: false,
      configurable: false
    });
    
    // Add version info
    Object.defineProperty(window.octra, 'version', {
      value: '1.0.0',
      writable: false,
      configurable: false
    });
    
    // Announce provider availability to any listening scripts
    window.postMessage({
      type: 'OCTRA_EXTENSION_AVAILABLE',
      extensionId: chrome.runtime.id || 'unknown',
      version: '1.0.0'
    }, '*');
    
    console.log('Octra Wallet Provider injected successfully');
})();