# @octwa/sdk

TypeScript SDK for integrating dApps with the **OctWa Wallet** browser extension.

All signing, key operations, and proof generation happen inside the wallet extension — private keys never leave the extension context.

---

## Installation

```bash
npm install @octwa/sdk
```

---

## Quick Start

```typescript
import { OctraSDK, decodeBalanceResponse } from '@octwa/sdk';

const sdk = await OctraSDK.init({ timeout: 3000 });

if (!sdk.isInstalled()) {
  console.log('Please install OctWa Wallet extension');
  return;
}

// Connect to a circle
const connection = await sdk.connect({
  circle: 'my_dapp_v1',
  appOrigin: window.location.origin,
  appName: 'My dApp',
});

console.log('Octra address:', connection.walletPubKey);
console.log('EVM address:',   connection.evmAddress);
console.log('Network:',       connection.network);       // 'mainnet' | 'devnet'
console.log('EVM network:',   connection.evmNetworkId);  // e.g. 'eth-mainnet'

// Request capability
const cap = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance'],
  scope: 'read',
  encrypted: false,
  ttlSeconds: 3600,
});

// Get full balance (auto-execute, no popup)
const balance = await sdk.getBalance(cap.id);
console.log('OCT balance:',        balance.octBalance);
console.log('Encrypted balance:',  balance.encryptedBalance);
console.log('Cipher:',             balance.cipher);
console.log('Has PVAC key:',       balance.hasPvacPubkey);
```

---

## Connection

```typescript
const connection = await sdk.connect({
  circle: 'my_dapp_v1',
  appOrigin: window.location.origin,
  appName: 'My dApp',
  appIcon: 'https://...',
});
```

### `Connection` object

| Field | Type | Description |
|-------|------|-------------|
| `walletPubKey` | `string` | Octra address |
| `evmAddress` | `string` | Ethereum address (derived from same key) |
| `network` | `'mainnet' \| 'devnet'` | Active Octra network from wallet |
| `evmNetworkId` | `string` | Active EVM network from wallet settings (e.g. `'eth-mainnet'`) |
| `epoch` | `number` | Current epoch at connect time |
| `branchId` | `string` | Branch ID (default `'main'`) |
| `circle` | `string` | Circle ID |
| `sessionId` | `string` | Session identifier |

> **Note:** `network` and `evmNetworkId` are read directly from the wallet's active settings — dApps do not need to specify or manage these.

---

## Capabilities

```typescript
// Request
const cap = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 7200,
});

// List active
const all = await sdk.listCapabilities();

// Renew (extends by 15 min)
const renewed = await sdk.renewCapability(cap.id);

// Revoke
await sdk.revokeCapability(cap.id);
```

### Scopes

| Scope | Methods | Popup required |
|-------|---------|----------------|
| `read` | `get_balance`, `get_encrypted_balance`, `stealth_scan`, `get_evm_tokens`, `get_evm_token_balance` | No (auto-execute) |
| `write` | `send_transaction`, `encrypt_balance`, `decrypt_balance`, `stealth_send`, `stealth_claim`, `send_evm_transaction`, `send_erc20_transaction` | Yes (always) |

---

## Balance

### Public + Encrypted Balance

```typescript
// Requires: get_balance, read scope — auto-execute, no popup
const balance = await sdk.getBalance(capabilityId);
```

**`BalanceResponse`**

| Field | Type | Description |
|-------|------|-------------|
| `octAddress` | `string` | Octra address |
| `octBalance` | `number` | Public OCT balance |
| `encryptedBalance` | `number` | Decrypted encrypted balance (0 if PVAC unavailable) |
| `cipher` | `string` | Raw HFHE cipher string (`"hfhe_v1|..."` or `"0"`) |
| `hasPvacPubkey` | `boolean` | Whether FHE public key is registered |
| `network` | `'mainnet' \| 'devnet'` | Active Octra network |

### Encrypted Balance Info

```typescript
// Requires: get_encrypted_balance, read scope — auto-execute, no popup
const info = await sdk.getEncryptedBalance(capabilityId);
// info.encryptedBalance, info.cipher, info.hasPvacPubkey
```

---

## Sign Message

```typescript
// Requires: connected wallet — always opens popup for approval
const result = await sdk.signMessage('Sign in to My dApp');

console.log(result.signature); // Ed25519 hex signature
console.log(result.address);   // Octra address that signed
console.log(result.message);   // original message
```

Use case: "Sign in with Octra" authentication flows.

---

## OCT Transactions

```typescript
// Requires: send_transaction, write scope — always opens popup
const result = await sdk.invoke({
  capabilityId: cap.id,
  method: 'send_transaction',
  payload: new TextEncoder().encode(JSON.stringify({
    to: 'oct...',
    amount: 0.1,       // OCT
    message: 'optional memo',
  })),
});
```

Or use the typed contract call helper:

```typescript
// Requires: send_transaction, write scope — always opens popup
const result = await sdk.sendContractCall(cap.id, {
  contract: 'oct...',
  method: 'transfer',
  params: ['oct...', 1000],
  amount: 0,           // OCT to attach
});
// result.txHash, result.contract, result.method
```

