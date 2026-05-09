# @octwa/sdk

[![npm](https://img.shields.io/npm/v/@octwa/sdk.svg?label=npm)](https://www.npmjs.com/package/@octwa/sdk)

TypeScript SDK for integrating dApps with the **OctWa Wallet** browser extension.

**Current version: [`1.6.0`](https://www.npmjs.com/package/@octwa/sdk)**

All signing, key operations, and proof generation happen inside the wallet extension — private keys never leave the extension context.

---

## Installation

```bash
npm install @octwa/sdk@1.6.0
```

---

## Quick Start

```typescript
import { OctraSDK } from '@octwa/sdk';

const sdk = await OctraSDK.init({ timeout: 3000 });

if (!sdk.isInstalled()) {
  console.log('Please install OctWa Wallet extension');
  return;
}

const connection = await sdk.connect({
  circle: 'my_dapp_v1',
  appOrigin: window.location.origin,
  appName: 'My dApp',
});

console.log('Octra address:',   connection.walletPubKey);
console.log('EVM address:',     connection.evmAddress);
console.log('Network:',         connection.network);       // 'mainnet' | 'devnet'
console.log('EVM network:',     connection.evmNetworkId);  // e.g. 'eth-mainnet'
console.log('View pubkey:',     connection.viewPublicKey); // Curve25519, safe to share
console.log('PVAC registered:', connection.pvacRegistered);

const cap = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance'],
  scope: 'read',
  encrypted: false,
  ttlSeconds: 3600,
});

const balance = await sdk.getBalance(cap.id);
console.log('OCT balance:',       balance.octBalance);
console.log('Encrypted balance:', balance.encryptedBalance);
console.log('Cipher:',            balance.cipher);
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
| `walletPubKey` | `string` | Ed25519 public key (hex) — Octra address |
| `address` | `string` | Octra address (same as `walletPubKey`) |
| `evmAddress` | `string` | Ethereum address derived from same key |
| `network` | `'mainnet' \| 'devnet'` | Active Octra network from wallet |
| `evmNetworkId` | `string` | Active EVM network from wallet settings (e.g. `'eth-mainnet'`) |
| `epoch` | `number` | Current epoch at connect time |
| `branchId` | `string` | Branch ID (default `'main'`) |
| `circle` | `string` | Circle ID |
| `sessionId` | `string` | Session identifier |
| `viewPublicKey` | `string?` | Curve25519 view public key (base64) — safe to share, no signing power |
| `pvacRegistered` | `boolean?` | Whether PVAC/FHE public key is registered on the active node |

> `network` and `evmNetworkId` are read from the wallet's active settings — dApps do not need to manage these.

---

## Capabilities

```typescript
const cap = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 7200,
});

const all     = await sdk.listCapabilities();
const renewed = await sdk.renewCapability(cap.id);
await sdk.revokeCapability(cap.id);
```

### Scopes

| Scope | Methods | Popup |
|-------|---------|-------|
| `read` | `get_balance`, `get_encrypted_balance`, `stealth_scan`, `get_evm_tokens`, `get_evm_token_balance`, `get_crypto_identity`, `decrypt_cipher`, `encrypt_value`, `compute_shared_secret`, `scan_outputs` | No |
| `write` | `send_transaction`, `encrypt_balance`, `decrypt_balance`, `stealth_send`, `stealth_claim`, `send_evm_transaction`, `send_erc20_transaction`, `sign_for_zk` | Yes |

---

## Balance

```typescript
// Full balance — auto-execute, no popup
const balance = await sdk.getBalance(cap.id);

// Encrypted balance info only — auto-execute, no popup
const info = await sdk.getEncryptedBalance(cap.id);
```

**`BalanceResponse`**

| Field | Type | Description |
|-------|------|-------------|
| `octAddress` | `string` | Octra address |
| `octBalance` | `number` | Public OCT balance |
| `encryptedBalance` | `number` | Decrypted encrypted balance (0 if PVAC unavailable) |
| `cipher` | `string` | Raw HFHE cipher (`"hfhe_v1|..."` or `"0"`) |
| `hasPvacPubkey` | `boolean` | Whether FHE public key is registered |
| `network` | `'mainnet' \| 'devnet'` | Active Octra network |

---

## Sign Message

```typescript
// Always opens popup for approval
const result = await sdk.signMessage('Sign in to My dApp');
// result.signature — Ed25519 hex signature
// result.address   — Octra address that signed
// result.message   — original message
```

---

## OCT Transactions

```typescript
// Requires: send_transaction, write scope — always opens popup
const result = await sdk.sendContractCall(cap.id, {
  contract: 'oct...',
  method: 'transfer',
  params: ['oct...', 1000],
  amount: 0,
});
// result.txHash, result.contract, result.method
```

---

## Encrypted Balance Operations

> Requires PVAC server configured in wallet settings.

```typescript
// Move OCT → encrypted balance — always opens popup
const enc = await sdk.encryptBalance(cap.id, 1.0);

// Move encrypted balance → OCT — always opens popup
const dec = await sdk.decryptBalance(cap.id, 0.5);
```

---

## Stealth Transfers

> Requires PVAC server configured in wallet settings.

```typescript
// Send private transfer from encrypted balance — always opens popup
const sent = await sdk.stealthSend(cap.id, { to: 'oct...', amount: 0.5 });

// Scan for claimable outputs — auto-execute, no popup
// ECDH runs inside wallet — private view key never exposed to dApp
const outputs = await sdk.stealthScan(cap.id);

// Claim a stealth output into encrypted balance — always opens popup
const claimed = await sdk.stealthClaim(cap.id, outputs[0].id);
```

---

## PVAC / HFHE Crypto (Phase 7)

These methods expose the wallet's cryptographic identity and HFHE primitives to dApps. All private key operations run inside the wallet extension — dApps only receive derived public data or encrypted results.

### Crypto Identity

```typescript
// Requires: get_crypto_identity, read scope — auto-execute, no popup
const identity = await sdk.getCryptoIdentity(cap.id);

console.log(identity.ed25519PublicKey); // Ed25519 pubkey (hex)
console.log(identity.viewPublicKey);    // Curve25519 view pubkey (base64) — safe to share
console.log(identity.pvacRegistered);   // bool — PVAC key registered on node
console.log(identity.currentCipher);    // current hfhe_v1|... cipher from node
```

**`CryptoIdentity`**

| Field | Type | Description |
|-------|------|-------------|
| `ed25519PublicKey` | `string` | Ed25519 public key (hex, 32 bytes) |
| `viewPublicKey` | `string` | Curve25519 view public key (base64, 32 bytes) — safe to share |
| `pvacRegistered` | `boolean` | Whether PVAC/FHE key is registered on the active node |
| `currentCipher` | `string` | Current HFHE cipher from node (`"hfhe_v1|..."` or `"0"`) |

> The view public key has no signing power. Share it with counterparties so they can send stealth transfers to this wallet.

---

### ECDH Shared Secret

```typescript
// Requires: compute_shared_secret, read scope — auto-execute, no popup
const result = await sdk.computeSharedSecret(cap.id, recipientViewPubkey);

console.log(result.sharedSecret); // base64, 32 bytes
console.log(result.stealthTag);   // hex, 16 bytes — for output matching
console.log(result.claimSecret);  // base64, 32 bytes — for claiming outputs
```

**`SharedSecretResult`**

| Field | Type | Description |
|-------|------|-------------|
| `sharedSecret` | `string` | ECDH shared secret (base64, 32 bytes) |
| `stealthTag` | `string` | Stealth tag derived from shared secret (hex, 16 bytes) |
| `claimSecret` | `string` | Claim secret derived from shared secret (base64, 32 bytes) |

Use case: verify a stealth output belongs to a specific recipient, or derive encryption keys for private messaging between two wallets.

---

### Client-Side HFHE Decrypt

```typescript
// Requires: decrypt_cipher, read scope — auto-execute, no popup
// No transaction, no fee — pure read operation
const result = await sdk.decryptCipher(cap.id, 'hfhe_v1|...');

console.log(result.valueRaw); // bigint — raw units (1 OCT = 1_000_000)
console.log(result.valueOct); // number — human-readable OCT
```

**`CipherDecryptResult`**

| Field | Type | Description |
|-------|------|-------------|
| `valueRaw` | `bigint` | Decrypted value in raw units |
| `valueOct` | `number` | Human-readable value in OCT |

Use case: dApp fetches an encrypted value from contract storage and decrypts it locally to display to the user — the plaintext never touches the server.

```typescript
// Example: private leaderboard
const cipher = await rpc.contractCall(CONTRACT, 'get_my_score', [userAddress]);
const { valueRaw } = await sdk.decryptCipher(cap.id, cipher);
console.log('Your score:', valueRaw);
```

---

### Client-Side HFHE Encrypt

```typescript
// Requires: encrypt_value, read scope — auto-execute, no popup
const result = await sdk.encryptValue(cap.id, 1_000_000n); // 1 OCT in raw units

console.log(result.cipher); // "hfhe_v1|..." — ready for contract calls
```

**`CipherEncryptResult`**

| Field | Type | Description |
|-------|------|-------------|
| `cipher` | `string` | HFHE cipher string (`"hfhe_v1|..."`) ready for use in contract calls |

Use case: dApp needs to pass an encrypted value to a contract method without revealing the plaintext on-chain.

```typescript
// Example: submit encrypted bid in a private auction
const { cipher } = await sdk.encryptValue(cap.id, bidAmountRaw);
await sdk.sendContractCall(cap.id, {
  contract: AUCTION_CONTRACT,
  method: 'submit_bid',
  params: [cipher],
});
```

---

### Stealth Output Scan

```typescript
// Requires: scan_outputs, read scope — auto-execute, no popup
// ECDH runs inside wallet — private view key never exposed to dApp

// 1. Fetch raw outputs from node
const rawOutputs = await rpc.call('octra_stealthOutputs', [0]);

// 2. Scan with progress tracking
const result = await sdk.scanOutputs(cap.id, rawOutputs, (progress) => {
  console.log(`${progress.label} — ${progress.percent}%`);
});

console.log(`Scanned ${result.totalScanned}, found ${result.matched}`);

for (const output of result.outputs) {
  console.log(`Found ${output.amountOct} OCT from ${output.senderAddress}`);
  console.log('Claim secret:', output.claimSecret);

  // Claim it
  await sdk.stealthClaim(cap.id, output.id);
}
```

**`RawStealthOutput`** (input — from node RPC)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string \| number` | Unique output ID |
| `eph_pub` | `string` | Ephemeral public key (base64, Curve25519) |
| `stealth_tag` | `string` | Stealth tag for output matching (hex, 16 bytes) |
| `enc_amount` | `string` | AES-256-GCM encrypted amount+blinding (base64) |
| `claimed` | `number?` | 0 = unclaimed |
| `epoch_id` | `number?` | Epoch when output was created |
| `sender_addr` | `string?` | Sender address |
| `tx_hash` | `string?` | Transaction hash of the stealth send |

**`ScannedOutput`** (result — outputs belonging to this wallet)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique output ID |
| `amountRaw` | `bigint` | Amount in raw units (1 OCT = 1_000_000) |
| `amountOct` | `number` | Human-readable amount in OCT |
| `epochId` | `number` | Epoch when output was created |
| `senderAddress` | `string` | Sender address |
| `txHash` | `string` | Transaction hash of the stealth send |
| `claimSecret` | `string` | Claim secret (base64) — needed to claim this output |
| `blinding` | `string` | Blinding factor (base64) — needed for range proof |
| `rawOutput` | `RawStealthOutput` | Full raw output for passing back to `stealthClaim` |

**`ScanOutputsResult`**

| Field | Type | Description |
|-------|------|-------------|
| `outputs` | `ScannedOutput[]` | Outputs belonging to this wallet |
| `totalScanned` | `number` | Total number of outputs scanned |
| `matched` | `number` | Number of outputs that matched this wallet |

---

### ZK Proof Signing

```typescript
// Requires: sign_for_zk, write scope — always opens popup for approval
const data = new TextEncoder().encode('my-commitment-data');
const result = await sdk.signForZK(cap.id, { data, domain: 'my_dapp_v1' });

console.log(result.signature); // Ed25519 signature (hex)
console.log(result.publicKey); // Ed25519 public key (hex)
console.log(result.dataHash);  // SHA-256 of data (hex) — use as ZK public input
```

**`ZkSignResult`**

| Field | Type | Description |
|-------|------|-------------|
| `signature` | `string` | Ed25519 signature (hex) |
| `publicKey` | `string` | Ed25519 public key (hex) |
| `dataHash` | `string` | SHA-256 hash of the input data (hex) — use as ZK circuit public input |

Use case: generate a ZK proof where the public input includes a wallet signature, proving ownership without revealing the private key.

---

### Progress Tracking

Long-running PVAC operations (like scanning large output sets) support a progress callback:

```typescript
const result = await sdk.scanOutputs(cap.id, outputs, (progress) => {
  console.log(progress.step);    // 'initializing' | 'scanning' | 'ecdh' | 'done' | ...
  console.log(progress.label);   // human-readable label, e.g. "Scanning 1200 outputs..."
  console.log(progress.percent); // 0–100
});
```

**`PvacOperationStep`**

```
'initializing' | 'keygen' | 'encrypting' | 'decrypting' |
'scanning' | 'ecdh' | 'building_proof' | 'done'
```

---

## dApp Patterns with HFHE

### Pattern 1 — Private Score Board

Contract stores encrypted scores per user. dApp decrypts client-side — server never sees plaintext.

```typescript
// Contract (AML):
// view fn get_my_score(player: address): string { return self.scores[player] }

const cipher = await rpc.contractCall(CONTRACT, 'get_my_score', [userAddress]);
const { valueRaw, valueOct } = await sdk.decryptCipher(cap.id, cipher);
console.log(`Your score: ${valueRaw} (${valueOct} OCT)`);
```

### Pattern 2 — Private Auction (Encrypted Bid)

```typescript
// Encrypt bid amount client-side, submit to contract
const { cipher } = await sdk.encryptValue(cap.id, bidAmountRaw);
await sdk.sendContractCall(cap.id, {
  contract: AUCTION_CONTRACT,
  method: 'submit_bid',
  params: [cipher],
});
```

### Pattern 3 — Stealth Airdrop Scanner

```typescript
// Fetch all outputs from node, scan for ones belonging to this wallet
const rawOutputs = await rpc.call('octra_stealthOutputs', [0]);
const { outputs, matched } = await sdk.scanOutputs(cap.id, rawOutputs, (p) => {
  updateProgressBar(p.percent);
});

console.log(`Found ${matched} claimable outputs`);
for (const output of outputs) {
  await sdk.stealthClaim(cap.id, output.id);
}
```

### Pattern 4 — ZK-Gated dApp (Groth16 + HFHE)

```typescript
// 1. Sign commitment data with wallet key
const commitment = new TextEncoder().encode(mySecretData);
const { signature, publicKey, dataHash } = await sdk.signForZK(cap.id, {
  data: commitment,
  domain: 'my_zkapp_v1',
});

// 2. Generate ZK proof off-chain (snarkjs)
const { proof, publicSignals } = await snarkjs.groth16.prove(
  circuitZkey,
  { secret: mySecretData, hash: dataHash, sig: signature }
);

// 3. Submit proof to contract — verified on-chain via groth16_verify_bn254
await sdk.sendContractCall(cap.id, {
  contract: ZK_CONTRACT,
  method: 'execute_with_proof',
  params: [proofBytes, inputsBytes, nullifier],
});
```

---

## EVM Operations

```typescript
// Send ETH — always opens popup
const evmResult = await sdk.sendEvmTransaction(cap.id, {
  to: '0x...',
  amount: '0.01',
});

// Send ERC-20 — always opens popup
const erc20Result = await sdk.sendErc20Transaction(cap.id, {
  tokenContract: '0x4647e1fE715c9e23959022C2416C71867F5a6E80',
  to: '0x...',
  amount: '1000000',
  decimals: 6,
  symbol: 'wOCT',
});

// Get all ERC-20 balances — auto-execute, no popup
const tokens = await sdk.getEvmTokens(cap.id);
for (const token of tokens.tokens) {
  console.log(`${token.symbol}: ${token.balance}`);
}

// Get single token balance — auto-execute, no popup
const wOCT = await sdk.getEvmTokenBalance(
  cap.id,
  '0x4647e1fE715c9e23959022C2416C71867F5a6E80',
  { decimals: 6, symbol: 'wOCT' },
);
```

---

## Fee Estimation

```typescript
const plain     = await sdk.estimatePlainTx({});
const encrypted = await sdk.estimateEncryptedTx({ scheme: 'HFHE', data: new Uint8Array(8), associatedData: '' });

console.log(plain.gasUnits, 'OU =', plain.tokenCost, 'OCT');
```

---

## Events

```typescript
sdk.on('connect',              ({ connection }) => console.log('Connected:', connection.walletPubKey));
sdk.on('disconnect',           ()               => console.log('Disconnected'));
sdk.on('capabilityGranted',    ({ capability }) => console.log('Granted:', capability.id));
sdk.on('capabilityRevoked',    ({ capabilityId }) => console.log('Revoked:', capabilityId));
sdk.on('branchChanged',        ({ branchId, epoch }) => console.log('Branch:', branchId));
sdk.on('epochChanged',         ({ epoch }) => console.log('Epoch:', epoch));
sdk.on('extensionReady',       () => console.log('OctWa extension detected'));
sdk.on('stealthOutputFound',   (output) => console.log('New stealth output:', output.amountOct, 'OCT'));
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
  await sdk.decryptCipher(cap.id, cipher);
} catch (error) {
  if (error instanceof UserRejectedError)    return;
  if (error instanceof CapabilityExpiredError) {
    const renewed = await sdk.renewCapability(cap.id);
    // retry with renewed.id
  }
  if (error instanceof ScopeViolationError)  console.error('Method not in scope:', error.message);
  if (error instanceof ValidationError)      console.error('Invalid input:', error.message);
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
| **`getCryptoIdentity(capId)`** | **`Promise<CryptoIdentity>`** | **No** | **read** |
| **`computeSharedSecret(capId, theirViewPubkey)`** | **`Promise<SharedSecretResult>`** | **No** | **read** |
| **`decryptCipher(capId, cipher)`** | **`Promise<CipherDecryptResult>`** | **No** | **read** |
| **`encryptValue(capId, valueRaw)`** | **`Promise<CipherEncryptResult>`** | **No** | **read** |
| **`scanOutputs(capId, outputs, onProgress?)`** | **`Promise<ScanOutputsResult>`** | **No** | **read** |
| **`signForZK(capId, input)`** | **`Promise<ZkSignResult>`** | **Yes** | **write** |

---

## Network

| Value | Description |
|-------|-------------|
| `'mainnet'` | Production network |
| `'devnet'` | Development/testing network |

The active network is read from the wallet's RPC provider settings — dApps do not need to manage this.

---

## Security

- Private keys **never leave** the wallet extension
- All signing happens in the background service worker
- Capabilities are Ed25519-signed and cryptographically bound to `appOrigin`
- Signing mutex prevents nonce races and double-send attacks
- Domain separation (`OctraCapability:v2:`, `OctraInvocation:v2:`) prevents cross-context signature replay
- PVAC/HFHE proof generation happens inside the wallet — dApps never handle raw private keys
- View public key (Curve25519) is safe to share — it has no signing power, only used for ECDH
- ECDH shared secret computation runs inside the wallet — dApps receive only the derived output
- `scanOutputs` performs ECDH for each stealth output inside the wallet — private view key never exposed

---

## Changelog

### v1.6.0
- **Silent offscreen PVAC runner (extension side)** — dApp reads that need WASM (decrypt cipher, encrypt value, identity, ECDH, scan outputs) now run inside a `chrome.offscreen` document instead of flashing the wallet popup. The SDK surface is unchanged; the UX regression where every `decryptCipher()` showed a blank popup is fixed on the wallet side.
- **`sendContractCall()` forwards the optional `ou` override** — the wallet previously ignored it and charged the default 10 000 OU transfer rate. Contract calls now use the correct fee.
- **Chain-read helpers (no popup)** — `getTransaction`, `waitForConfirmation(hash, opts)`, `getEpoch`, `getRecommendedFee(opType)`, `getContractStorage(addr, key)`, `callContractView({ contract, method, params })`, `getViewPubkey(addr)`.
- **Convenience reads** — `getDecryptedBalance()` rolls `getBalance` + `decryptCipher` into one call; `stealthScanFull(fromEpoch?, onProgress?)` wraps `octra_stealthOutputs` fetch + `scanOutputs`.
- **New write helper** — `keySwitch()` rotates the wallet's PVAC pubkey on chain.
- **Audit + integration harness** — `AUDIT.md` documents the SDK's security model; `tests/harness/` adds a browser smoke test (`smoke.html`) and CLI harness (`tsx tests/harness/cli.ts`) that prove parity between the SDK's canonical layer and the extension's `core.js`.
- **New types exported** — `TransactionInfo`, `WaitForConfirmationOptions`, `EpochInfo`, `RecommendedFee`, `ContractViewPayload`, `ContractViewResult`.
- Internal — canonical/wire test coverage (`parity.test.ts`, `reads.test.ts`, `wire.test.ts`).

### v1.5.0
- Publish to npm as `@octwa/sdk@1.5.0`
- Used as dependency for ONS (Octra Name Service) dApp

### v1.4.0
- **Phase 7: PVAC / HFHE Crypto Identity** — full crypto primitives for private dApps
- Add `getCryptoIdentity()` — Ed25519 pubkey, Curve25519 view pubkey, PVAC status, current cipher
- Add `computeSharedSecret()` — ECDH with counterparty's view pubkey, returns shared secret + stealth tag + claim secret
- Add `decryptCipher()` — client-side HFHE decrypt of `hfhe_v1|...` ciphers from contract storage (no tx, no fee)
- Add `encryptValue()` — client-side HFHE encrypt, returns cipher ready for contract calls
- Add `scanOutputs()` — scan raw stealth outputs with ECDH inside wallet, returns matched outputs with amounts
- Add `signForZK()` — Ed25519 signing for ZK proof public inputs (Groth16/BN254 compatible)
- Add `PvacProgressCallback` — progress tracking for long-running scan operations
- Add `stealthOutputFound` event — emitted when a new stealth output is found during scan
- `Connection` now includes `address`, `viewPublicKey`, `pvacRegistered`
- New types: `CryptoIdentity`, `CipherDecryptResult`, `CipherEncryptResult`, `RawStealthOutput`, `ScannedOutput`, `ScanOutputsResult`, `SharedSecretResult`, `ZkSignInput`, `ZkSignResult`, `PvacProgress`, `PvacOperationStep`
- Extension: 6 new message types whitelisted in content script (`PVAC_*`)
- Background: ECDH, stealth tag, claim secret, AES-256-GCM amount decrypt all run in wallet context

### v1.3.4
- Fix `sendContractCall()` — correct Octra wire format (`encrypted_data` = plain method name, `message` = JSON params array)

### v1.3.3
- Add `signMessage()`, `getBalance()`, `getEncryptedBalance()`
- Add `encryptBalance()` / `decryptBalance()`
- Add `stealthSend()` / `stealthScan()` / `stealthClaim()`
- Add `sendEvmTransaction()` / `sendErc20Transaction()` / `sendContractCall()`
- Add `getEvmTokens()` / `getEvmTokenBalance()`
- `Connection` extended with `evmNetworkId`
- Network type corrected: `'testnet'` → `'devnet'`

### v1.2.0
- Initial capability-based authorization model
- `invoke()` with signing mutex and nonce management
- Ed25519 capability verification
- `estimatePlainTx()` / `estimateEncryptedTx()`

---

## License

MIT
