# OctWa — Octra Wallet

A privacy-first browser wallet for the Octra blockchain. Available as a Chrome / Edge MV3 extension and a web application from a single React + Vite codebase.

| | |
| --- | --- |
| **Extension** | `1.4.0` |
| **SDK** | [`@octwa/sdk@2.1.0`](https://www.npmjs.com/package/@octwa/sdk) |
| **Standard** | [RFC-O-1](https://github.com/chiefautism/octra-rfc/blob/main/rfc-o-1/rfc-o-1.md) |
| **License** | MIT |

---

## What is in this repository

```
main/
├── src/                     # Wallet UI — React + TypeScript + Vite
│   ├── components/          # Dashboard, Send, MultiSend, DAppRequestHandler, …
│   ├── utils/               # api.ts, evmRpc.ts, walletManager.ts, rpc.ts, …
│   ├── hooks/               # Custom React hooks (decrypt responder, sync responder, …)
│   ├── services/            # Stealth scan
│   ├── integrations/        # ONS resolver
│   ├── lib/pvac/            # PVAC WASM loader, worker, balance / stealth ops
│   │   └── wasm-runtime/    # Embedded WASM build (single-thread + multi-thread / SIMD)
│   └── types/               # Shared TypeScript definitions
├── extensionFiles/          # Browser extension assets
│   ├── manifest.json        # MV3 manifest
│   ├── background.js        # Service worker — key custody, signing, RPC bridge
│   ├── content.js           # Content script — page ↔ background message bridge
│   └── provider.js          # Injects window.octra (RFC-O-1 provider)
├── sdk/                     # @octwa/sdk — RFC-O-1 SDK published to npm
└── scripts/                 # Build helpers (copy-extension-files.mjs, analyze-bundle.mjs)
```

The wallet UI, background service worker, content script, in-page provider, and the published SDK are all maintained in this single tree so that wire formats, canonical JSON, hashing, and event names stay in lock-step.

---

## Getting started

```bash
npm ci                  # deterministic install (verifies SHA-512 hashes)
npm run dev             # start the wallet web UI in development mode
npm run build           # production build to dist/
npm run build:prod      # production build with the production Vite mode
npm run build:extension # full build + copy extension assets into dist/
npm run lint            # eslint
```

### Loading the extension into Chrome / Edge

1. Run `npm run build:extension` to populate `dist/`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin the OctWa icon to the toolbar, then unlock the wallet once so the PVAC WASM module compiles and warms its caches.

The first unlock streams the WASM build into the wallet UI's worker. Subsequent operations reuse the cached module.

---

## Architecture

```
DApp (window.octra)              ← in-page provider, RFC-O-1
    │   postMessage
    ▼
content.js                       ← isolated world; message-type whitelist
    │   chrome.runtime.sendMessage
    ▼
background.js                    ← MV3 service worker; trusted zone, key custody
    │   fetch(POST /rpc)
    ▼
Octra Node                       ← default http://46.101.86.250:8080
```

PVAC heavy cryptography — encrypt, decrypt, range proofs, stealth envelopes — runs entirely inside the wallet UI's Web Worker, against the embedded WASM build under `src/lib/pvac/wasm-runtime/`. There is no native sidecar process, no offscreen document, and no remote proof server.

### Extension layout

| File              | Role |
| ----------------- | ---- |
| `manifest.json`   | MV3, `permissions: ["storage"]`, `host_permissions: ["https://*/*", "http://*/*"]` |
| `provider.js`     | Injects `window.octra`; announces itself with the `octra:announceProvider` `CustomEvent` (an EIP-6963 analog), implements the full RFC-O-1 surface |
| `content.js`      | Bridges the page and the service worker; only forwards messages whose `type` is in `VALID_MESSAGE_TYPES` and whose `requestId` is at most 128 characters |
| `background.js`   | MV3 service worker: key custody, permission validation, RPC routing, signing mutex, nonce monotonicity |

### Security architecture

| Mechanism                   | Description |
| --------------------------- | ----------- |
| **Private-key isolation**   | Keys live only inside the `background.js` service worker. They never reach the dApp page, the content script, or the SDK. |
| **Real SHA-256**            | Both the wallet UI and the SDK hash through `crypto.subtle.digest`. No djb2 or other shortcuts in security-relevant paths. |
| **Origin binding**          | Every permission grant is cryptographically bound to its `appOrigin`; an origin can never read or sign on behalf of another. |
| **Signing mutex**           | The background serializes concurrent signing operations to prevent nonce races and double-sends. |
| **Keyed pending registry**  | Each popup-bound request is stored under a unique `pendingKey`, eliminating single-slot race conditions. |
| **Nonce monotonicity**      | The background enforces `nonce > lastNonce` on every signed transaction. |
| **Content-script whitelist** | Only message types in the `VALID_MESSAGE_TYPES` set cross the boundary, and `requestId` is capped at 128 characters. Anything else is dropped silently. |
| **Multi-wallet coexistence** | The `octra:announceProvider` `CustomEvent` mirrors EIP-6963, so multiple Octra-compatible wallets can coexist on the same page. |

---

## dApp integration

OctWa injects `window.octra` on every page following the [RFC-O-1](https://github.com/chiefautism/octra-rfc/blob/main/rfc-o-1/rfc-o-1.md) provider standard. The recommended integration path is the typed SDK:

```bash
npm install @octwa/sdk
```

### Communication flow

```
dApp → @octwa/sdk → window.octra → content.js → background.js → Octra Node RPC
```

### Provider surface

**Account, network, permissions**

```
octra_requestAccounts   octra_accounts          octra_networkId
octra_networkInfo       octra_permissions       octra_switchNetwork
```

**Wallet actions**

```
octra_signMessage              octra_sendTransaction         octra_signTransaction
octra_submitTransaction        octra_callContract            octra_sendContractTransaction
octra_getContractReceipt       octra_getEncryptedBalance     octra_encryptBalance
octra_decryptBalance           octra_sendPrivateTransfer     octra_scanStealth
octra_claimStealth
```

**EVM bridge** — the same BIP39 seed produces an EVM-compatible secp256k1 address, exposed through a parallel `evm_*` surface so dApps can interact with Ethereum-compatible chains without a separate wallet:

```
evm_getDerivedAddress          evm_getChainId               evm_getNetworkInfo
evm_getBalance                 evm_switchChain              evm_sendTransaction
evm_signMessage                evm_signTypedData            evm_getTokenBalance
evm_getTokenInfo               evm_transferToken            evm_approveToken
evm_getAllowance               evm_call                     evm_estimateGas
evm_getGasPrice
```

EVM signing happens inside the wallet popup process, never in the background service worker. Per-origin chain scoping lets parallel dApps stay on different chains without interfering with each other.

**Native RPC pass-through** — every documented Octra JSON-RPC method routes through `window.octra.request({ method, params })`, with positional array params per the Octra RPC convention.

### Events

```
connect            disconnect          networkChanged
accountsChanged    permissionsChanged  balanceChanged
transactionChanged message
evmChainChanged    evmTransactionSent
```

### Quick example

```ts
import { OctraSDK } from '@octwa/sdk';

const sdk = await OctraSDK.init();

const accounts = await sdk.connect({
  permissions: ['read_address', 'read_balance', 'send_transactions'],
});

const balance = await sdk.rpc('octra_balance', [accounts[0]]);

const tx = await sdk.sendTransaction({
  to:     'oct...',
  amount: '1000000', // raw OU; 1 OCT = 1_000_000 OU
  fee:    '1',
});

const final = await sdk.waitForConfirmation(tx.hash);
```

The full SDK reference lives in [`sdk/README.md`](sdk/README.md).

---

## Wallet feature set

### Key management
- BIP39 mnemonics (12 / 24 words); HD wallet derivation (v1 and v2 schemes).
- Mnemonic and private-key import; secure password-gated private-key export.
- Multiple wallets with instant switching, drag-and-drop reordering, and custom labels.
- Auto-lock on browser close and after configurable inactivity.

### Transactions
- Standard OCT transfers with an integrated address book.
- Multi-send with batched submission via `octra_submitBatch`.
- Bulk send from TXT and CSV imports.
- Transaction history filtered by direction (`Sent` / `Received`) and contract calls.
- Real-time pending-transaction tracking and status updates.

### Privacy mode (PVAC / HFHE)
- One-tap toggle between public and private balance modes.
- `encrypt` (public → encrypted) and `decrypt` (encrypted → public).
- Stealth-address scanning and one-tap claim of incoming private transfers.
- Stealth send under the v5 envelope (`hfhe_v1` ciphertexts, `rp_v1` range proofs, `zkzp_v2` zero proofs).

### EVM compatibility
- An EVM address is derived from the same Ed25519 master key via secp256k1 derivation.
- Multi-network (Ethereum, Polygon, BSC, Base, Sepolia).
- ERC-20 management with custom-token import; NFT viewing and transfer.
- Gas estimation and EVM transaction history.

### dApp integration
- `window.octra` provider with `octra:announceProvider` discovery.
- Per-origin permission gating; full connection-approval flow with verified site information.
- A connected-dApps manager surface, with one-tap revocation per origin.

### User interface
- Popup mode (400 × 600) and expanded mode share the same React tree.
- Light and dark themes.
- Onboarding flow for first-time users.
- An RPC-provider manager with live status indicators.
- The dApp approval surface always shows the full destination, contract address, and method name — never truncated.

---

## @octwa/sdk

The SDK is a sibling package inside this repository, published to npm as [`@octwa/sdk@2.1.0`](https://www.npmjs.com/package/@octwa/sdk).

```
sdk/
├── src/
│   ├── sdk.ts        # OctraSDK class — main entry point
│   ├── types.ts      # RFC-O-1 TypeScript types
│   ├── errors.ts     # Typed error subclasses (4001, 4100, 4200, 4900, 4901)
│   ├── utils.ts      # detectProvider, getProvider, isProviderInstalled
│   └── index.ts      # Public exports
├── README.md         # SDK reference (install, API, errors, events)
└── package.json
```

```bash
cd sdk
npm ci
npm run build         # CJS + ESM + .d.ts via tsup
```

The SDK has zero runtime dependencies. It targets modern browsers and ships dual builds plus full TypeScript declarations.

---

## Configuration

### RPC provider

The default RPC endpoint is `http://46.101.86.250:8080` (Octra Mainnet). Endpoints are managed from the wallet UI's **RPC Provider Manager**. The active URL is mirrored to `chrome.storage.local` under the `rpcProviders` key so that `background.js` can pick it up without round-tripping through the UI.

The background appends `/rpc` to whatever base URL is configured — store the host only, not the path.

### Environment variables

```env
VITE_OCTRA_RPC_URL=http://46.101.86.250:8080
VITE_INFURA_API_KEY=your_infura_key
```

These are injected at build time. `scripts/copy-extension-files.mjs` substitutes them into `background.js` while assembling the `dist/` extension bundle.

---

## Supply chain hygiene

- `package-lock.json` is committed; `npm ci` verifies SHA-512 hashes for every dependency.
- `.npmrc` enforces `save-exact=true` so semver ranges cannot drift between developers.
- Critical cryptographic dependencies are version-pinned: `tweetnacl@1.0.3`, `bip39@3.1.0`, `buffer@6.0.3`.
- Run `npm audit` before every release; consult [`SECURITY.md`](SECURITY.md) for the responsible-disclosure policy.

---

## License

MIT — see [LICENSE](LICENSE).

## Links

- **GitHub** — https://github.com/m-tq/OctWa
- **SDK on npm** — https://www.npmjs.com/package/@octwa/sdk
- **RFC-O-1** — https://github.com/chiefautism/octra-rfc/blob/main/rfc-o-1/rfc-o-1.md
- **dApp starter** — https://starter.octwa.pw
- **Security contact** — security@octwa.pw
