# Octra Web Wallet SDK

**Version:** 2.0.0  
**License:** MIT  
**Status:** Production Ready ✅

The official TypeScript SDK for integrating with the Octra blockchain through the OctWa wallet extension. Implements a capability-based authorization model with full support for HFHE (Homomorphic Fully Encrypted) transactions.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Security](#security)
- [Advanced Usage](#advanced-usage)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Migration Guide](#migration-guide)

---

## Overview

The Octra SDK provides a stateless, deterministic transaction builder for dApps to interact with the Octra blockchain. It follows a strict security model where:

- **SDK**: Builds transactions deterministically (NO signing, NO private keys)
- **Wallet**: Final authority for signing and transaction submission
- **Network**: Executes transactions with HFHE encryption support

### Key Features

✅ **Capability-Based Authorization** - Fine-grained permission model  
✅ **HFHE Support** - Fully encrypted transaction execution  
✅ **Deterministic Serialization** - Canonical transaction building  
✅ **Domain Separation** - Prevents signature replay attacks  
✅ **Signing Mutex** - Prevents race conditions and double-send  
✅ **Type-Safe** - Full TypeScript support with comprehensive types  
✅ **Event System** - Real-time connection and capability events  
✅ **Gas Estimation** - Built-in gas and compute cost estimation  
🚫 **Intent-Based Swaps** - Cross-chain swap support (currently disabled, under development)  

---

## Architecture

```
┌─────────┐      ┌─────────┐      ┌────────────┐      ┌──────────────┐
│  DApp   │─────▶│   SDK   │─────▶│   Wallet   │─────▶│ Octra Network│
│         │      │         │      │ (Extension)│      │              │
└─────────┘      └─────────┘      └────────────┘      └──────────────┘
                                         │
                                         │ Private Keys
                                         │ Signing
                                         │ Nonce Validation
                                         ▼
                                  Final Authority
```

### Trust Boundaries

1. **DApp Layer**: User interface and business logic
2. **SDK Layer**: Stateless transaction builder (this package)
3. **Wallet Layer**: Private key custody and signing
4. **Network Layer**: Transaction execution and state management

---

## Installation

```bash
npm install @octra/sdk
```

Or with yarn:

```bash
yarn add @octra/sdk
```

Or with pnpm:

```bash
pnpm add @octra/sdk
```

### Requirements

- Node.js >= 16
- TypeScript >= 4.5 (optional, but recommended)
- OctWa Wallet Extension installed in browser

---

## Quick Start

### 1. Initialize SDK

```typescript
import { OctraSDK } from '@octra/sdk';

// Initialize SDK (detects wallet extension)
const sdk = await OctraSDK.init({
  timeout: 3000, // Wait up to 3s for extension
});

// Check if wallet is installed
if (!sdk.isInstalled()) {
  console.error('Please install OctWa wallet extension');
  return;
}
```

### 2. Connect to Wallet

```typescript
// Request connection to a Circle
const connection = await sdk.connect({
  circle: 'my-circle-id',
  appName: 'My DApp',
  appIcon: 'https://mydapp.com/icon.png',
});

console.log('Connected:', connection.walletPubKey);
console.log('EVM Address:', connection.evmAddress);
console.log('Network:', connection.network);
```

### 3. Request Capability

```typescript
// Request permission to call specific methods
const capability = await sdk.requestCapability({
  circle: 'my-circle-id',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600, // 1 hour
});

console.log('Capability granted:', capability.id);
```

### 4. Invoke Methods

```typescript
// Get balance
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'get_balance',
});

// Decode response
import { decodeBalanceResponse } from '@octra/sdk';
const balance = decodeBalanceResponse(result);
console.log('OCT Balance:', balance.octBalance);
console.log('ETH Balance:', balance.ethBalance);
```

---

## Core Concepts

### Capabilities

Capabilities are cryptographically signed permissions that grant your dApp access to specific methods. They are:

- **Scoped**: Limited to specific methods
- **Time-bound**: Have expiration times
- **Origin-bound**: Tied to your dApp's origin
- **Revocable**: Can be revoked by user at any time

**Capability Scopes:**

- `read`: Read-only operations (e.g., `get_balance`)
- `write`: State-changing operations (e.g., `send_transaction`)
- `compute`: HFHE computation operations

### Invocations

Invocations are signed method calls using a capability. Each invocation:

- Uses a monotonically increasing nonce (replay protection)
- Includes domain separation (prevents signature replay)
- Is validated by the wallet before execution
- Can include encrypted payloads (HFHE)

### Sessions

Sessions represent the connection state between your dApp and the wallet:

```typescript
const session = sdk.getSessionState();
console.log('Connected:', session.connected);
console.log('Circle:', session.circle);
console.log('Active Capabilities:', session.activeCapabilities.length);
```

---

## API Reference

### OctraSDK Class

#### Static Methods

##### `init(options?: InitOptions): Promise<OctraSDK>`

Initialize the SDK and detect wallet extension.

```typescript
const sdk = await OctraSDK.init({
  timeout: 3000, // Detection timeout in ms
  autoCleanupExpired: true, // Auto-remove expired capabilities
  skipSignatureVerification: false, // For testing only
});
```

#### Instance Methods

##### `isInstalled(): boolean`

Check if wallet extension is installed.

```typescript
if (!sdk.isInstalled()) {
  alert('Please install OctWa wallet');
}
```

##### `connect(request: ConnectRequest): Promise<Connection>`

Request connection to a Circle.

```typescript
const connection = await sdk.connect({
  circle: 'circle-id',
  appName: 'My DApp',
  appIcon: 'https://example.com/icon.png',
  appOrigin: window.location.origin, // Auto-detected
  requestedCapabilities: [ // Optional: request capabilities immediately
    {
      methods: ['get_balance'],
      scope: 'read',
      encrypted: false,
    }
  ],
});
```

**Returns:**
```typescript
interface Connection {
  circle: string;
  sessionId: string;
  walletPubKey: string;
  evmAddress?: string;
  network: 'testnet' | 'mainnet';
  epoch: number;
  branchId: string;
}
```

##### `disconnect(): Promise<void>`

Disconnect from wallet and clear all capabilities.

```typescript
await sdk.disconnect();
```

##### `requestCapability(request: CapabilityRequest): Promise<Capability>`

Request a new capability from the user.

```typescript
const capability = await sdk.requestCapability({
  circle: 'circle-id',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600, // Optional: default 1 hour
  branchId: 'main', // Optional: specific branch
});
```

**Returns:**
```typescript
interface Capability {
  id: string;
  version: 2;
  circle: string;
  methods: readonly string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  branchId: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
  nonceBase: number;
  walletPubKey: string;
  signature: string;
  state: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  lastNonce: number;
}
```

##### `renewCapability(capabilityId: string): Promise<Capability>`

Renew an existing capability (extends expiration).

```typescript
const renewed = await sdk.renewCapability(capability.id);
```

##### `revokeCapability(capabilityId: string): Promise<void>`

Revoke a capability (user can also revoke from wallet UI).

```typescript
await sdk.revokeCapability(capability.id);
```

##### `listCapabilities(): Promise<Capability[]>`

List all active capabilities for current origin.

```typescript
const capabilities = await sdk.listCapabilities();
```

##### `invoke(request: InvocationRequest): Promise<InvocationResult>`

Invoke a method using a capability.

```typescript
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'get_balance',
  payload: new TextEncoder().encode(JSON.stringify({ /* params */ })),
  branchId: 'main', // Optional: override branch
});
```

**Returns:**
```typescript
interface InvocationResult {
  success: boolean;
  data?: Uint8Array | EncryptedPayload;
  error?: string;
  branchProofHash?: string;
  merkleRoot?: string;
  epochTag?: number;
}
```

##### `invokeCompute(request: ComputeRequest): Promise<ComputeResult>`

Execute HFHE computation.

```typescript
const result = await sdk.invokeCompute({
  circleId: 'circle-id',
  capabilityId: capability.id,
  branchId: 'main',
  circuitId: 'my-circuit',
  encryptedInput: {
    scheme: 'HFHE',
    data: encryptedData,
    associatedData: 'metadata',
  },
  computeProfile: {
    gateCount: 1000,
    vectorSize: 256,
    depth: 10,
    expectedBootstrap: 2,
  },
  gasLimit: 1000000,
});
```

##### `estimatePlainTx(payload: unknown): Promise<GasEstimate>`

Estimate gas for plain transaction.

```typescript
const estimate = await sdk.estimatePlainTx({ amount: 100 });
console.log('Gas units:', estimate.gasUnits);
console.log('Token cost:', estimate.tokenCost);
```

##### `estimateEncryptedTx(payload: EncryptedPayload): Promise<GasEstimate>`

Estimate gas for encrypted transaction.

```typescript
const estimate = await sdk.estimateEncryptedTx(encryptedPayload);
```

##### `estimateComputeCost(profile: ComputeProfile): Promise<GasEstimate>`

Estimate cost for HFHE computation.

```typescript
const estimate = await sdk.estimateComputeCost({
  gateCount: 1000,
  vectorSize: 256,
  depth: 10,
  expectedBootstrap: 2,
});
```

##### `signMessage(message: string): Promise<string>`

Request user to sign an arbitrary message.

```typescript
const signature = await sdk.signMessage('Hello, Octra!');
```

##### `getSessionState(): SessionState`

Get current session state.

```typescript
const state = sdk.getSessionState();
console.log('Connected:', state.connected);
console.log('Active capabilities:', state.activeCapabilities);
```

##### `on<E>(event: EventName, callback: EventCallback<E>): () => void`

Subscribe to events. Returns unsubscribe function.

```typescript
const unsubscribe = sdk.on('connect', ({ connection }) => {
  console.log('Connected to:', connection.circle);
});

// Later: unsubscribe()
```

**Events:**
- `extensionReady`: Wallet extension detected
- `connect`: Connected to wallet
- `disconnect`: Disconnected from wallet
- `capabilityGranted`: New capability granted
- `capabilityExpired`: Capability expired
- `capabilityRevoked`: Capability revoked
- `branchChanged`: Branch changed
- `epochChanged`: Epoch changed

---

## Security

### Canonical Serialization

All transactions use deterministic canonical serialization:

```typescript
import { canonicalize, canonicalizeCapability } from '@octra/sdk';

// Canonicalize any object
const canonical = canonicalize({ b: 2, a: 1 });
// Result: '{"a":1,"b":2}' (keys sorted)

// Canonicalize capability
const capCanonical = canonicalizeCapability(capabilityPayload);
```

**Rules:**
- Keys sorted lexicographically
- No whitespace
- Deterministic number formatting
- Uint8Array → hex with '0x' prefix

### Domain Separation

Prevents signature replay attacks:

```typescript
import { 
  OCTRA_CAPABILITY_PREFIX,
  OCTRA_INVOCATION_PREFIX,
  hashCapabilityWithDomain 
} from '@octra/sdk';

// Capability signing includes domain prefix
const hash = hashCapabilityWithDomain(payload);
// Internally: hash(OCTRA_CAPABILITY_PREFIX + canonical)
```

### Signing Mutex

Automatic protection against race conditions:

```typescript
// These will execute sequentially, not in parallel
const [result1, result2] = await Promise.all([
  sdk.invoke({ capabilityId, method: 'method1' }),
  sdk.invoke({ capabilityId, method: 'method2' }),
]);
// result1.nonce = 1, result2.nonce = 2 (guaranteed order)
```

### HFHE Encrypted Payloads

Encrypted payloads are treated as opaque blobs:

```typescript
import { hashPayload } from '@octra/sdk';

// ✅ CORRECT: Hash without inspecting
const hash = hashPayload(encryptedPayload);

// ❌ WRONG: Don't inspect ciphertext
const data = JSON.parse(encryptedPayload.data); // Never do this!
```

### Nonce Management

SDK provides nonces for ordering, wallet validates:

```typescript
// SDK manages nonce locally
const nonce = nonceManager.getNextNonce(capabilityId);

// On error, rollback
catch (error) {
  nonceManager.resetNonce(capabilityId, nonce - 1);
}

// Wallet is final authority and validates nonce
```

---

## Advanced Usage

### Intent-Based Swaps

```typescript
import { IntentsClient } from '@octra/sdk';

// Create intents client
const intents = new IntentsClient(sdk, 'https://api.octra.network');
intents.setCapability(capability);

// Get quote
const quote = await intents.getQuote(100); // 100 OCT

// Create intent
const intent = await intents.createIntent(
  quote,
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', // Target ETH address
  50 // 0.5% slippage
);

// Sign and submit
const signResult = await intents.signIntent(intent);
const submitResult = await intents.submitIntent(signResult.txHash);

// Poll for fulfillment
const status = await intents.waitForFulfillment(submitResult.intentId, {
  timeoutMs: 5 * 60 * 1000, // 5 minutes
  pollIntervalMs: 3000, // Check every 3s
});

console.log('Swap completed:', status.ethTxHash);
```

### Response Decoding

```typescript
import { decodeResponseData, decodeBalanceResponse } from '@octra/sdk';

// Generic decoding
const result = await sdk.invoke({ capabilityId, method: 'custom_method' });
const data = decodeResponseData<MyType>(result);

// Balance-specific decoding
const balanceResult = await sdk.invoke({ capabilityId, method: 'get_balance' });
const balance = decodeBalanceResponse(balanceResult);
```

### Cryptographic Utilities

```typescript
import {
  sha256,
  hexToBytes,
  bytesToHex,
  verifyEd25519Signature,
  verifyCapabilitySignature,
} from '@octra/sdk';

// SHA-256 hashing
const hash = await sha256(data);

// Hex conversion
const bytes = hexToBytes('0x1234abcd');
const hex = bytesToHex(bytes);

// Signature verification
const isValid = await verifyEd25519Signature(
  signature,
  message,
  publicKey
);

// Capability verification
const isValidCap = await verifyCapabilitySignature(capability);
```

---

## Error Handling

All errors extend `OctraError` with structured information:

```typescript
import {
  OctraError,
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
  CapabilityError,
} from '@octra/sdk';

try {
  await sdk.invoke(request);
} catch (error) {
  if (error instanceof UserRejectedError) {
    // User cancelled - don't show error
    console.log('User cancelled');
  } else if (error instanceof NotConnectedError) {
    // Need to connect first
    await sdk.connect({ circle: 'my-circle' });
  } else if (error instanceof CapabilityError) {
    // Capability issue - might need to renew
    console.error('Capability error:', error.message);
  } else if (error instanceof OctraError) {
    // Generic Octra error
    console.error('Error code:', error.code);
    console.error('Details:', error.details);
  }
}
```

**Error Codes:**
- `NOT_INSTALLED`: Wallet extension not installed
- `NOT_CONNECTED`: Not connected to wallet
- `USER_REJECTED`: User rejected the request
- `TIMEOUT`: Operation timed out
- `VALIDATION_ERROR`: Input validation failed
- `CAPABILITY_ERROR`: Capability issue
- `SCOPE_VIOLATION`: Method not allowed by capability
- `SIGNATURE_INVALID`: Invalid signature
- `CAPABILITY_EXPIRED`: Capability expired
- `CAPABILITY_REVOKED`: Capability revoked
- `ORIGIN_MISMATCH`: Origin mismatch
- `BRANCH_MISMATCH`: Branch mismatch
- `EPOCH_MISMATCH`: Epoch mismatch
- `NONCE_VIOLATION`: Nonce violation
- `DOMAIN_SEPARATION_ERROR`: Domain separation error

---

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### Test with Mock Wallet

```typescript
import { OctraSDK } from '@octra/sdk';

const sdk = await OctraSDK.init({
  skipSignatureVerification: true, // For testing only!
});
```

---

## Migration Guide

### From v1 to v2

**Breaking Changes:**

1. **Error Structure**: Errors now include `code`, `layer`, `retryable`
2. **Domain Separation**: Signatures include domain prefixes
3. **Canonical Serialization**: All hashing uses canonical format

**Migration Steps:**

```typescript
// v1
try {
  await sdk.invoke(request);
} catch (error) {
  alert(error.message);
}

// v2
try {
  await sdk.invoke(request);
} catch (error) {
  if (error.code === 'USER_REJECTED') {
    return; // Don't show error
  }
  
  if (error.retryable) {
    // Show retry button
  } else {
    alert(error.message);
  }
}
```

**Compatibility:**
- ✅ v1 capabilities still work
- ✅ v1 API unchanged
- ✅ New features are additive

---

## File Structure

```
packages/sdk/
├── src/
│   ├── canonical.ts           # Canonical serialization
│   ├── capability-manager.ts  # Capability management
│   ├── capability-service.ts  # Capability validation
│   ├── compute-service.ts     # HFHE compute operations
│   ├── crypto.ts              # Cryptographic utilities
│   ├── errors.ts              # Error classes
│   ├── gas-service.ts         # Gas estimation
│   ├── index.ts               # Public API exports
│   ├── intents.ts             # Intent-based swaps
│   ├── nonce-manager.ts       # Nonce management
│   ├── response-utils.ts      # Response decoding
│   ├── sdk.ts                 # Main SDK class
│   ├── session-manager.ts     # Session management
│   ├── types.ts               # TypeScript types
│   └── utils.ts               # Utility functions
├── tests/
│   ├── crypto.test.ts         # Crypto tests
│   └── sdk.test.ts            # SDK tests
├── dist/                      # Compiled output
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md                  # This file
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit a pull request

---

## License

MIT License - see LICENSE file for details

---

## Support

- **Documentation**: https://docs.octra.network
- **GitHub**: https://github.com/octra/octwa
- **Discord**: https://discord.gg/octra
- **Email**: support@octra.network

---

## Security

For security issues, please email: security@octra.network

**Do NOT open public issues for security vulnerabilities.**

---

**Built with ❤️ by the Octra Team**
