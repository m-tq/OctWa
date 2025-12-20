# @octwa/sdk

SDK for integrating dApps with Octra Wallet browser extension.

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

// Connect to wallet
const { address } = await sdk.connect();
console.log('Connected:', address);

// Send transaction
const { hash } = await sdk.sendTransaction({
  to: 'oct1abc...',
  amount: '1000000',
  message: 'Payment'
});
console.log('Transaction hash:', hash);
```

## API Reference

### Initialization

```typescript
// Initialize with default options (3s timeout)
const sdk = await OctraSDK.init();

// Initialize with custom timeout
const sdk = await OctraSDK.init({ timeout: 5000 });
```

### Connection

```typescript
// Check if extension is installed
sdk.isInstalled(): boolean

// Check if connected
sdk.isConnected(): boolean

// Connect with permissions
const result = await sdk.connect(['view_address', 'view_balance']);
// result: { address: string, permissions: string[] }

// Disconnect
await sdk.disconnect();

// Get connected account
const address = sdk.getAccount(); // throws if not connected
```

### Transactions

```typescript
// Send transaction
const { hash } = await sdk.sendTransaction({
  to: 'oct1recipient...',
  amount: '1000000',      // amount as string or number
  message: 'Optional memo'
});
```

### Smart Contracts

```typescript
// Call view method (no approval needed)
const result = await sdk.callContract(
  'oct1contract...',
  'getBalance',
  { account: 'oct1user...' }
);

// Invoke transaction method (requires approval)
const { hash } = await sdk.invokeContract(
  'oct1contract...',
  'transfer',
  { to: 'oct1recipient...', amount: '1000' },
  { gasLimit: 100000 }
);
```

### Message Signing

```typescript
const { signature, message } = await sdk.signMessage('Hello World');
```

### Events

```typescript
// Subscribe to events
const unsubscribe = sdk.on('connect', ({ address }) => {
  console.log('Connected:', address);
});

sdk.on('disconnect', () => {
  console.log('Disconnected');
});

sdk.on('accountChanged', ({ address }) => {
  console.log('Account changed:', address);
});

sdk.on('transaction', ({ hash }) => {
  console.log('Transaction:', hash);
});

// Unsubscribe
unsubscribe();
// or
sdk.off('connect', callback);
```

### Utility Methods

```typescript
// Get balance
const { balance, address } = await sdk.getBalance();
// or for specific address
const { balance } = await sdk.getBalance('oct1other...');

// Get network info
const { chainId, networkId, name } = await sdk.getNetwork();
```

## Error Handling

```typescript
import { 
  OctraSDK,
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
  TimeoutError,
  ContractError
} from '@octwa/sdk';

try {
  await sdk.connect();
} catch (error) {
  if (error instanceof NotInstalledError) {
    // Extension not installed
  } else if (error instanceof UserRejectedError) {
    // User rejected the request
  } else if (error instanceof TimeoutError) {
    // Request timed out
  } else if (error instanceof ValidationError) {
    // Invalid input parameters
  } else if (error instanceof ContractError) {
    // Contract call failed
  }
  
  // All errors have code and message
  console.log(error.code, error.message);
}
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  InitOptions,
  Permission,
  ConnectResult,
  TransactionRequest,
  TransactionResult,
  ContractParams,
  InvokeOptions,
  ContractResult,
  BalanceResult,
  NetworkInfo,
  SignatureResult,
  EventName,
  EventCallback,
  ErrorCode
} from '@octwa/sdk';
```

## License

MIT
