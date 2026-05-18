# @octwa/sdk

Official TypeScript SDK for integrating dApps with the OctWa wallet extension.

Implements [RFC-O-1 — Octra Provider JavaScript API](https://github.com/chiefautism/octra-rfc/blob/main/rfc-o-1/rfc-o-1.md). The SDK is a thin, typed wrapper around `window.octra.request()`; every public method maps one-to-one onto a standard provider method, with a small number of conveniences (`waitForConfirmation`, native RPC pass-through) layered on top.

[![npm](https://img.shields.io/npm/v/@octwa/sdk.svg)](https://www.npmjs.com/package/@octwa/sdk)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## Installation

```bash
npm install @octwa/sdk
```

The SDK ships dual builds (CJS + ESM) plus full TypeScript declarations. Node `>= 16` is required for the build toolchain; at runtime, the SDK targets modern browsers.

---

## Quick start

```ts
import { OctraSDK } from '@octwa/sdk';

// Detect the in-page provider. Times out after 3 s by default.
const sdk = await OctraSDK.init();

if (!sdk.isInstalled()) {
  throw new Error('OctWa wallet is not installed.');
}

// Ask the user to connect. Opens the wallet approval popup.
const accounts = await sdk.connect({
  permissions: ['read_address', 'read_balance', 'send_transactions'],
});

// Read state through the native RPC pass-through.
const balance = await sdk.rpc('octra_balance', [accounts[0]]);

// Build, sign, and broadcast a transaction in one approval.
const tx = await sdk.sendTransaction({
  to:     'oct...',
  amount: '1000000', // raw OU; 1 OCT = 1_000_000 OU
  fee:    '1',
});

// Poll until the transaction reaches a terminal status.
const final = await sdk.waitForConfirmation(tx.hash);
console.log(final.status); // 'confirmed' | 'rejected' | 'dropped'
```

All wallet write methods (`sendTransaction`, `signMessage`, `encryptBalance`, etc.) trigger the wallet popup; the user must explicitly approve every signed operation. Read methods (`octra_accounts`, `callContract`, native RPC pass-through) never open a popup.

---

## API reference

### Provider lifecycle

```ts
// Detect window.octra (uses an EIP-6963-style announce/request handshake).
const sdk = await OctraSDK.init({ timeout: 3_000 });

sdk.isInstalled();   // true once the provider has been detected
sdk.isConnected();   // true once accounts have been authorized
sdk.getProvider();   // raw OctraProvider | null — for advanced usage
sdk.getAccounts();   // string[] — locally cached, refreshed on accountsChanged
```

### Accounts, network, and permissions

```ts
await sdk.connect({ permissions, networkId? });   // octra_requestAccounts
await sdk.disconnect();                           // octra_disconnect
await sdk.fetchAccounts();                        // octra_accounts
await sdk.getNetworkId();                         // octra_networkId
await sdk.getNetworkInfo();                       // octra_networkInfo
await sdk.getPermissions();                       // octra_permissions
await sdk.switchNetwork('octra:devnet');          // octra_switchNetwork
```

`disconnect()` revokes the dApp's session at the wallet. The next `connect()` call always opens a fresh approval popup, so the user can pick a different wallet if they want.

The full permission catalogue:

```
read_address              read_balance              read_public_key
sign_messages             send_transactions         contract_calls
view_encrypted_balance    encrypt_balance           decrypt_balance
private_transfers         stealth_scan              stealth_claim
```

Always request the smallest set of permissions your dApp actually needs. The wallet enforces every grant per origin, and unused grants enlarge your attack surface for nothing.

### Transactions

```ts
await sdk.signMessage('hello octra');                       // octra_signMessage
await sdk.sendTransaction({ to, amount, fee?, message? });  // octra_sendTransaction
await sdk.signTransaction({ to, amount, fee, nonce?, message? }); // octra_signTransaction
await sdk.submitTransaction(signedTx);                      // octra_submitTransaction
await sdk.waitForConfirmation(hash, {                       // polls octra_transaction
  timeoutMs?: 120_000,
  pollIntervalMs?: 3_000,
  onTick?: (result) => { /* ... */ },
});
```

`signTransaction` returns a fully canonicalized, Ed25519-signed payload that you can hold and submit later via `submitTransaction`. This is the recommended pattern when a dApp needs to inspect or store the signed transaction before broadcasting.

The `OctraTransactionResult` envelope returned by `sendTransaction` and `submitTransaction` carries everything a UI typically needs:

```ts
interface OctraTransactionResult {
  hash:         string;
  accepted:     boolean;
  status:       'pending' | 'confirmed' | 'rejected' | 'dropped';
  nonce?:       number;
  ouCost?:      string;     // total gas in raw OU
  explorerUrl?: string;     // pre-built explorer link
}
```

### Contracts

```ts
// Read-only call — no popup, no fee, no transaction.
const result = await sdk.callContract({
  address: 'oct...',
  method:  'get_owner',
  params:  [],
});

// State-changing call — opens the wallet popup.
const tx = await sdk.sendContractTransaction({
  address: 'oct...',
  method:  'transfer',
  params:  ['oct...', 1_000_000],
  amount:  '0',
});

const receipt = await sdk.getContractReceipt(tx.hash);
```

A reverted contract call still confirms on-chain with `status === 'confirmed'`. Always inspect the receipt to verify success — `octra_transaction` only reports tx-level acceptance, not contract execution outcome.

### Privacy

```ts
await sdk.getEncryptedBalance();                         // returns cipher + decrypted amount
await sdk.encryptBalance('1000000');                     // public  → encrypted
await sdk.decryptBalance('1000000');                     // encrypted → public
await sdk.sendPrivateTransfer({ to, amount, fee? });     // stealth send (v5 envelope)
await sdk.scanStealth(0);                                // scan from given epoch
await sdk.claimStealth(outputId);                        // claim a scanned output
```

All HFHE primitives — Paillier-style additive ciphertexts, Pedersen commitments, zero/range proofs, and the v5 stealth envelope — run inside the wallet's PVAC WASM worker. The dApp never touches private key material.

### Native RPC pass-through

Every documented Octra JSON-RPC method is reachable through `sdk.rpc(method, params)`. Parameters are positional arrays per the Octra RPC convention.

```ts
await sdk.rpc('epoch_current');
await sdk.rpc('octra_balance', ['oct...']);
await sdk.rpc('octra_recommendedFee', ['standard']);
await sdk.rpc('octra_transaction', [hash]);
await sdk.rpc('octra_contractAbi', [contractAddr]);
```

This is the escape hatch for any RPC method that has not yet been promoted into the typed SDK surface.

### EVM bridge (`sdk.evm.*`)

OctWa derives a secp256k1 (EVM) address from the same BIP39 seed as the Octra wallet. The EVM bridge gives dApps typed access to Ethereum-compatible operations through the same `window.octra` provider — no MetaMask or separate wallet required.

```ts
// Same session, no re-connect
const evmAddr = await sdk.evm.getDerivedAddress();  // 0x...
const bal     = await sdk.evm.getBalance();         // { balance, balanceWei, chainId }
```

#### Network

```ts
await sdk.evm.getChainId();                    // 1 (Ethereum mainnet)
await sdk.evm.getNetworkInfo();                // { id, name, chainId, symbol, explorerUrl }
await sdk.evm.switchChain(137);                // switch to Polygon — opens popup
```

#### Transactions

```ts
// Native ETH transfer — opens popup
await sdk.evm.sendTransaction({ to: '0x...', value: '0.1' });

// Contract interaction — attach calldata
await sdk.evm.sendTransaction({ to: '0x...', data: '0xa9059cbb...' });

// Sign a message (personal_sign)
await sdk.evm.signMessage('hello evm');

// EIP-712 typed data
await sdk.evm.signTypedData({ domain, types, value });
```

#### ERC-20 tokens

```ts
await sdk.evm.getTokenBalance('0xA0b8...', '0xOwner...');
await sdk.evm.getTokenInfo('0xA0b8...');  // { name, symbol, decimals }

// Transfer tokens — opens popup
await sdk.evm.transferToken({ token: '0xA0b8...', to: '0x...', amount: '1000000' });

// Approve spender (e.g. bridge contract) — opens popup
await sdk.evm.approveToken({ token: '0xA0b8...', spender: '0xBridge...' });

// Check existing allowance
await sdk.evm.getAllowance({ token: '0xA0b8...', owner: '0x...', spender: '0xBridge...' });
```

#### Low-level reads

```ts
await sdk.evm.call({ to: '0x...', data: '0x...' });  // eth_call
await sdk.evm.estimateGas({ to: '0x...', value: '0.01' });
await sdk.evm.getGasPrice();  // { gasPriceWei, gasPriceGwei }
```

#### EVM events

```ts
sdk.on('evmChainChanged', (chainId: number) => { ... });
sdk.on('evmTransactionSent', ({ hash, chainId }) => { ... });
```

### Events

```ts
sdk.on('connect',            ({ networkId, networkInfo }) => { /* ... */ });
sdk.on('disconnect',         (error)                       => { /* ... */ });
sdk.on('networkChanged',     (networkInfo)                 => { /* ... */ });
sdk.on('accountsChanged',    (accounts)                    => { /* ... */ });
sdk.on('permissionsChanged', (permissions)                 => { /* ... */ });
sdk.on('balanceChanged',     ({ address, public, encrypted }) => { /* ... */ });
sdk.on('transactionChanged', ({ hash, status })            => { /* ... */ });
sdk.on('message',            (message)                     => { /* ... */ });

sdk.removeListener('accountsChanged', listener);
```

`accountsChanged` is fired with an empty array when the user revokes access or locks the wallet — treat it as a soft disconnect and clear any cached account data.

---

## Error handling

Every SDK method throws a typed subclass of `OctraProviderError`. The base class carries the RFC-O-1 standard code; subclasses let you discriminate without inspecting numeric codes.

```ts
import {
  isUserRejection,
  OctraProviderError,
  UserRejectedError,
  UnauthorizedError,
  UnsupportedMethodError,
  DisconnectedError,
  NetworkUnavailableError,
} from '@octwa/sdk';

try {
  await sdk.sendTransaction({ to, amount });
} catch (error) {
  if (isUserRejection(error)) {
    // user closed the popup or pressed reject
  } else if (error instanceof UnauthorizedError) {
    // missing permission — request it via connect()
  } else if (error instanceof OctraProviderError) {
    console.log(error.code, error.message, error.data?.reason);
  }
}
```

| Code | Class                     | Meaning                                  |
| ---: | ------------------------- | ---------------------------------------- |
| 4001 | `UserRejectedError`       | The user rejected the request            |
| 4100 | `UnauthorizedError`       | Method or account is not authorized      |
| 4200 | `UnsupportedMethodError`  | The provider does not implement the method |
| 4900 | `DisconnectedError`       | The provider is disconnected from all networks |
| 4901 | `NetworkUnavailableError` | The requested network is unavailable     |

The optional `error.data.reason` carries machine-readable detail for common cases such as `insufficient_balance`, `nonce_conflict`, or `permission_denied`.

---

## Working with `window.octra` directly

For framework integrations or migration scenarios, the raw provider remains accessible:

```ts
const accounts = await window.octra.request({
  method: 'octra_requestAccounts',
  params: [{ permissions: ['read_address', 'send_transactions'] }],
});

const balance = await window.octra.request({
  method: 'octra_balance',
  params: [accounts[0]],
});
```

The SDK provides better ergonomics, typed errors, and convenience helpers, but both surfaces interoperate cleanly — anything you do through `window.octra.request` is reflected in the SDK's cached state on the next event.

---

## Browser support

The SDK runs anywhere `window.octra` is injected, which today means the OctWa Chrome / Edge extension. The wallet is built on Manifest V3 with WebAssembly threads (`SharedArrayBuffer`) and SIMD enabled in the wallet UI; the dApp side has no such requirements — it only speaks JSON-RPC over `postMessage`.

---

## Specification

This SDK conforms to [RFC-O-1: Octra Provider JavaScript API](https://github.com/chiefautism/octra-rfc/blob/main/rfc-o-1/rfc-o-1.md). Every method, event, and error code matches the standard.

## License

[MIT](./LICENSE)
