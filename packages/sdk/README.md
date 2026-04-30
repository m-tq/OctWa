# @octwa/sdk

**Version:** 1.2.0 · **License:** MIT · **Status:** Production Ready ✅

The official TypeScript SDK for integrating dApps with the [OctWa](https://github.com/m-tq/OctWa) wallet extension. Implements a capability-based authorization model with cryptographic origin binding, nonce replay protection, and real SHA-256 signing via the Web Crypto API.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Supported Methods](#supported-methods)
- [Security Model](#security-model)
- [Error Handling](#error-handling)
- [Cryptographic Utilities](#cryptographic-utilities)
- [Response Decoding](#response-decoding)
- [Testing](#testing)
- [Changelog](#changelog)

---

## Overview

The SDK is a **stateless transaction builder** — it never holds private keys. All signing happens inside the OctWa wallet extension.

```
DApp  ──invoke──▶  SDK  ──SignedInvocation──▶  OctWa Extension  ──▶  Octra Network
                                                  (private key)
```

**What the SDK does:**
- Detects the OctWa extension (`window.octra`)
- Manages the connection and capability lifecycle
- Builds and serializes invocations deterministically
- Tracks nonces to prevent replay attacks
- Serializes payloads for Chrome extension transport

**What the wallet does:**
- Holds private keys (never exposed to SDK)
- Validates capability signatures
- Enforces nonce monotonicity
- Signs and submits transactions to the node

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  DApp                                                        │
│  sdk.connect() → sdk.requestCapability() → sdk.invoke()      │
└──────────────────────────┬───────────────────────────────────┘
                           │ window.postMessage
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  OctWa Extension (content.js → background.js)                │
│  • Validates capability signature                            │
│  • Enforces nonce monotonicity                               │
│  • Signs transaction with Ed25519                            │
│  • Submits to Octra RPC                                      │
└──────────────────────────────────────────────────────────────┘
```

### Trust Boundaries

| Layer | Trusted? | Responsibility |
|-------|----------|----------------|
| DApp | ❌ Untrusted | Business logic, UI |
| SDK | ✅ Trusted | Serialization, nonce tracking |
| Extension | ✅ Trusted | Key custody, signing, validation |
| Node | ✅ Trusted | Execution, consensus |

---

## Installation

```bash
npm install @octwa/sdk
```

```bash
yarn add @octwa/sdk
```

```bash
pnpm add @octwa/sdk
```

**Requirements:**
- Node.js ≥ 16 (for build tooling)
- Browser with Web Crypto API support
- [OctWa Wallet Extension](https://github.com/m-tq/OctWa) installed

---

## Quick Start

### 1. Initialize

```typescript
import { OctraSDK } from '@octwa/sdk';

const sdk = await OctraSDK.init({ timeout: 3000 });

if (!sdk.isInstalled()) {
  // Prompt user to install OctWa extension
  window.open('https://github.com/m-tq/OctWa');
  return;
}
```

### 2. Connect

```typescript
const connection = await sdk.connect({
  circle:    'my-dapp',
  appName:   'My DApp',
  appOrigin: window.location.origin,
});

console.log('Octra address:', connection.walletPubKey);
console.log('EVM address:',   connection.evmAddress);
console.log('Network:',       connection.network);   // 'mainnet' | 'testnet'
console.log('Epoch:',         connection.epoch);
```

### 3. Request Capability

```typescript
const cap = await sdk.requestCapability({
  circle:     'my-dapp',
  methods:    ['get_balance', 'send_transaction'],
  scope:      'write',
  encrypted:  false,
  ttlSeconds: 3600, // 1 hour
});

console.log('Capability ID:', cap.id);
console.log('Expires:',       new Date(cap.expiresAt).toISOString());
```

### 4. Invoke Methods

```typescript
// Read balance (auto-executed, no popup)
const result = await sdk.invoke({
  capabilityId: cap.id,
  method:       'get_balance',
});

import { decodeBalanceResponse } from '@octwa/sdk';
const balance = decodeBalanceResponse(result);
console.log('OCT balance:', balance.octBalance);
```

### 5. Send Transaction

```typescript
// Requires user approval in popup
const txResult = await sdk.invoke({
  capabilityId: cap.id,
  method:       'send_transaction',
  payload:      new TextEncoder().encode(JSON.stringify({
    to:     'octXXX...',
    amount: 1.5,
    message: 'optional memo',
  })),
});

import { decodeResponseData } from '@octwa/sdk';
const tx = decodeResponseData<{ txHash: string }>(txResult);
console.log('TX hash:', tx?.txHash);
```

---

## Core Concepts

### Circles

A Circle is a named authorization scope — similar to an OAuth client ID. Your dApp uses a consistent circle ID across all sessions.

```typescript
const CIRCLE = 'my-dapp-v1'; // Use a stable, unique identifier
```

### Capabilities

A capability is a **cryptographically signed permission token** issued by the wallet. It grants your dApp access to specific methods for a limited time.

```typescript
interface Capability {
  id:           string;
  version:      2;
  circle:       string;
  methods:      readonly string[];   // e.g. ['get_balance', 'send_transaction']
  scope:        'read' | 'write' | 'compute';
  encrypted:    boolean;
  appOrigin:    string;              // cryptographically bound to your origin
  branchId:     string;
  epoch:        number;
  issuedAt:     number;
  expiresAt:    number;
  nonceBase:    number;
  walletPubKey: string;
  signature:    string;              // Ed25519 signature
  state:        'ACTIVE' | 'EXPIRED' | 'REVOKED';
  lastNonce:    number;
}
```

**Capability scopes:**

| Scope | Description | Requires popup? |
|-------|-------------|-----------------|
| `read` | Read-only (e.g. `get_balance`) | No — auto-executed |
| `write` | State-changing (e.g. `send_transaction`) | Yes |
| `compute` | HFHE encrypted operations | Yes |

### Invocations

Each `sdk.invoke()` call builds a `SignedInvocation` with:
- A monotonically increasing nonce (replay protection)
- A domain-separated origin hash (cross-origin protection)
- A payload hash (integrity)

The wallet validates all of these before signing.

### Nonce Management

The SDK tracks nonces locally. The wallet is the **final authority** — it rejects any invocation with a nonce ≤ the last accepted nonce.

```typescript
// SDK increments nonce automatically
const result1 = await sdk.invoke({ capabilityId, method: 'method_a' }); // nonce=1
const result2 = await sdk.invoke({ capabilityId, method: 'method_b' }); // nonce=2

// Concurrent invocations are serialized via signing mutex
const [r1, r2] = await Promise.all([
  sdk.invoke({ capabilityId, method: 'method_a' }),
  sdk.invoke({ capabilityId, method: 'method_b' }),
]);
// Guaranteed: r1.nonce < r2.nonce
```

---

## API Reference

### `OctraSDK.init(options?)`

```typescript
const sdk = await OctraSDK.init({
  timeout:                  3000,  // ms to wait for extension (default: 3000)
  autoCleanupExpired:       true,  // remove expired capabilities automatically
  skipSignatureVerification: false, // testing only — never use in production
});
```

### `sdk.isInstalled()`

Returns `true` if the OctWa extension is detected in `window.octra`.

### `sdk.connect(request)`

Opens the wallet connection popup. Returns a `Connection` object.

```typescript
interface ConnectRequest {
  circle:                  string;
  appOrigin?:              string;  // defaults to window.location.origin
  appName?:                string;
  appIcon?:                string;
  requestedCapabilities?:  CapabilityTemplate[];
}

interface Connection {
  circle:       string;
  sessionId:    string;
  walletPubKey: string;   // Octra address
  evmAddress:   string;   // Ethereum address (derived from same key)
  network:      'mainnet' | 'testnet';
  epoch:        number;
  branchId:     string;
}
```

### `sdk.disconnect()`

Clears connection and all capabilities.

### `sdk.requestCapability(request)`

Opens the capability approval popup. Returns a `Capability`.

```typescript
interface CapabilityRequest {
  circle:      string;
  methods:     string[];
  scope:       'read' | 'write' | 'compute';
  encrypted:   boolean;
  ttlSeconds?: number;   // default: 86400 (24h)
  branchId?:   string;
}
```

### `sdk.renewCapability(capabilityId)`

Extends an existing capability's expiration by 15 minutes.

### `sdk.revokeCapability(capabilityId)`

Immediately revokes a capability.

### `sdk.listCapabilities()`

Returns all active capabilities for the current origin.

### `sdk.invoke(request)`

Invokes a method using a capability. Builds and sends a `SignedInvocation`.

```typescript
interface InvocationRequest {
  capabilityId: string;
  method:       string;
  payload?:     Uint8Array | EncryptedPayload;
  branchId?:    string;
}

interface InvocationResult {
  success:         boolean;
  data?:           Uint8Array | EncryptedPayload;
  error?:          string;
  branchProofHash?: string;
  epochTag?:       number;
}
```

### `sdk.estimatePlainTx(payload)`

Returns a fee estimate for a standard transaction. The wallet fetches live fees from `octra_recommendedFee` — this is a client-side fallback for pre-flight display.

### `sdk.estimateEncryptedTx(payload)`

Returns a fee estimate for an encrypted transaction.

### `sdk.getSessionState()`

```typescript
interface SessionState {
  connected:          boolean;
  circle?:            string;
  branchId?:          string;
  epoch?:             number;
  activeCapabilities: Capability[];
}
```

### `sdk.on(event, callback)`

Subscribe to events. Returns an unsubscribe function.

```typescript
const off = sdk.on('connect', ({ connection }) => {
  console.log('Connected:', connection.walletPubKey);
});

// Unsubscribe
off();
```

**Available events:**

| Event | Payload |
|-------|---------|
| `extensionReady` | — |
| `connect` | `{ connection: Connection }` |
| `disconnect` | — |
| `capabilityGranted` | `{ capability: Capability }` |
| `capabilityExpired` | `{ capabilityId: string }` |
| `capabilityRevoked` | `{ capabilityId: string }` |
| `branchChanged` | `{ branchId: string; epoch: number }` |
| `epochChanged` | `{ epoch: number }` |

---

## Supported Methods

These are the methods the OctWa extension handles via `invoke()`:

| Method | Scope | Auto-execute | Description |
|--------|-------|-------------|-------------|
| `get_balance` | `read` | ✅ Yes | Fetch OCT balance |
| `send_transaction` | `write` | ❌ Popup | Send OCT (standard or contract call) |
| `send_evm_transaction` | `write` | ❌ Popup | Send ETH/EVM transaction |
| `send_erc20_transaction` | `write` | ❌ Popup | Send ERC-20 token |

### `get_balance` payload

No payload needed. Response:

```typescript
interface BalanceResponse {
  octAddress: string;
  octBalance: number;
  network:    'mainnet' | 'testnet';
}
```

### `send_transaction` payload

```typescript
{
  to:             string;  // Octra address
  amount:         number;  // OCT (float)
  message?:       string;  // optional memo or contract params
  op_type?:       string;  // 'standard' (default) or 'call' for contract calls
  encrypted_data?: string; // contract method name, e.g. 'lock_to_eth'
}
```

### `send_evm_transaction` payload

```typescript
{
  to:       string;  // EVM address (0x...)
  amount?:  string;  // ETH amount (human-readable)
  value?:   string;  // wei (hex or decimal string)
  data?:    string;  // hex-encoded calldata for contract calls
  network?: string;  // 'eth-mainnet' | 'eth-sepolia' | etc.
}
```

### `send_erc20_transaction` payload

```typescript
{
  tokenContract: string;  // ERC-20 contract address
  to:            string;  // recipient EVM address
  amount:        string;  // raw units (e.g. '1000000' for 1 USDC)
  decimals:      number;  // token decimals
  symbol:        string;  // token symbol (e.g. 'USDC')
}
```

---

## Security Model

### Canonical Serialization

All capability payloads and invocations are serialized deterministically before hashing:

```typescript
import { canonicalize, canonicalizeCapability } from '@octwa/sdk';

// Keys sorted lexicographically, no whitespace
canonicalize({ b: 2, a: 1 });
// → '{"a":1,"b":2}'

// Methods sorted, all fields in canonical order
canonicalizeCapability(payload);
// → '{"appOrigin":"...","branchId":"main","circle":"...",...}'
```

### Domain Separation

Prevents signature replay across different contexts:

```typescript
import { OCTRA_CAPABILITY_PREFIX, OCTRA_INVOCATION_PREFIX } from '@octwa/sdk';

// Capability hash: OCTRA_CAPABILITY_PREFIX + canonical
// Invocation hash: OCTRA_INVOCATION_PREFIX + canonical
```

### Real SHA-256

All cryptographic hashing uses `crypto.subtle.digest('SHA-256', ...)` — the Web Crypto API. No custom hash functions for security-critical operations.

```typescript
import { sha256Bytes, sha256String } from '@octwa/sdk';

const hash = await sha256Bytes(data);   // Uint8Array → hex string
const hash2 = await sha256String(str);  // string → hex string
```

### Signing Mutex

Concurrent invocations are serialized to prevent nonce races:

```typescript
// These run sequentially, not in parallel
await Promise.all([
  sdk.invoke({ capabilityId, method: 'a' }), // nonce=1
  sdk.invoke({ capabilityId, method: 'b' }), // nonce=2
]);
```

### HFHE Encrypted Payloads

Encrypted payloads are treated as opaque blobs — never inspected:

```typescript
// ✅ Correct: pass as-is
await sdk.invoke({
  capabilityId,
  method: 'process',
  payload: {
    scheme: 'HFHE',
    data: ciphertext,
    associatedData: 'metadata',
  },
});
```

---

## Error Handling

All errors extend `OctraError`:

```typescript
import {
  OctraError,
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  CapabilityError,
  ScopeViolationError,
  CapabilityExpiredError,
} from '@octwa/sdk';

try {
  await sdk.invoke(request);
} catch (error) {
  if (error instanceof UserRejectedError) {
    return; // User cancelled — no error UI needed
  }
  if (error instanceof CapabilityExpiredError) {
    const renewed = await sdk.renewCapability(capabilityId);
    // retry...
  }
  if (error instanceof OctraError) {
    console.error(`[${error.code}] ${error.message}`);
  }
}
```

**Error codes:**

| Code | Class | Description |
|------|-------|-------------|
| `NOT_INSTALLED` | `NotInstalledError` | Extension not found |
| `NOT_CONNECTED` | `NotConnectedError` | No active connection |
| `USER_REJECTED` | `UserRejectedError` | User cancelled popup |
| `TIMEOUT` | `TimeoutError` | Operation timed out |
| `VALIDATION_ERROR` | `ValidationError` | Invalid input |
| `CAPABILITY_ERROR` | `CapabilityError` | Capability not found |
| `SCOPE_VIOLATION` | `ScopeViolationError` | Method not in capability |
| `CAPABILITY_EXPIRED` | `CapabilityExpiredError` | Capability expired |
| `CAPABILITY_REVOKED` | `CapabilityRevokedError` | Capability revoked |
| `ORIGIN_MISMATCH` | `OriginMismatchError` | Origin binding failed |
| `NONCE_VIOLATION` | `NonceViolationError` | Nonce out of order |

---

## Cryptographic Utilities

```typescript
import {
  // Hashing (async, Web Crypto API)
  sha256Bytes,          // Uint8Array → hex string
  sha256String,         // string → hex string
  sha256,               // Uint8Array → Uint8Array

  // Encoding
  hexToBytes,           // hex string → Uint8Array
  bytesToHex,           // Uint8Array → hex string

  // Canonicalization
  canonicalize,         // any → deterministic JSON string
  canonicalizeCapability,
  canonicalizeInvocation,

  // Domain-separated hashing (async)
  hashCapabilityWithDomain,
  hashInvocationWithDomain,

  // Signature verification
  verifyEd25519Signature,
  verifyCapabilitySignature,

  // Nonce
  generateNonce,        // → UUID-format string

  // Constants
  OCTRA_CAPABILITY_PREFIX,
  OCTRA_INVOCATION_PREFIX,
  OCTRA_DOMAIN_PREFIX,
} from '@octwa/sdk';
```

---

## Response Decoding

Chrome extension messaging serializes `Uint8Array` as numeric-keyed objects. The SDK handles this automatically:

```typescript
import { decodeResponseData, decodeBalanceResponse } from '@octwa/sdk';

// Generic — works for any JSON-encoded response
const result = await sdk.invoke({ capabilityId, method: 'custom' });
const data = decodeResponseData<{ txHash: string }>(result);

// Balance-specific
const balResult = await sdk.invoke({ capabilityId, method: 'get_balance' });
const balance = decodeBalanceResponse(balResult);
// → { octAddress, octBalance, network }
```

---

## Testing

```bash
cd packages/sdk
npm install
npm test        # run all tests (vitest)
npm run build   # build CJS + ESM + types
```

### Mock Provider

```typescript
import { OctraSDK } from '@octwa/sdk';
import { createMockProvider, injectMockProvider } from './tests/mocks/provider';

const mock = createMockProvider({ shouldRejectCapability: false });
injectMockProvider(mock);

const sdk = await OctraSDK.init({ timeout: 100 });
await sdk.connect({ circle: 'test', appOrigin: 'https://example.com' });
```

---

## Changelog

### v1.2.0

- **`types.ts`**: `Connection.epoch` and `branchId` are now required (not optional). `evmAddress` always present. `BalanceResponse` is OCT-only (removed `ethBalance`, `usdcBalance`, `evmAddress`, `evmNetwork`). Removed `ComputeRequest/Profile/Result`, `EVMNetworkId`. `OctraProvider.disconnect()` returns `Promise<{disconnected: boolean}>`.
- **`canonical.ts`**: `sha256Bytes` / `sha256String` now use real SHA-256 via `crypto.subtle` (previously djb2). `hashCapabilityWithDomain` / `hashInvocationWithDomain` are now async.
- **`sdk.ts`**: Removed `invokeCompute`, `estimateComputeCost`, `signMessage` (not exposed on SDK). Payload serialized as `{_type, data}` for Chrome extension transport.
- **`utils.ts`**: `detectProvider` now listens for `octra:announceProvider` CustomEvent (EIP-6963 analog) in addition to legacy `octraLoaded`.
- **`capability-service.ts`**: `validate()` throws `CapabilityError` (not plain `Error`) for not-found capabilities.
- **`compute-service.ts`**: Removed (HFHE compute removed from extension background).
- **`gas-service.ts`**: Simplified fallback values; wallet fetches live fees from `octra_recommendedFee`.
- **Tests**: All 47 tests pass. Test vectors updated to v2 capability format.

### v1.1.1

- Initial public release with capability-based authorization model.

---

## License

MIT — see [LICENSE](./LICENSE)

## Support

- **GitHub**: https://github.com/m-tq/OctWa
- **Issues**: https://github.com/m-tq/OctWa/issues
- **Security**: security@octra.network (do not open public issues for vulnerabilities)
