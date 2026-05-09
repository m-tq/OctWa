# OctWa — Octra Wallet

A secure, private-first browser wallet for the Octra blockchain. Available as a Chrome/Edge extension and web application.

**Extension version:** 1.3.7 · **SDK:** [`@octwa/sdk@1.6.0`](https://www.npmjs.com/package/@octwa/sdk) · **License:** MIT · **Status:** Production Ready

---

## Project Structure

```
main/
├── src/                     # Wallet UI (React + TypeScript + Vite)
│   ├── components/          # Dashboard, Send, MultiSend, DAppRequestHandler, ...
│   ├── utils/               # api.ts, evmRpc.ts, walletManager.ts, rpc.ts, ...
│   ├── types/               # TypeScript type definitions
│   ├── stores/              # Job store, event bus
│   ├── services/            # PVAC server, stealth scan
│   ├── lib/pvac/            # PVAC WASM loader + worker + balance/stealth ops
│   ├── permissions/         # Capability permission manager
│   └── offscreen.ts         # MV3 offscreen PVAC runner (silent, no popup)
├── extensionFiles/          # Browser extension files
│   ├── background.js        # Service worker — key custody, signing, RPC, offscreen delegate
│   ├── content.js           # Content script — message bridge + whitelist
│   ├── provider.js          # window.octra provider injection
│   ├── core.js              # Canonical serialization + real SHA-256
│   └── manifest.json        # MV3 manifest — permissions: storage, offscreen
├── offscreen.html           # MV3 offscreen document host (hosts src/offscreen.ts)
├── sdk/                     # @octwa/sdk v1.6.0 — dApp integration SDK (published to npm)
├── pvac_server/             # Native C++ PVAC sidecar + WASM build
└── scripts/                 # Build scripts (copy-extension-files.mjs)
```

---

## Quick Start

```bash
npm ci                    # install (uses package-lock.json, verifies hashes)
npm run dev               # development server (wallet web UI)
npm run build:prod        # production build
npm run build:extension   # build + copy extension files into dist/
```

### Load Extension

1. `npm run build:extension`
2. Open `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder
4. Pin the OctWa icon to the toolbar, unlock the wallet once to warm the PVAC cache

---

## Extension Architecture

```
DApp (window.octra)
    │  postMessage
    ▼
content.js          ← isolated world, message bridge + whitelist
    │  chrome.runtime.sendMessage
    ▼
background.js       ← MV3 service worker, trusted zone, key custody
    │                  └─ delegates silent PVAC ops to the offscreen document
    │
    ├─ fetch ────────▶ Octra Node RPC
    │                  (default http://46.101.86.250:8080)
    │
    └─ chrome.offscreen.createDocument('offscreen.html')
        ▼
       offscreen.html ← invisible page hosting the PVAC WASM worker
        │
        └─ pvac-worker (Web Worker) — decrypt_cipher / encrypt_value / scan_outputs / …
```

### Extension Files

| File | Role |
|------|------|
| `manifest.json` | MV3, `permissions: ["storage", "offscreen"]`, `host_permissions: ["https://*/*","http://*/*"]` |
| `provider.js` | Injects `window.octra`, announces via `octra:announceProvider` (EIP-6963 analog) |
| `content.js` | Bridges page ↔ background, validates `VALID_MESSAGE_TYPES` whitelist + requestId length |
| `background.js` | Service worker — key custody, capability validation, RPC calls, signing mutex, offscreen delegation |
| `offscreen.html` + `src/offscreen.ts` | Invisible PVAC runner — runs silent crypto (decrypt_cipher, encrypt_value, scan_outputs, get_crypto_identity, compute_shared_secret) without ever flashing a popup |
| `core.js` | Canonical serialization + real SHA-256 via `crypto.subtle` (shared with SDK) |

### Security Architecture

| Mechanism | Description |
|-----------|-------------|
| **Private key isolation** | Keys live only in `background.js` service worker + the offscreen runner — never in SDK or dApp context |
| **Offscreen delegation** | Silent PVAC ops run in an invisible `chrome.offscreen` document — dApps never trigger a blank popup for reads |
| **Real SHA-256** | `crypto.subtle.digest` in both `core.js` and SDK — no djb2 for security ops |
| **Domain separation** | `OctraCapability:v2:` / `OctraInvocation:v2:` prefixes prevent cross-context replay |
| **Signing mutex** | Serializes concurrent signing operations — prevents nonce races and double-send |
| **Keyed pending registry** | Each popup/offscreen request keyed by unique `pendingKey` — no single-slot race conditions |
| **Origin binding** | Capabilities cryptographically bound to `appOrigin` |
| **Nonce monotonicity** | Background enforces `nonce > lastNonce` on every invocation |
| **Content script whitelist** | `VALID_MESSAGE_TYPES` Set + requestId ≤ 128 chars — drops unknown messages |
| **EIP-6963 analog** | `octra:announceProvider` CustomEvent — multiple wallets can coexist |

---

## dApp Integration

The extension injects `window.octra` into every page. DApps communicate via [`@octwa/sdk`](https://www.npmjs.com/package/@octwa/sdk):

```bash
npm install @octwa/sdk@1.6.0
```

### Communication Flow

```
DApp → @octwa/sdk → window.octra → content.js → background.js → Octra Node RPC
DApp ← @octwa/sdk ← window.octra ← content.js ← background.js ← Octra Node RPC
                                                    │
                                                    └─ delegates silent PVAC → offscreen
```

### Method Surface (v1.6.0)

**Connection & capabilities** — `connect`, `disconnect`, `requestCapability`, `renewCapability`, `revokeCapability`, `listCapabilities`, `getSessionState`

**Public reads** (auto-execute, no popup) — `getBalance`, `getEncryptedBalance`, `getEvmTokens`, `getEvmTokenBalance`, `getTransaction`, `waitForConfirmation`, `getEpoch`, `getRecommendedFee`, `getContractStorage`, `callContractView`, `getViewPubkey`

**Silent PVAC reads** (offscreen, no popup) — `getCryptoIdentity`, `computeSharedSecret`, `decryptCipher`, `encryptValue`, `scanOutputs`, `stealthScan`, `stealthScanFull`, `getDecryptedBalance`

**Writes** (popup approval) — `invoke`, `signMessage`, `signForZK`, `sendEvmTransaction`, `sendErc20Transaction`, `sendContractCall`, `encryptBalance`, `decryptBalance`, `stealthSend`, `stealthClaim`, `keySwitch`

### Contract Calls

```typescript
const result = await sdk.sendContractCall(cap.id, {
  contract: 'oct5MrNfji...',
  method:   'lock_to_eth',
  params:   ['0xETH_ADDRESS'],
  amount:   1.5,     // OCT to attach (0 for pure calls)
  ou:       1000,    // optional fee override
});
```

SDK v1.6.0 forwards the optional `ou` override into the wire transaction so contract calls use the correct fee instead of the default 10 000 OU transfer rate.

### Gas Estimation

```typescript
const standard  = await sdk.estimatePlainTx({});
const encrypted = await sdk.estimateEncryptedTx({ scheme: 'HFHE', data: new Uint8Array(8) });
// 1 OU = 0.000001 OCT
```

---

## Wallet Features

### Key Management
- BIP39 mnemonic (12/24 words), HD wallet v1/v2
- Import via mnemonic or private key
- Multiple wallets with instant switching, drag & drop reordering, custom labels
- Secure private key export (password re-verification)
- Auto-lock on browser close / inactivity

### Transactions
- Standard OCT send with address book
- Multi-send (multiple recipients, batch submission via `octra_submitBatch`)
- Bulk send via TXT/CSV file import
- Transaction history (All / Sent / Received / Contract)
- Real-time status tracking and pending monitoring

### Privacy Mode (PVAC / HFHE)
- Public ↔ Private mode toggle
- Encrypt balance (public OCT → private)
- Decrypt balance (private OCT → public)
- Private transfers using Fully Homomorphic Encryption
- Claim incoming private transfers
- Stealth address scanning (background-scheduled + dApp-triggered via `scanOutputs`)

### EVM Compatibility
- EVM address derived from the same Ed25519 key (secp256k1 derivation)
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
- **Silent offscreen PVAC runner** — dApp reads no longer flash blank popups

### User Interface
- Popup mode (400×600) and Expanded mode
- Dark / light theme
- Onboarding flow for new users
- RPC provider manager with live status indicator
- Animated 3D background (Three.js)
- DApp approval screens show full destination / to address (no truncation)

---

## @octwa/sdk

The SDK package lives in `sdk/` and is published to npm: [`@octwa/sdk@1.6.0`](https://www.npmjs.com/package/@octwa/sdk).

```
sdk/
├── src/
│   ├── sdk.ts              # OctraSDK class — main entry point
│   ├── types.ts            # All TypeScript types
│   ├── canonical.ts        # Deterministic serialization + real SHA-256
│   ├── crypto.ts           # Ed25519 verify, capability validation
│   ├── capability-manager.ts
│   ├── capability-service.ts
│   ├── nonce-manager.ts
│   ├── session-manager.ts
│   ├── gas-service.ts      # Fallback fee estimates
│   ├── intents.ts          # Intent payload builders
│   ├── response-utils.ts   # decodeResponseData, decodeBalanceResponse
│   ├── errors.ts           # Typed error classes
│   └── index.ts            # Public exports
├── tests/
│   ├── sdk.test.ts         # Unit
│   ├── parity.test.ts      # SDK ↔ core.js / background.js parity
│   ├── reads.test.ts       # Auto-execute / read flows
│   ├── wire.test.ts        # Wire format (op_type, encrypted_data, message)
│   └── harness/            # Integration harness (browser smoke + cli)
├── AUDIT.md                # Security audit notes
└── README.md               # SDK-specific docs (install, API, changelog)
```

### Build & Test

```bash
cd sdk
npm ci
npm run build   # CJS + ESM + TypeScript declarations
npm test        # Unit + parity + wire + reads
```

### Highlights of v1.6.0

- `sendContractCall()` accepts optional `ou` and forwards it to the wallet
- New crypto-identity surface: `getCryptoIdentity`, `computeSharedSecret`, `decryptCipher`, `encryptValue`, `scanOutputs`
- New chain-read helpers without popups: `getTransaction`, `waitForConfirmation`, `getEpoch`, `getRecommendedFee`, `getContractStorage`, `callContractView`, `getViewPubkey`
- `getDecryptedBalance` convenience — `getBalance` + `decryptCipher` in one call
- `stealthScanFull` — wraps raw output fetch + `scanOutputs`
- `keySwitch` — rotate PVAC pubkey on chain
- `signForZK` — Ed25519 signing for Groth16 / ZK public inputs
- AUDIT.md + harness (browser + CLI) added under `sdk/tests/harness/`

See [sdk/README.md](sdk/README.md) for the full changelog.

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
- **SDK on npm**: https://www.npmjs.com/package/@octwa/sdk
- **dApp Starter**: https://starter.octwa.pw
- **Security**: security@octwa.pw