---

## Encrypted Balance Operations

> Requires PVAC server configured in wallet settings.

```typescript
// Move OCT → encrypted balance — always opens popup
const enc = await sdk.encryptBalance(cap.id, 1.0);
// enc.txHash, enc.amount

// Move encrypted balance → OCT — always opens popup
const dec = await sdk.decryptBalance(cap.id, 0.5);
// dec.txHash, dec.amount
```

---

## Stealth Transfers

> Requires PVAC server configured in wallet settings.

```typescript
// Send private transfer from encrypted balance — always opens popup
const sent = await sdk.stealthSend(cap.id, {
  to: 'oct...',
  amount: 0.5,
});
// sent.txHash, sent.amount

// Scan for claimable outputs — auto-execute, no popup
// Uses wallet's private view key internally — key never exposed to dApp
const outputs = await sdk.stealthScan(cap.id);
// outputs[].id, .amount, .sender, .epoch, .txHash

// Claim a stealth output into encrypted balance — always opens popup
const claimed = await sdk.stealthClaim(cap.id, outputs[0].id);
// claimed.txHash, claimed.amount, claimed.outputId
```

---

## EVM Operations

Network defaults to the wallet's active EVM network — no need to specify manually.

```typescript
// Send ETH transaction — always opens popup
const evmResult = await sdk.sendEvmTransaction(cap.id, {
  to: '0x...',
  amount: '0.01',      // ETH as string
  data: '0x...',       // optional calldata
  // network: 'eth-mainnet'  ← optional, defaults to wallet's active EVM network
});
// evmResult.txHash, evmResult.network

// Send ERC-20 token — always opens popup
const erc20Result = await sdk.sendErc20Transaction(cap.id, {
  tokenContract: '0x4647e1fE715c9e23959022C2416C71867F5a6E80', // wOCT
  to: '0x...',
  amount: '1000000',   // in smallest units (6 decimals for wOCT)
  decimals: 6,
  symbol: 'wOCT',
  // network: 'eth-mainnet'  ← optional, defaults to wallet's active EVM network
});
// erc20Result.txHash, erc20Result.network
```

---

## EVM Token Balances

```typescript
// Get all ERC-20 token balances for the wallet's active EVM network
// Requires: get_evm_tokens, read scope — auto-execute, no popup
const result = await sdk.getEvmTokens(cap.id);
// result.tokens[]  — array of Erc20TokenBalance
// result.networkId — active EVM network ID, e.g. 'eth-mainnet'
// result.chainId   — EVM chain ID, e.g. 1

for (const token of result.tokens) {
  console.log(`${token.symbol}: ${token.balance} (${token.address})`);
}

// Get balance for a specific ERC-20 token
// Requires: get_evm_token_balance, read scope — auto-execute, no popup
const wOCT = await sdk.getEvmTokenBalance(
  cap.id,
  '0x4647e1fE715c9e23959022C2416C71867F5a6E80',
  { decimals: 6, symbol: 'wOCT', name: 'Wrapped OCT' },
);
// wOCT.balance, wOCT.symbol, wOCT.decimals, wOCT.chainId
```

**`Erc20TokenBalance`**

| Field | Type | Description |
|-------|------|-------------|
| `address` | `string` | Contract address |
| `name` | `string` | Token name |
| `symbol` | `string` | Token symbol, e.g. `"wOCT"` |
| `decimals` | `number` | Token decimals |
| `balance` | `string` | Human-readable balance, e.g. `"1.500000"` |
| `chainId` | `number` | EVM chain ID |
| `logo` | `string?` | Optional logo data URI or URL |

**`GetEvmTokensResult`**

| Field | Type | Description |
|-------|------|-------------|
| `tokens` | `Erc20TokenBalance[]` | All token balances (common + custom) |
| `networkId` | `string` | Active EVM network ID |
| `chainId` | `number` | EVM chain ID |

---

## Fee Estimation

```typescript
const plain = await sdk.estimatePlainTx({});
console.log(plain.gasUnits, 'OU =', plain.tokenCost, 'OCT');

const encrypted = await sdk.estimateEncryptedTx({
  scheme: 'HFHE',
  data: new Uint8Array(8),
  associatedData: 'metadata',
});
```

---

## Events

```typescript
const off = sdk.on('connect', ({ connection }) => {
  console.log('Connected:', connection.walletPubKey);
  console.log('Network:', connection.network);       // 'mainnet' | 'devnet'
  console.log('EVM network:', connection.evmNetworkId);
});

sdk.on('disconnect', () => console.log('Disconnected'));
sdk.on('capabilityGranted', ({ capability }) => console.log('Granted:', capability.id));
sdk.on('capabilityRevoked', ({ capabilityId }) => console.log('Revoked:', capabilityId));
sdk.on('branchChanged', ({ branchId, epoch }) => console.log('Branch:', branchId));
sdk.on('epochChanged', ({ epoch }) => console.log('Epoch:', epoch));
sdk.on('extensionReady', () => console.log('OctWa extension detected'));

off(); // unsubscribe
```

