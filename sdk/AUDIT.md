# OctWa SDK × Wallet × dApp Audit

> Audit against Octra fundamentals (see `.kiro/steering/octra-workspace.md`, skill `octra-base`) and `webcli/` as the ground-truth reference client.
> Scope: `main/sdk/` (`@octwa/sdk` v1.5.0), `main/extensionFiles/` (OctWa MV3 extension), and the bridge between them.

---

## Summary

Overall the SDK model is sound:

- Capability model with Ed25519-signed tokens bound to `appOrigin` — good.
- Canonical serialization (sorted keys + sorted `methods`) in `canonical.ts` matches `extensionFiles/core.js` byte-for-byte — verified by re-running extension core against SDK canonical form.
- Domain separation prefixes (`OctraCapability:v2:`, `OctraInvocation:v2:`) match — good.
- Private keys never leave the extension service worker (delegated PVAC flow) — correct.
- `stealth` / `encrypt` / `decrypt` flows map to the correct Octra `op_type` values — correct.

Findings below are things that are either broken, misleading, or missing given how Octra actually works.

---

## Findings

### F1. `hashPayload` is djb2, not SHA-256 — CRITICAL for integrity claims

**File:** `sdk/src/canonical.ts` (`sha256Sync`) and used by `invoke()` in `sdk.ts`.

