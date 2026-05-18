# OctWa Extension Files — RFC-O-1 Compliant

Chrome MV3 extension files for OctWa (Octra Wallet).

## Architecture

```
provider.js     Injected into page context as window.octra.
                Implements RFC-O-1: request(), on(), removeListener().
                Single entry point for all dApp interactions.

content.js      Content script bridge (page ↔ background).
                Maintains a VALID_MESSAGE_TYPES whitelist and a 128-char
                cap on requestId. Relays PROVIDER_REQUEST messages and
                forwards PROVIDER_EVENT push events back to the page.

background.js   Service worker. Routes RFC-O-1 methods, manages keys,
                signing, permissions, RPC calls. Opens the wallet popup
                for any user-approval method.

manifest.json   Chrome MV3 manifest. Declares
                permissions: ["storage"] and host_permissions for HTTPS
                and HTTP origins so dApps on either scheme can connect.
```

The popup UI (`popup.html`) is built from the React app under `main/src/` and copied into `dist/` by `scripts/copy-extension-files.mjs` together with the files in this directory.

## Provider API (RFC-O-1)

```js
// Single request interface
const result = await window.octra.request({
  method: 'octra_requestAccounts',
  params: [{ permissions: ['read_address', 'send_transactions'] }],
});

// Events
window.octra.on('accountsChanged', (accounts) => { /* … */ });
window.octra.on('networkChanged', (info) => { /* … */ });
window.octra.removeListener('accountsChanged', handler);

// Properties
window.octra.isOctra     // true
window.octra.providerId  // 'octwa'
window.octra.version     // injected at build time from manifest.json
```

## Method Categories

### Provider-native (wallet-mediated)

```
octra_requestAccounts             octra_accounts
octra_networkId                   octra_networkInfo
octra_permissions                 octra_switchNetwork
octra_signMessage                 octra_sendTransaction
octra_signTransaction             octra_submitTransaction
octra_callContract                octra_sendContractTransaction
octra_getContractReceipt
octra_getEncryptedBalance         octra_encryptBalance
octra_decryptBalance              octra_sendPrivateTransfer
octra_scanStealth                 octra_claimStealth
```

### EVM bridge (same key, secp256k1 derivation)

```
evm_getDerivedAddress             evm_getChainId
evm_getNetworkInfo                evm_getBalance
evm_switchChain                   evm_sendTransaction
evm_signMessage                   evm_signTypedData
evm_getTokenBalance               evm_getTokenInfo
evm_transferToken                 evm_approveToken
evm_getAllowance                  evm_call
evm_estimateGas                   evm_getGasPrice
```

EVM signing happens inside the wallet popup (never in the background service worker), so private key material is isolated to the popup process. EVM chain state is per-origin scoped.

### RPC pass-through (read-only, no confirmation)

Every documented Octra JSON-RPC read method is forwarded directly to the active node:

```
octra_balance        octra_account        octra_nonce
octra_transaction    epoch_current        contract_call
octra_recommendedFee octra_contractAbi    octra_stealthOutputs
…
```

### Sensitive write (confirmation required)

`octra_submit`, `octra_submitBatch`, `octra_registerPublicKey`, `octra_registerPvacPubkey`, and a few other low-level writes route through a generic confirmation popup so users can review the raw payload before broadcasting.

## Error codes (RFC-O-1)

| Code | Meaning                                    |
| ---: | ------------------------------------------ |
| 4001 | User rejected the request                  |
| 4100 | Unauthorized — missing permission          |
| 4200 | Unsupported method                         |
| 4900 | Disconnected from all networks             |
| 4901 | Network unavailable                        |

## Events

| Event                | Payload                                          |
| -------------------- | ------------------------------------------------ |
| `connect`            | `{ networkId, networkInfo }`                     |
| `disconnect`         | `OctraProviderError`                             |
| `networkChanged`     | `OctraNetworkInfo`                               |
| `accountsChanged`    | `string[]`                                       |
| `permissionsChanged` | `OctraPermission[]`                              |
| `balanceChanged`     | `{ address, public?, encrypted? }`               |
| `transactionChanged` | `{ hash, status, receipt? }`                     |
| `evmChainChanged`    | `chainId: number`                                |
| `evmTransactionSent` | `{ hash, chainId }`                              |

## Build

These files are copied verbatim into `dist/` by `npm run build:extension`. The build script also injects:

- the manifest version string into `provider.js`
- the default Octra RPC URL, Infura key, and Etherscan key into `background.js` from `main/.env`

There is no separate npm package or installer for the extension files. They are plain JavaScript with no module system — `background.js` runs as a Chrome MV3 service worker without bundler help.
