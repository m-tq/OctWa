# @octwa/sdk

Octra Web Wallet SDK - Capability-based authorization for Octra dApps.

> **Important**: This SDK does NOT follow EVM/MetaMask patterns. It implements Octra's capability-based authorization model where dApps establish cryptographic authority over encrypted computation.

## Installation

```bash
npm install @octwa/sdk
```

## Core Concepts

### Octra Model vs EVM Model

**EVM Model (NOT used):**
```
connect → sign message → trust address
```

**Octra Model (Used):**
```
connect → issue capability → verify scoped authority
```

A dApp does not ask "Who are you?" but rather "What are you allowed to do, and can you cryptographically prove it?"

## Quick Start

```typescript
import { OctraSDK } from '@octwa/sdk';

// Initialize SDK
const sdk = await OctraSDK.init();

// Check if wallet is installed
if (!sdk.isInstalled()) {
  console.log('Please install Octra Wallet extension');
  return;
}

// Connect to a Circle (NO signing popup)
const connection = await sdk.connect({
  circle: 'my-circle-id',
  appOrigin: window.origin,
});

// Request capability (user approval required)
const capability = await sdk.requestCapability({
  circle: 'my-circle-id',
  methods: ['getData', 'setData'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600, // 1 hour
});

// Invoke method using capability
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'getData',
  payload: new Uint8Array([1, 2, 3]),
});

// Get session state
const state = sdk.getSessionState();
console.log('Connected:', state.connected);
console.log('Active capabilities:', state.activeCapabilities.length);

// Disconnect
await sdk.disconnect();
```

## API Reference

### `OctraSDK.init(options?)`

Initialize the SDK and detect wallet provider.

```typescript
const sdk = await OctraSDK.init({ timeout: 3000 });
```

### `sdk.connect(request)`

Connect to a Circle without signing.

```typescript
interface ConnectRequest {
  circle: string;      // Target Circle ID
  appOrigin: string;   // window.origin
}

interface Connection {
  circle: string;
  sessionId: string;
  walletPubKey: string;
  network: 'testnet' | 'mainnet';
}
```

### `sdk.requestCapability(request)`

Request scoped authorization from user.

```typescript
interface CapabilityRequest {
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  ttlSeconds?: number;
}

interface Capability {
  id: string;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  issuedAt: number;
  expiresAt?: number;
  issuerPubKey: string;
  signature: string;
}
```

### `sdk.invoke(request)`

Execute method with capability.

```typescript
interface InvocationRequest {
  capabilityId: string;
  method: string;
  payload?: Uint8Array | EncryptedBlob;
}

interface InvocationResult {
  success: boolean;
  data?: Uint8Array | EncryptedBlob;
  error?: string;
}
```

### `sdk.getSessionState()`

Get current session state.

```typescript
interface SessionState {
  connected: boolean;
  circle?: string;
  activeCapabilities: Capability[];
}
```

### `sdk.disconnect()`

Disconnect and clear all state.

## Encrypted Payloads

The SDK supports encrypted payloads using HFHE scheme:

```typescript
interface EncryptedBlob {
  scheme: 'HFHE';
  data: Uint8Array;
  metadata?: Uint8Array;
}

// Pass encrypted payload to invoke
await sdk.invoke({
  capabilityId: capability.id,
  method: 'processEncrypted',
  payload: {
    scheme: 'HFHE',
    data: encryptedData,
    metadata: encryptedMetadata,
  },
});
```

## Error Handling

```typescript
import {
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
  CapabilityError,
  ScopeViolationError,
} from '@octwa/sdk';

try {
  await sdk.invoke({ ... });
} catch (error) {
  if (error instanceof CapabilityError) {
    console.log('Capability invalid or expired');
  } else if (error instanceof ScopeViolationError) {
    console.log('Method not allowed by capability');
  }
}
```

## Events

```typescript
sdk.on('connect', ({ connection }) => {
  console.log('Connected to:', connection.circle);
});

sdk.on('disconnect', () => {
  console.log('Disconnected');
});

sdk.on('capabilityGranted', ({ capability }) => {
  console.log('Capability granted:', capability.id);
});

// Unsubscribe
const unsubscribe = sdk.on('connect', handler);
unsubscribe();
```

## Security

- **No arbitrary signing**: SDK does NOT expose `signMessage` or `signRaw`
- **Capability-based**: All actions require scoped, signed capabilities
- **Replay protection**: Nonces are monotonically increasing per capability
- **Origin binding**: App origin is embedded in capability hash
- **Expiry enforcement**: Capabilities become invalid after expiration

## License

MIT