---

## Error Handling

```typescript
import {
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  CapabilityExpiredError,
  ScopeViolationError,
  ValidationError,
} from '@octwa/sdk';

try {
  await sdk.encryptBalance(cap.id, 1.0);
} catch (error) {
  if (error instanceof UserRejectedError) return; // user cancelled — no error UI needed
  if (error instanceof CapabilityExpiredError) {
    const renewed = await sdk.renewCapability(cap.id);
    // retry with renewed.id
  }
  if (error instanceof ScopeViolationError) {
    console.error('Method not in capability scope:', error.message);
  }
  if (error instanceof ValidationError) {
    console.error('Invalid input:', error.message);
  }
}
```

---

## Full API Reference

### `OctraSDK`

| Method | Returns | Popup | Scope |
|--------|---------|-------|-------|
| `init(options?)` | `Promise<OctraSDK>` | — | — |
| `isInstalled()` | `boolean` | — | — |
| `connect(request)` | `Promise<Connection>` | Yes | — |
| `disconnect()` | `Promise<void>` | — | — |
| `getSessionState()` | `SessionState` | — | — |
| `requestCapability(req)` | `Promise<Capability>` | Yes | — |
| `renewCapability(id)` | `Promise<Capability>` | — | — |
| `revokeCapability(id)` | `Promise<void>` | — | — |
| `listCapabilities()` | `Promise<Capability[]>` | — | — |
| `invoke(req)` | `Promise<InvocationResult>` | write=Yes | any |
| `signMessage(msg)` | `Promise<SignMessageResult>` | Yes | — |
| `getBalance(capId)` | `Promise<BalanceResponse>` | No | read |
| `getEncryptedBalance(capId)` | `Promise<EncryptedBalanceInfo>` | No | read |
| `encryptBalance(capId, amount)` | `Promise<EncryptBalanceResult>` | Yes | write |
| `decryptBalance(capId, amount)` | `Promise<DecryptBalanceResult>` | Yes | write |
| `stealthSend(capId, payload)` | `Promise<StealthSendResult>` | Yes | write |
| `stealthScan(capId)` | `Promise<ClaimableOutput[]>` | No | read |
| `stealthClaim(capId, outputId)` | `Promise<StealthClaimResult>` | Yes | write |
| `sendEvmTransaction(capId, payload)` | `Promise<EvmTransactionResult>` | Yes | write |
| `sendErc20Transaction(capId, payload)` | `Promise<EvmTransactionResult>` | Yes | write |
| `sendContractCall(capId, payload)` | `Promise<ContractCallResult>` | Yes | write |
| `getEvmTokens(capId)` | `Promise<GetEvmTokensResult>` | No | read |
| `getEvmTokenBalance(capId, addr, opts?)` | `Promise<Erc20TokenBalance>` | No | read |
| `estimatePlainTx(payload)` | `Promise<GasEstimate>` | — | — |
| `estimateEncryptedTx(payload)` | `Promise<GasEstimate>` | — | — |

---

## Network

Octra has two networks:

| Value | Description |
|-------|-------------|
| `'mainnet'` | Production network |
| `'devnet'` | Development/testing network |

The active network is read from the wallet's RPC provider settings — dApps do not need to manage this. It is available on the `Connection` object after `connect()`.

---

## Security

- Private keys **never leave** the wallet extension
- All signing happens in the background service worker
- Capabilities are Ed25519-signed and cryptographically bound to `appOrigin`
- Signing mutex prevents nonce races and double-send attacks
- Domain separation (`OctraCapability:v2:`, `OctraInvocation:v2:`) prevents cross-context signature replay
- PVAC/HFHE proof generation happens inside the wallet — dApps never handle raw ciphertexts

---

## Changelog

### v1.3.3
- Add `signMessage()` — Ed25519 message signing for auth flows
- Add `getBalance()` — full balance including encrypted balance info
- Add `getEncryptedBalance()` — cipher and PVAC key status
- Add `encryptBalance()` / `decryptBalance()` — move OCT between public and encrypted balance
- Add `stealthSend()` / `stealthScan()` / `stealthClaim()` — full stealth transfer flow
- Add `sendEvmTransaction()` / `sendErc20Transaction()` — EVM operations
- Add `sendContractCall()` — typed contract interaction helper
- Add `getEvmTokens()` — fetch all ERC-20 token balances for active EVM network
- Add `getEvmTokenBalance()` — fetch balance for a specific ERC-20 token
- `Connection` now includes `evmNetworkId` — active EVM network from wallet settings
- `BalanceResponse` extended with `encryptedBalance`, `cipher`, `hasPvacPubkey`
- Network type corrected: `'testnet'` → `'devnet'` (Octra uses mainnet/devnet)
- EVM network defaults to wallet's active setting — no manual specification needed

### v1.2.0
- Initial capability-based authorization model
- `invoke()` with signing mutex and nonce management
- Ed25519 capability verification
- `estimatePlainTx()` / `estimateEncryptedTx()`

---

## License

MIT
