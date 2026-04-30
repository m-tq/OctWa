# OctWa — Octra Wallet

A secure, private-first browser wallet for the Octra blockchain. Available as a Chrome/Edge extension and web application.

**Version:** 1.3.2 · **License:** MIT · **Status:** Production Ready

---

## Project Structure

```
main/
├── src/                     # Wallet UI (React + TypeScript + Vite)
│   ├── components/          # UI components (Dashboard, Send, MultiSend, etc.)
│   ├── utils/               # api.ts, evmRpc.ts, walletManager.ts, rpc.ts
│   ├── types/               # TypeScript type definitions
│   ├── stores/              # Job store, event bus
│   ├── services/            # PVAC server, stealth scan
│   └── permissions/         # Capability permission manager
├── extensionFiles/          # Browser extension files
│   ├── background.js        # Service worker — key custody, signing, RPC
│   ├── content.js           # Content script — message bridge + whitelist
│   ├── provider.js          # window.octra provider injection
│   ├── core.js              # Canonical serialization + real SHA-256
│   └── manifest.json        # MV3 manifest
├── packages/sdk/            # @octwa/sdk v1.2.0 — dApp integration SDK
└── scripts/                 # Build scripts (copy-extension-files.mjs)
```

---

## Quick Start

```bash
npm ci                    # install (uses package-lock.json, verifies hashes)
npm run dev               # development server
npm run build:prod        # production build
npm run build:extension   # build + copy extension files to dist/
```

### Load Extension

1. `npm run build:extension`
2. Open `chrome://extensions` → Enable Developer mode
3. Load unpacked → select `dist/` folder

---

## Extension Architecture

```
DApp (window.octra)
    │  postMessage
    ▼
content.js          ← isolated world, message bridge
    │  chrome.runtime.sendMessage
    ▼
background.js       ← service worker, trusted zone
    │  fetch
    ▼
Octra Node RPC      ← http://46.101.86.250:8080/rpc (default)
```

### Extension Files

| File | Role |
|------|------|
| `manifest.json` | MV3, `host_permissions: ["https://*/*","http://*/*"]` |
| `provider.js` | Injects `window.octra`, announces via `octra:announceProvider` (EIP-6963 analog) |
| `content.js` | Bridges page ↔ background, validates `VALID_MESSAGE_TYPES` whitelist + requestId length |
| `background.js` | Service worker — key custody, capability validation, RPC calls, signing mutex |
| `core.js` | Canonical serialization + real SHA-256 via `crypto.subtle` (shared with SDK) |

### Security Architecture

| Mechanism | Description |
|-----------|-------------|
| **Private key isolation** | Keys live only in `background.js` service worker — never in SDK or dApp |
| **Real SHA-256** | `crypto.subtle.digest` in both `core.js` and SDK — no djb2 for security ops |
| **Domain separation** | `OctraCapability:v2:` / `OctraInvocation:v2:` prefixes prevent cross-context replay |
| **Signing mutex** | Serializes concurrent signing operations — prevents nonce races and double-send |
| **Keyed pending registry** | Each popup request keyed by unique `pendingKey` — no single-slot race conditions |
| **Origin binding** | Capabilities cryptographically bound to `appOrigin` |
| **Nonce monotonicity** | Background enforces nonce > lastNonce on every invocation |
| **Content script whitelist** | `VALID_MESSAGE_TYPES` Set + requestId ≤ 128 chars — drops unknown messages |
| **EIP-6963 analog** | `octra:announceProvider` CustomEvent — multiple wallets can coexist |

---

## dApp Integration (window.octra)

The extension injects `window.octra` into every page. DApps communicate via the `@octwa/sdk`:

```bash
npm install @octwa/sdk@1.2.0
```

### Communication Flow

```
DApp → @octwa/sdk → window.octra → content.js → background.js → Octra Node RPC
DApp ← @octwa/sdk ← window.octra ← content.js ← background.js ← Octra Node RPC
```

### Supported invoke() Methods

| Method | Scope | Execution | Description |
|--------|-------|-----------|-------------|
| `get_balance` | `read` | Auto (no popup) | Fetch OCT balance → `{ octAddress, octBalance, network }` |
| `send_transaction` | `write` | Popup approval | Send OCT transfer or contract call (`op_type: standard \| call`) |
| `send_evm_transaction` | `write` | Popup approval | Send ETH/EVM transaction, wallet signs with derived secp256k1 key |
| `send_erc20_transaction` | `write` | Popup approval | Send ERC-20 token transfer |

### Contract Calls via send_transaction

For bridge/contract interactions, pass `op_type` and `encrypted_data` in the payload:

```typescript
await sdk.invoke({
  capabilityId: cap.id,
  method: 'send_transaction',
  payload: new TextEncoder().encode(JSON.stringify({
    to:             'oct5MrNfji...',  // contract address
    amount:         1.5,
    message:        '["0xETH_ADDRESS"]',  // contract params
    op_type:        'call',
    encrypted_data: 'lock_to_eth',        // contract method name
  })),
});
```

