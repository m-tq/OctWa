# @octwa/sdk

SDK for integrating dApps with OCTWA Wallet browser extension.

## Installation

```bash
npm install @octwa/sdk
```

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

// Connect to a Circle
const connection = await sdk.connect({
  circle: 'my_dapp_v1',
  appOrigin: window.location.origin,
});

console.log('Connected:', connection.walletPubKey);
console.log('EVM Address:', connection.evmAddress);
console.log('Network:', connection.network);

// Request capability
const capability = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600,
});

// Invoke method
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'get_balance',
});

if (result.success) {
  const data = JSON.parse(new TextDecoder().decode(result.data));
  console.log('OCT Balance:', data.octBalance);
  console.log('ETH Balance:', data.ethBalance);
  console.log('USDC Balance:', data.usdcBalance);
}
```

## Core Concepts

### Circles
Circles are isolated contexts for dApp interactions. Each Circle has its own capabilities and permissions.

### Capabilities
Capabilities are cryptographically signed permissions that grant access to specific methods within a Circle.

```typescript
interface Capability {
  id: string;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}
```

### Invocations
Invoke methods using a valid capability:

```typescript
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'send_transaction',
  payload: new TextEncoder().encode(JSON.stringify({
    to: 'oct...',
    amount: 100,
  })),
});
```

### Network
Network is determined by the wallet/extension and returned in `connection.network`. dApps must follow this value to select API endpoints, explorers, and transaction behavior. If a dApp requires a specific network, prompt the user to switch networks in the wallet and then reconnect.

### Extension Method Compatibility
The extension exposes the following invoke methods and payloads. These are the real methods wired in `extensionFiles/background.js`.

Read scope (auto-executed, no approval):
- `get_balance` → no payload, returns balances
- `get_quote` → payload `{ apiUrl, from?: 'OCT', to?: 'ETH', amount }`
- `create_intent` → payload `{ quote, targetAddress, slippageBps? }`
- `submit_intent` → payload `{ apiUrl, octraTxHash }`
- `get_intent_status` → payload `{ apiUrl, intentId }`

Write scope (requires user approval in the extension UI):
- `sign_intent` → payload `SwapIntentPayload` (use `IntentsClient.signIntent`)
- `send_transaction` → payload `{ to, amount, message? }`
- `send_evm_transaction` → payload `{ to, amount?, value?, data? }`

## API Reference

### OctraSDK

#### `OctraSDK.init(options?)`
Initialize the SDK.

```typescript
const sdk = await OctraSDK.init({
  timeout: 3000, // Provider detection timeout
});
```

#### `sdk.isInstalled()`
Check if wallet extension is installed.

#### `sdk.connect(request)`
Connect to a Circle.

```typescript
const connection = await sdk.connect({
  circle: 'my_circle',
  appOrigin: window.location.origin,
});
```

#### `sdk.disconnect()`
Disconnect from current Circle.

#### `sdk.requestCapability(request)`
Request a new capability.

```typescript
const capability = await sdk.requestCapability({
  circle: 'my_circle',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 7200,
});
```

#### `sdk.invoke(request)`
Invoke a method using a capability.

```typescript
const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'get_balance',
  payload: new TextEncoder().encode(JSON.stringify({ ... })),
});
```

#### `sdk.getSessionState()`
Get current session state.

```typescript
const state = sdk.getSessionState();
// { connected: true, circle: 'my_circle', activeCapabilities: [...] }
```

### Events

```typescript
// Connection events
sdk.on('connect', ({ connection }) => { ... });
sdk.on('disconnect', () => { ... });

// Capability events
sdk.on('capabilityGranted', ({ capability }) => { ... });
sdk.on('capabilityRevoked', ({ capabilityId }) => { ... });

// Extension ready
sdk.on('extensionReady', () => { ... });
```

## Intents Client

For intent-based swaps (OCT ⇄ ETH):

```typescript
import { OctraSDK, IntentsClient } from '@octwa/sdk';

const sdk = await OctraSDK.init();
const intents = new IntentsClient(sdk, 'https://your-intents-api.example.com');

// Get quote from your intents API
const quote = await intents.getQuote(100); // 100 OCT

// Create intent
const payload = await intents.createIntent(quote, '0x...targetAddress');

// Sign intent (requires capability with `sign_intent`)
intents.setCapability(capability);
await intents.signIntent(payload);

// Submit after sending OCT to escrow
const result = await intents.submitIntent(octraTxHash);

// Wait for fulfillment
const status = await intents.waitForFulfillment(result.intentId);
```

## Error Handling

```typescript
import { 
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  CapabilityExpiredError,
  ScopeViolationError,
} from '@octwa/sdk';

try {
  await sdk.connect({ ... });
} catch (error) {
  if (error instanceof NotInstalledError) {
    // Wallet not installed
  } else if (error instanceof UserRejectedError) {
    // User rejected the request
  }
}
```

## Types

```typescript
import type {
  Connection,
  Capability,
  CapabilityRequest,
  InvocationRequest,
  InvocationResult,
  SessionState,
} from '@octwa/sdk';
```

## License

MIT
