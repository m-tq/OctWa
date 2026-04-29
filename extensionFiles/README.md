# OctWa - Octra Wallet Extension

**Version:** 1.2.4  
**Manifest:** V3  
**Status:** Production Ready ✅

The official browser extension wallet for the Octra blockchain. Provides secure key management, capability-based authorization, and full support for HFHE (Homomorphic Fully Encrypted) transactions.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Installation](#installation)
- [File Structure](#file-structure)
- [Security Model](#security-model)
- [Communication Flow](#communication-flow)
- [Capability System](#capability-system)
- [Method Handlers](#method-handlers)
- [Development](#development)
- [Building](#building)
- [Testing](#testing)
- [Security Audit](#security-audit)

---

## Overview

OctWa is a non-custodial browser wallet extension that serves as the **final cryptographic authority** for Octra blockchain transactions. It implements a capability-based authorization model where dApps request specific permissions rather than blanket access.

### Key Responsibilities

🔐 **Private Key Custody** - Secure key storage in background context  
✍️ **Transaction Signing** - Ed25519 signature generation with domain separation  
✅ **Nonce Validation** - Final authority on transaction ordering  
🔒 **Origin Binding** - Cryptographic binding of capabilities to dApp origins  
🎯 **Capability Management** - Fine-grained permission control  
🌐 **Multi-Network Support** - Octra + EVM networks (Ethereum, Polygon, Base, BSC)  
💱 **Intent-Based Swaps** - Cross-chain swap support  
🔐 **HFHE Support** - Fully encrypted transaction execution  

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Content    │───▶│   Provider   │───▶│  Background  │  │
│  │   Script     │◀───│   Script     │◀───│   Service    │  │
│  │              │    │              │    │   Worker     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         │                    │                    │          │
│  ┌──────▼────────────────────▼────────────────────▼──────┐  │
│  │              Chrome Extension APIs                     │  │
│  │  (storage, runtime, tabs, windows, action)            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────┬───────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Web Page (dApp)     │
                    │   window.octra        │
                    └───────────────────────┘
```

### Component Layers

1. **Content Script** (`content.js`)
   - Injected into all web pages
   - Bridges dApp ↔ Extension communication
   - Validates message origins
   - Serializes/deserializes data

2. **Provider Script** (`provider.js`)
   - Injected into page context
   - Exposes `window.octra` API
   - Manages pending requests
   - Handles Uint8Array serialization

3. **Background Service Worker** (`background.js`)
   - Persistent background context
   - Private key storage and signing
   - Capability validation
   - Method execution
   - Network communication

4. **Popup UI** (`popup.html`)
   - User interface for wallet operations
   - Transaction approval
   - Capability management
   - Account management

---

## Features

### Core Wallet Features

- ✅ **Multi-Account Support** - Manage multiple Octra accounts
- ✅ **HD Wallet** - Hierarchical deterministic key derivation
- ✅ **Seed Phrase Backup** - 12/24 word mnemonic backup
- ✅ **Password Protection** - Encrypted local storage
- ✅ **Auto-Lock** - Lock on browser close/restart
- ✅ **EVM Address Derivation** - Compatible Ethereum addresses

### Transaction Features

- ✅ **Plain Transactions** - Standard Octra transactions
- ✅ **Encrypted Transactions** - HFHE encrypted execution
- ✅ **Batch Transactions** - Multiple operations in one tx
- ✅ **Gas Estimation** - Automatic gas calculation
- ✅ **Transaction History** - View past transactions
- ✅ **Transaction Signing** - Ed25519 signatures

### DApp Integration

- ✅ **Capability-Based Auth** - Fine-grained permissions
- ✅ **Origin Binding** - Capabilities tied to dApp origin
- ✅ **Auto-Execute Read Methods** - No popup for read operations
- ✅ **Approval UI** - User confirmation for write operations
- ✅ **Event System** - Real-time connection events
- ✅ **Multi-Tab Support** - Works across browser tabs

### Network Support

- ✅ **Octra Mainnet** - Production network
- ✅ **Octra Testnet** - Development network
- ✅ **Ethereum Mainnet** - EVM compatibility
- ✅ **Ethereum Sepolia** - EVM testnet
- ✅ **Polygon** - Layer 2 scaling
- ✅ **Base** - Coinbase L2
- ✅ **BSC** - Binance Smart Chain

### Security Features

- ✅ **Canonical Serialization** - Deterministic transaction hashing
- ✅ **Domain Separation** - Prevents signature replay
- ✅ **Signing Mutex** - Prevents race conditions
- ✅ **Nonce Validation** - Transaction ordering enforcement
- ✅ **Origin Validation** - Strict origin checking
- ✅ **Rate Limiting** - Prevents spam attacks
- ✅ **HFHE Protection** - Encrypted payload handling

---

## Installation

### For Users

1. Download from Chrome Web Store (coming soon)
2. Or install from source (see Development section)

### For Developers

```bash
# Clone repository
git clone https://github.com/octra/octwa.git
cd octwa

# Install dependencies
npm install

# Build extension
npm run build:extension

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the extensionFiles/ directory
```

---

## File Structure

```
extensionFiles/
├── background.js              # Background service worker (main logic)
├── content.js                 # Content script (message bridge)
├── provider.js                # Provider script (window.octra API)
├── core.js                    # Core crypto utilities (SHA-256, canonical serialization)
├── manifest.json              # Extension manifest (V3)
├── popup.html                 # Popup UI entry point
├── icons/                     # Extension icons
│   ├── octwa16x16.png
│   ├── octwa32x32.png
│   ├── octwa48x48.png
│   └── octwa128x128.png
└── assets/                    # Built UI assets (from main app)
    ├── index.css
    ├── popup.js
    └── ...
```

---

## Security Model

### Trust Boundaries

```
DApp (Untrusted) → Content Script → Provider → Background (Trusted)
                                                      ↓
                                              Private Keys
                                              Signing
                                              Validation
```

### Private Key Storage

- **Location**: Chrome storage (encrypted)
- **Access**: Background context only
- **Encryption**: AES-256-GCM with user password
- **Backup**: 12/24 word seed phrase

### Signing Process

1. **Canonical Serialization**: Transaction → Canonical JSON
2. **Domain Separation**: Add prefix (e.g., `OctraCapability:v2:`)
3. **Hashing**: SHA-256 hash of prefixed canonical
4. **Signing**: Ed25519 signature with private key
5. **Verification**: Wallet verifies before submission

### Origin Validation

```javascript
// Strict origin checking
function getSenderOrigin(sender) {
  try {
    if (!sender || !sender.url) return null;
    return new URL(sender.url).origin;
  } catch {
    return null;
  }
}

// Capability origin binding
if (capability.appOrigin !== appOrigin) {
  throw new Error('Origin mismatch');
}
```

---

## Communication Flow

### 1. DApp → Extension

```javascript
// DApp calls SDK
await sdk.connect({ circle: 'my-circle' });

// SDK calls provider
window.octra.connect({ circle: 'my-circle' });

// Provider posts message
window.postMessage({
  source: 'octra-provider',
  type: 'CONNECTION_REQUEST',
  requestId: 'req_123',
  data: { circle: 'my-circle' }
}, window.location.origin);
```

### 2. Content Script Bridge

```javascript
// Content script receives message
window.addEventListener('message', (event) => {
  if (event.data.source !== 'octra-provider') return;
  
  // Forward to background
  chrome.runtime.sendMessage({
    source: 'octra-content-script',
    type: event.data.type,
    requestId: event.data.requestId,
    data: { ...event.data.data, appOrigin: window.location.origin }
  });
});
```

### 3. Background Processing

```javascript
// Background handles request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'octra-content-script') {
    handleDAppRequest(message, sender)
      .then(response => sendResponse(response))
      .catch(error => sendResponse(normalizeError(error)));
    return true;
  }
});
```

### 4. Response Flow

```javascript
// Background sends response
sendResponse({
  type: 'CONNECTION_RESPONSE',
  success: true,
  result: { circle, sessionId, walletPubKey, ... }
});

// Content script forwards to provider
window.postMessage({
  source: 'octra-content-script',
  requestId: 'req_123',
  type: 'CONNECTION_RESPONSE',
  success: true,
  result: { ... }
}, window.location.origin);

// Provider resolves promise
resolve(result);
```

---

## Capability System

### Capability Structure

```javascript
{
  id: 'cap_abc123',
  version: 2,
  circle: 'my-circle',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  appOrigin: 'https://mydapp.com',
  branchId: 'main',
  epoch: 1234567890,
  issuedAt: 1234567890000,
  expiresAt: 1234571490000,
  nonceBase: 0,
  walletPubKey: '0x...',
  signature: '0x...',
  state: 'ACTIVE',
  lastNonce: 0
}
```

### Capability Lifecycle

1. **Request**: DApp requests capability
2. **Approval**: User approves in popup
3. **Signing**: Wallet signs capability with domain separation
4. **Storage**: Capability stored by origin
5. **Usage**: DApp invokes methods using capability
6. **Validation**: Wallet validates on each invocation
7. **Expiry**: Capability expires after TTL
8. **Renewal**: DApp can renew before expiry
9. **Revocation**: User can revoke anytime

### Capability Validation

```javascript
async function validateCapability(capability, appOrigin) {
  // Check origin binding
  if (capability.appOrigin !== appOrigin) {
    throw new Error('Origin mismatch');
  }
  
  // Check expiry
  if (capability.expiresAt < Date.now()) {
    throw new Error('Capability expired');
  }
  
  // Check state
  if (capability.state === 'REVOKED') {
    throw new Error('Capability revoked');
  }
  
  // Verify signature (with domain separation)
  const canonical = canonicalizeCapability(capability);
  const withDomain = OCTRA_CAPABILITY_PREFIX + canonical;
  const hash = sha256(withDomain);
  const isValid = await verifySignature(hash, capability.signature, capability.walletPubKey);
  
  if (!isValid) {
    throw new Error('Invalid signature');
  }
}
```

---

## Method Handlers

### Auto-Execute Methods (No Popup)

These methods execute automatically without user approval:

- `get_balance` - Get wallet balances
- `get_quote` - Get swap quote
- `create_intent` - Create swap intent
- `submit_intent` - Submit intent to backend
- `get_intent_status` - Check intent status

```javascript
const autoExecuteMethods = ['get_balance', 'get_quote', 'create_intent', 'submit_intent', 'get_intent_status'];

if (autoExecuteMethods.includes(method)) {
  // Execute immediately
  const result = await executeMethod(method, payload, connection, capability);
  return { success: true, result };
}
```

### Approval-Required Methods (Popup)

These methods require user approval:

- `send_transaction` - Send Octra transaction
- `send_evm_transaction` - Send EVM transaction
- `sign_message` - Sign arbitrary message
- Custom write methods

```javascript
// Store pending request
await setStorageData('pendingInvokeRequest', {
  capabilityId,
  method,
  payload,
  appOrigin,
  timestamp: Date.now()
});

// Open approval UI
await chrome.action.openPopup();

// Wait for user response
return new Promise((resolve) => {
  const listener = (msg) => {
    if (msg.type === 'INVOKE_RESULT' && msg.appOrigin === appOrigin) {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(msg.approved ? msg.data : { error: 'User rejected' });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
});
```

### Method Implementations

#### `get_balance`

```javascript
async function executeGetBalance(connection) {
  const octAddress = connection.walletPubKey;
  const evmAddress = connection.evmAddress;
  const activeNetwork = await getActiveEVMNetwork();
  
  // Fetch OCT balance from Octra RPC
  const octBalance = await fetchOctBalance(octAddress);
  
  // Fetch ETH balance from EVM RPC
  const ethBalance = await fetchEthBalance(evmAddress, activeNetwork);
  
  // Fetch USDC balance (ERC20)
  const usdcBalance = await fetchUsdcBalance(evmAddress, activeNetwork);
  
  return {
    octAddress,
    evmAddress,
    octBalance,
    ethBalance,
    usdcBalance,
    network: connection.network,
    evmNetwork: activeNetwork
  };
}
```

#### `get_quote`

```javascript
async function executeGetQuote(payload) {
  const { apiUrl, from, to, amount } = parsePayload(payload);
  
  // Validate inputs
  if (!isValidApiUrl(apiUrl)) throw new Error('Invalid API URL');
  if (amount <= 0) throw new Error('Invalid amount');
  
  // Fetch quote from backend
  const response = await fetch(`${apiUrl}/quote?from=${from}&to=${to}&amount=${amount}`);
  const quote = await response.json();
  
  return quote;
}
```

#### `send_transaction`

```javascript
async function executeSendTransaction(payload, connection) {
  // This method ALWAYS requires user approval
  // Never auto-execute as it transfers funds
  
  // Parse transaction
  const tx = parseTransaction(payload);
  
  // Validate transaction
  validateTransaction(tx);
  
  // Sign with private key
  const signature = await signTransaction(tx, connection.walletPubKey);
  
  // Submit to network
  const txHash = await submitTransaction(tx, signature);
  
  return { txHash, success: true };
}
```

---

## Development

### Prerequisites

- Node.js >= 16
- Chrome/Chromium browser
- Git

### Setup

```bash
# Install dependencies
npm install

# Build extension
npm run build:extension

# Watch mode (auto-rebuild)
npm run watch:extension
```

### Loading in Browser

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `extensionFiles/` directory

### Hot Reload

For development, use the watch mode:

```bash
npm run watch:extension
```

Then click the reload button in `chrome://extensions/` after changes.

---

## Building

### Production Build

```bash
# Build extension
npm run build:extension

# Output: extensionFiles/ directory ready for distribution
```

### Environment Variables

Create `.env` file in project root:

```env
VITE_OCTRA_RPC_URL=https://rpc.octra.network
VITE_INFURA_API_KEY=your_infura_key
```

These are injected at build time into `background.js`:

```javascript
const RPC_URL = '__VITE_OCTRA_RPC_URL__';
const DEFAULT_INFURA_API_KEY = '__VITE_INFURA_API_KEY__';
```

### Packaging for Distribution

```bash
# Create ZIP for Chrome Web Store
cd extensionFiles
zip -r octwa-extension.zip . -x "*.DS_Store" -x "__MACOSX/*"
```

---

## Testing

### Manual Testing

1. Load extension in Chrome
2. Create/import wallet
3. Visit test dApp
4. Test connection flow
5. Test capability requests
6. Test method invocations
7. Test transaction signing

### Automated Testing

```bash
# Run extension tests
npm run test:extension

# Test specific functionality
npm run test:extension -- --grep "capability"
```

### Test Checklist

- [ ] Wallet creation
- [ ] Wallet import (seed phrase)
- [ ] Password protection
- [ ] Auto-lock on browser close
- [ ] Connection request
- [ ] Capability request
- [ ] Method invocation (read)
- [ ] Method invocation (write)
- [ ] Transaction signing
- [ ] Message signing
- [ ] Multi-account support
- [ ] Network switching
- [ ] Capability renewal
- [ ] Capability revocation
- [ ] Error handling
- [ ] Origin validation
- [ ] Nonce validation
- [ ] Signature verification

---

## Security Audit

### Audit Implementation Status

All requirements from `OCTRA_SDK_AND_WALLET_EXTENSION_AUDIT.md` have been implemented:

✅ **Transaction Canonicalization** - `core.js`  
✅ **Signature Domain Separation** - Prefixes applied before hashing  
✅ **Nonce Handling** - Wallet is final authority  
✅ **Async Race Conditions** - Signing mutex implemented  
✅ **Error Normalization** - Unified error structure  
✅ **HFHE Protection** - Encrypted payloads treated as opaque  
✅ **Cross-Wallet Compatibility** - Shared canonical serialization  

### Security Best Practices

1. **Private Keys**
   - Never exposed to content scripts
   - Never sent over messages
   - Only accessed in background context
   - Encrypted at rest

2. **Origin Validation**
   - Strict origin checking on all requests
   - Capabilities bound to specific origins
   - No wildcard origins (except file://)

3. **Nonce Management**
   - Monotonically increasing
   - Validated on every invocation
   - Prevents replay attacks

4. **Signature Verification**
   - All capabilities verified before use
   - Domain separation prevents replay
   - Ed25519 cryptographic signatures

5. **Rate Limiting**
   - Prevents spam attacks
   - Limits requests per origin
   - Timeout on pending requests

### Known Limitations

- File:// protocol requires wildcard origin (security warning logged)
- Session storage cleared on browser restart (by design)
- No hardware wallet support (planned for future)

---

## Troubleshooting

### Extension Not Detected

```javascript
// Check if extension is installed
if (typeof window.octra === 'undefined') {
  console.error('OctWa extension not installed');
  // Show install prompt
}
```

### Connection Issues

```javascript
// Check connection state
const state = sdk.getSessionState();
if (!state.connected) {
  await sdk.connect({ circle: 'my-circle' });
}
```

### Capability Errors

```javascript
// List capabilities
const capabilities = await sdk.listCapabilities();

// Renew if expired
for (const cap of capabilities) {
  if (cap.state === 'EXPIRED') {
    await sdk.renewCapability(cap.id);
  }
}
```

### Debugging

Enable debug logging:

```javascript
// In background.js
console.log('[Background] Debug info:', data);

// In content.js
console.log('[Content] Debug info:', data);

// In provider.js
console.log('[Provider] Debug info:', data);
```

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Test thoroughly
4. Submit a pull request

### Code Style

- Use ESLint configuration
- Follow existing patterns
- Add comments for complex logic
- Update documentation

---

## License

MIT License - see LICENSE file for details

---

## Support

- **Documentation**: https://docs.octra.network
- **GitHub**: https://github.com/m-tq/OctWa
- **Discord**: https://discord.gg/octra
- **Email**: support@octra.network

---

## Security

For security issues, please email: security@octra.network

**Do NOT open public issues for security vulnerabilities.**

---

**Built with ❤️ by the Octra Team**