`DAppRequestHandler` reads `op_type` and `encrypted_data` from the payload and passes them to `createTransaction()` — the canonical JSON is built correctly for contract calls.

### Gas Estimation

Fee estimates are fetched live from the node via `octra_recommendedFee`:

```typescript
const standard  = await sdk.estimatePlainTx({});    // op_type: 'standard'
const encrypted = await sdk.estimateEncryptedTx({}); // op_type: 'encrypt'
// Formula: OU ÷ 1,000,000 = fee in OCT
```

---

## Wallet Features

### Key Management
- BIP39 mnemonic (12/24 words), HD wallet v1/v2
- Import via mnemonic or private key
- Multiple wallets with instant switching
- Drag & drop reordering, custom labels
- Secure private key export (password re-verification)
- Auto-lock on browser close / inactivity

### Transactions
- Standard OCT send with address book
- Multi-send (multiple recipients, batch submission via `octra_submitBatch`)
- Bulk send via TXT/CSV file import
- Transaction history (All / Sent / Received / Contract)
- Real-time status tracking, pending monitoring

### Privacy Mode (PVAC / HFHE)
- Public ↔ Private mode toggle
- Encrypt balance (public OCT → private)
- Decrypt balance (private OCT → public)
- Private transfers using Fully Homomorphic Encryption
- Claim incoming private transfers
- Stealth address scanning

### EVM Compatibility
- EVM address derived from same Ed25519 key (secp256k1 derivation)
- Multi-network: Ethereum, Polygon, BSC, Base, Sepolia
- ERC-20 token management with custom token import
- NFT viewing and transfers
- Gas price estimation
- EVM transaction history

### dApp Integration
- `window.octra` provider with `octra:announceProvider` discovery
- Capability-based authorization (v2) with TTL
- Connection approval flow with site info display
- Keyed pending request registry (no race conditions)
- Connected dApps manager with revocation

### User Interface
- Popup mode (400×600) and Expanded mode
- Dark/Light theme
- Onboarding flow for new users
- RPC provider manager with live status indicator
- Animated 3D background (Three.js)

---

## @octwa/sdk

The SDK package lives in `packages/sdk/` and is published to npm.

```
packages/sdk/
├── src/
│   ├── sdk.ts              # OctraSDK class — main entry point
│   ├── types.ts            # All TypeScript types
│   ├── canonical.ts        # Deterministic serialization + real SHA-256
│   ├── crypto.ts           # Ed25519 verify, capability validation
│   ├── capability-service.ts
│   ├── nonce-manager.ts
│   ├── gas-service.ts      # Fallback fee estimates
│   ├── response-utils.ts   # decodeResponseData, decodeBalanceResponse
│   ├── errors.ts           # 15 typed error classes
│   └── index.ts            # Public exports
└── tests/
    ├── sdk.test.ts         # 25 tests
    └── crypto.test.ts      # 22 tests
```

### Build & Test

```bash
cd packages/sdk
npm ci
npm run build   # CJS + ESM + TypeScript declarations
npm test        # 47 tests via vitest
```

### Key Changes in v1.2.0

- `sha256Bytes` / `sha256String` — real SHA-256 via `crypto.subtle` (was djb2)
- `hashCapabilityWithDomain` / `hashInvocationWithDomain` — now async
- `Connection.epoch` and `branchId` — now required (not optional)
- `BalanceResponse` — OCT-only: `{ octAddress, octBalance, network }`
- `OctraProvider.disconnect()` — returns `Promise<{disconnected: boolean}>`
- `detectProvider` — listens for `octra:announceProvider` (EIP-6963 analog)
- Removed: `invokeCompute`, `estimateComputeCost`, `signMessage` from SDK
- Removed: `ComputeRequest/Profile/Result`, `EVMNetworkId` types

---

## Security

See [SECURITY.md](SECURITY.md) for supply chain attack mitigation, dependency audit, and responsible disclosure.

### Supply Chain

- `package-lock.json` committed — `npm ci` verifies SHA-512 hashes
- `.npmrc`: `save-exact=true` — no version range drift
- Critical crypto deps pinned: `tweetnacl@1.0.3`, `bip39@3.1.0`, `buffer@6.0.3`
- Run `npm audit` to check for known vulnerabilities

---

## Configuration

### RPC Provider

Default: `http://46.101.86.250:8080` (Octra Mainnet)

Manage via UI (RPC Provider Manager). The active URL is synced to `chrome.storage.local` key `rpcProviders` so `background.js` can access it. The background appends `/rpc` automatically — store the base URL only.

### Environment Variables

```env
VITE_OCTRA_RPC_URL=http://46.101.86.250:8080
VITE_INFURA_API_KEY=your_infura_key
```

Injected at build time into `background.js` via `scripts/copy-extension-files.mjs`.

---

## License

MIT — see LICENSE file.

## Links

- **GitHub**: https://github.com/m-tq/OctWa
- **SDK npm**: https://www.npmjs.com/package/@octwa/sdk
- **dApp Starter**: https://starter.octwa.pw
- **Security**: security@octra.network