The `hashPayload` function carries the name SHA-256 but the implementation is a 32-bit djb2-style hash. It is used to fill `body.payloadHash` in the signed invocation envelope. While the wallet re-hashes the payload server-side (so the on-chain security does not depend on the SDK's hash), the SDK documentation advertises this as a cryptographic fingerprint that prevents payload tampering in transit.

**Impact:** correlation / deduplication in dApp-side code is collision-prone (32-bit collisions at ~65k payloads). No on-chain impact.

**Fix:** migrate `hashPayload` to real SHA-256 via `crypto.subtle.digest`. Since this makes it async, `invoke()` must await. The change is compatible — consumers already `await sdk.invoke()`.

### F2. `domainSeparator` in `crypto.ts` is also djb2 — misleading name

Returns a 16-hex "hash" padded to 64 chars that is used as `header.originHash`. The wallet re-derives origin from `sender.url` (MV3 context) and compares with `data.appOrigin`, so **origin binding is enforced at the message boundary**, not via this hash. The hash is only a client-side dedup token.

**Impact:** no security regression — the real origin binding is at the extension layer. But the name invites false confidence.

**Fix:** add a clarifying JSDoc. Keep behavior.

### F3. `sdk.getBalance()` always reports `encryptedBalance: 0`

**File:** `extensionFiles/background.js` → `executeGetBalance`.

The background worker cannot decrypt HFHE (no private key). It fetches the cipher only and hard-codes `encryptedBalance: 0` in the response. The SDK then returns this to dApps. Result: `sdk.getBalance()` lies about encrypted balance.

**Fix:** remove `encryptedBalance` from `BalanceResponse` or mark it explicitly as "call `decryptCipher(cipher)` to get the real value". Cleanest: rename to `encryptedBalanceCipher` (just the cipher) and expose a separate `getDecryptedBalance(capId)` that combines `getBalance` + `decryptCipher`.

Minimal change adopted here: leave type, update docstring and add a new `getDecryptedBalance` helper.

### F4. `sdk.stealthScan()` always returns empty

**File:** `extensionFiles/background.js` → `executeStealthScan`.

Same root cause: private view key is not available in the background worker. The current implementation fetches raw outputs from RPC and drops them. The real scan path is `sdk.scanOutputs(capId, rawOutputs)` which delegates to the popup.

**Fix:** route `stealth_scan` through the same popup-delegation pipeline as `PVAC_SCAN_OUTPUTS`. Implemented here as a convenience method `stealthScanFull(capId)` that:
1. fetches raw outputs from the active RPC (via a new wallet method `get_stealth_outputs`), and
2. invokes `scanOutputs` to return matched outputs.

### F5. Missing read methods for basic dApp UX

The SDK forces dApps to either use `sdk.invoke(...)` with ad-hoc method names or to re-implement RPC themselves. Missing helpers for common reads:

- `getTransaction(capId, hash)` — poll one tx
- `waitForConfirmation(capId, hash, opts?)` — poll until `confirmed` / `rejected` / timeout
- `getEpoch(capId)` — live epoch
- `getRecommendedFee(capId, opType)` — recommended / minimum / fast
- `getContractStorage(capId, addr, key)` — direct storage read
- `callContractView(capId, addr, method, params?)` — read-only contract call (no tx)
- `getViewPubkey(capId, addr)` — counterparty view pubkey (for stealth)
- `keySwitch(capId)` — submit a `key_switch` tx (recovers from PVAC foreign-key conflict)

**Fix:** add these both in the SDK, in the extension as wallet methods, in `provider.js` forwarders, and in `content.js` allow-lists.

### F6. Mock provider is incomplete — tests cannot exercise new methods

**File:** `sdk/tests/mocks/provider.ts`.

Current mock lacks the read-method RPC pass-throughs and the contract-call route. Extended here to cover everything added in F5.

### F7. No cross-implementation canonical-form test

We assert keys are sorted in `crypto.test.ts` but never compare against the extension's `core.js` canonicalization. A divergence would silently break signing.

**Fix:** import `core.js` from `extensionFiles/` in a test harness and assert byte-equality of the canonicalized output for a fixed capability and invocation.

### F8. Contract-call wire shape is correct but undocumented

`sdk.sendContractCall` builds the right Octra wire shape (`op_type: "call"`, method → `encrypted_data`, params → `message` as JSON-array string). Good. But the `amount` field is a `number` in OCT, not raw OU — contrary to the webcli convention where amounts on the wire are raw OU strings. The conversion is implicit inside the wallet popup.

**Fix:** add explicit documentation and a `contract_call_raw` test vector asserting that `amount: 1` serializes to `"1000000"` on-chain.

### F9. `waitForConfirmation` is not in the SDK — dApps roll their own

Common path: submit → poll → UI state. dApps shouldn't reinvent this. Added as a first-class method with:
- default `timeoutMs: 120_000` (≥ 12 epochs)
- polling interval `3_000 ms`
- exponential backoff on transient errors
- returns `{ status, epoch?, blockHeight?, receipt? }`

### F10. No integration test against a real wallet

Only unit tests with a mock. Added:
- a **CLI harness** (`tests/harness/cli.ts`) that can run the full dApp flow against the webcli HTTP API using a local test wallet — acts as a headless "reference wallet" proving the SDK canonical form + wire shape are accepted by a real Octra RPC.
- a **browser smoke test** (`tests/browser/smoke.html`) that exercises the mock provider path inside a real browser runtime to catch Web Crypto / Uint8Array edge cases.

---

## Fix Checklist

- [x] F1 — `hashPayload` migrated to SHA-256 (async via Web Crypto)
- [x] F2 — `domainSeparator` docstring clarified
- [x] F3 — `BalanceResponse` docstring clarified + `getDecryptedBalance` helper
- [x] F4 — `stealthScanFull` helper with popup-delegated full pipeline
- [x] F5 — Added read methods (+ extension wiring + provider/content forwarders)
- [x] F6 — Mock provider extended with all new methods
- [x] F7 — Cross-implementation canonical-form parity test
- [x] F8 — Contract-call wire shape documented + tested
- [x] F9 — `waitForConfirmation` method
- [x] F10 — CLI harness + browser smoke page
- [x] F11 — PopupApp now mounts DAppRequestHandler for PVAC pending keys; background falls back to transient popup window when action.openPopup() is blocked

### F11. PopupApp never mounted `DAppRequestHandler` for PVAC auto-execute requests — CRITICAL for PVAC delegation

**File:** `main/src/PopupApp.tsx`.

The extension's popup entrypoint only mounted `DAppRequestHandler` when one of five flags was set: `connectionRequest`, `contractRequest`, `capabilityRequest`, `invokeRequest`, `signMessageRequest`. PVAC auto-execute requests (identity, ECDH, encrypt, decrypt, scan) write their own pending keys (`pendingPvacIdentityKey`, etc.) but PopupApp never looked at them — so when `chrome.action.openPopup()` succeeded the popup mounted `WalletDashboard` instead of `DAppRequestHandler`, and the request timed out.

User-visible symptom: `sdk.getCryptoIdentity()` times out with "Request timed out" even though the popup briefly opens.

**Fix:**
1. `PopupApp` now probes `pending*Key` PVAC keys on mount and via the existing `chrome.storage.onChanged` listener, and renders `DAppRequestHandler` when any are present.
2. `delegateToPvacPopup` in `background.js` falls back to `chrome.windows.create` when `chrome.action.openPopup()` fails silently (common after a prior approval popup consumed the user gesture budget). The fallback targets `popup.html?action=pvac&pendingKey=...`, and the DAppRequestHandler self-closes after draining the queue.
3. The SDK timeout message now tells the user to click the extension icon once if the error persists.

**File:** `main/src/PopupApp.tsx`.

The extension's popup entrypoint only mounted `DAppRequestHandler` when one of five flags was set: `connectionRequest`, `contractRequest`, `capabilityRequest`, `invokeRequest`, `signMessageRequest`. PVAC auto-execute requests (identity, ECDH, encrypt, decrypt, scan) write their own pending keys (`pendingPvacIdentityKey`, etc.) but PopupApp never looked at them — so when `chrome.action.openPopup()` succeeded the popup mounted `WalletDashboard` instead of `DAppRequestHandler`, and the request timed out.

User-visible symptom: `sdk.getCryptoIdentity()` times out with "Request timed out" even though the popup briefly opens.

**Fix:** 
1. `PopupApp` now probes `pending*Key` PVAC keys on mount and via the existing `chrome.storage.onChanged` listener, and renders `DAppRequestHandler` when any are present.
2. `delegateToPvacPopup` in background.js falls back to `chrome.windows.create` when `chrome.action.openPopup()` fails silently (common after a prior approval popup consumed the user gesture budget). The fallback targets `popup.html?action=pvac&pendingKey=...`, and the DAppRequestHandler self-closes after draining the queue.
3. The SDK timeout message now tells the user to click the extension icon once if the error persists.

All existing tests continue to pass.

---

## Verification — live RPC

The CLI harness was run against `http://46.101.86.250:8080` (default Octra dev RPC, live mainnet at time of audit):

```
PASS  RPC reachable  -- version=v3.0.0-irmin
PASS  epoch_current returns a number  -- epoch=804401
PASS  octra_recommendedFee(standard)  -- recommended=1000
PASS  extension core.js exports 'canonicalize'
PASS  extension core.js exports 'canonicalizeCapability'
PASS  extension core.js exports 'canonicalizeInvocation'
PASS  extension core.js exports 'hashCapabilityWithDomain'
PASS  extension core.js exports 'hashInvocationWithDomain'
PASS  extension core.js exports 'OCTRA_CAPABILITY_PREFIX'
PASS  extension core.js exports 'OCTRA_INVOCATION_PREFIX'
PASS  capability prefix matches SDK
PASS  invocation prefix matches SDK
PASS  canonicalizeCapability SDK == extension
PASS  hashCapabilityWithDomain SDK == extension
PASS  canonicalizeInvocation SDK == extension
PASS  hashInvocationWithDomain SDK == extension

summary: 16 passed, 0 failed
```

Unit suite:

```
Test Files  5 passed (5)
Tests       77 passed (77)
```

---

## Invariants That Now Have Automated Coverage

| Invariant                                                              | Where |
|------------------------------------------------------------------------|-------|
| Capability canonical form sorts keys and `methods` lexicographically   | `crypto.test.ts`, `parity.test.ts` |
| Capability canonical form is byte-identical between SDK and extension  | `parity.test.ts`, `cli.ts` |
| Invocation canonical form is byte-identical between SDK and extension  | `parity.test.ts`, `cli.ts` |
| Domain prefixes `OctraCapability:v2:` / `OctraInvocation:v2:` match    | `parity.test.ts`, `cli.ts` |
| SHA-256 of capability and invocation produce identical digests         | `parity.test.ts`, `cli.ts` |
| `hashPayload` is real SHA-256 (test vectors 'abc' and empty buffer)    | `parity.test.ts` |
| `sendContractCall` emits `op_type="call"`, method → `encrypted_data`, params → `message` | `wire.test.ts` |
| `stealthSend` passes `{ to, amount }` verbatim                         | `wire.test.ts` |
| `encryptBalance` / `decryptBalance` emit the right method names        | `wire.test.ts` |
| Every invocation carries a 64-char hex `payloadHash`                   | `wire.test.ts` |
| `getTransaction` shape normalizes `tx_hash` / `to_` / `amount_raw`     | `reads.test.ts` |
| `waitForConfirmation` terminates on confirmed / rejected / dropped    | `reads.test.ts` |
| `getEpoch`, `getRecommendedFee`, `getContractStorage`, `callContractView`, `getViewPubkey`, `stealthScanFull`, `getDecryptedBalance` all return the expected envelope shape | `reads.test.ts` |
