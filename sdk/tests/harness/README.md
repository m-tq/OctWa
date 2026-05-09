# SDK Integration Harness

End-to-end checks that exercise the SDK's canonical serialization, wire
shape, and auth model against **real** counterparties — not the unit-test
mock.

Unit tests (`tests/*.test.ts`) guarantee correctness of the SDK in
isolation. These harnesses prove the SDK plays well with the rest of the
Octra stack.

---

## Harnesses

### 1. `cli.ts` — against an Octra RPC node

A headless script that uses the SDK's canonical layer + a test Ed25519 keypair
to:

1. Verify RPC connectivity against the configured node
2. Verify a canonical invocation roundtrips through SHA-256 identically on the
   extension `core.js` and the SDK
3. Optionally submit a no-op read RPC (`node_status`, `octra_recommendedFee`)
   to prove the SDK's fee/epoch helpers resolve real values

```bash
# .env or env vars
OCTRA_RPC_URL=http://46.101.86.250:8080   # default dev RPC

# Run
npx tsx tests/harness/cli.ts
```

Outputs pass/fail per step and exits non-zero on any failure.

No private keys are needed — the harness only exercises reads. It does NOT
submit transactions and cannot send funds.

### 2. `browser/smoke.html` — against a real browser

Open in Chrome/Edge with the OctWa extension installed. The page is organized in **two runnable sections** so you can exercise the full SDK surface without ever risking funds:

- **run auto checks (safe, no popup)** — exercises every read-only path plus
  all PVAC auto-execute flows (crypto identity, ECDH, client-side HFHE encrypt
  + decrypt + roundtrip, stealth scan, contract view / storage, tx lookup,
  epoch, recommended fee, EVM token list, event listeners, capability
  lifecycle). Produces no tx, no fee, no popup prompts beyond the initial
  connect + capability approval.

- **run signing checks (popup required, no funds)** — exercises the paths
  that need an Ed25519 signature: `signMessage`, `signForZK`, and a
  `write`-scope capability request. Still no funds moved.

Opt-in controls:

- **enable write / money-moving checks** — reveals an amount / recipient form
  and the big red warning banner. When checked, the signing run also invokes
  `encryptBalance`, `decryptBalance`, `stealthSend`, and (optional)
  `sendContractCall`. These submit real transactions on the wallet's active
  network.

- **include EVM sends** — toggle for opting into `sendEvmTransaction` and
  `sendErc20Transaction` (these remain `skip` by default even with write
  enabled, since they need a test EVM account with real ETH / ERC-20 balance).

Optional form fields (all accept a blank value and will skip the related test):

- **pinned tx hash** — runs `getTransaction` + `waitForConfirmation` against
  a known hash
- **contract addr + method** — runs `getContractStorage` + `callContractView`
  against a known contract

Anatomy of the result table: each test reports `pass`, `fail`, `skip`, or
`pending`. Section headers group tests by area (connect, capabilities, reads,
PVAC, stealth, contract, tx, EVM, fees, events, signing, writes).

No transactions are submitted unless you both enable the checkbox AND run the
signing section.

#### Prerequisites — the extension must be up to date

The smoke page calls methods (`get_epoch`, `get_recommended_fee`, `get_view_pubkey`,
`get_transaction`, …) that were added to the wallet in the same audit as the SDK.
If you see errors like `Unexpected token '', "" is not valid JSON` or timeouts on
methods that should be auto-executing, your loaded extension is stale.

```bash
# Build the extension + SDK from the workspace root
cd main && npm run build:extension

# In chrome://extensions, click the reload icon on the OctWa card so the
# new background.js / content.js / provider.js are picked up.

# Build the SDK too — smoke.html imports ../../../dist/index.mjs
cd sdk && npm run build
```

#### Serve the page

```bash
# From the SDK root
cd main/sdk
npx serve .
# Visit: http://localhost:3000/tests/harness/browser/smoke.html
```

---

## Extending

To add a write-side check (submit a real tx), extend `cli.ts` with a
`--send-test-tx` flag that requires a test wallet mnemonic in the env. By
default the CLI stays read-only to avoid mutating network state.

---

## Troubleshooting

### `Unexpected token '', "" is not valid JSON`

The wallet returned an empty body for a method it doesn't recognize. Almost
always means the loaded extension build is older than the SDK calling it.
Fix: `npm run build:extension` (in `main/`) and reload the extension.

### `getCryptoIdentity` times out

`getCryptoIdentity` delegates to the popup because PVAC keys live there.
If the popup isn't open at call time and `chrome.action.openPopup()` silently
fails (it can, depending on user gesture context), the call waits for a
response that never comes. Workarounds:

1. Click the OctWa icon once to open the popup manually before running the
   smoke test, then immediately click **run all checks**.
2. After a connect prompt, the popup may auto-close before the identity
   request lands. Use the **clear storage connections** button in the smoke
   page, then re-run — the connect step keeps the popup open long enough
   for the auto-execute queue to drain.

### Cipher decrypts fail

Make sure PVAC is initialized in the wallet (the wallet icon should read
`pvac: ready`) and the active address has a registered PVAC pubkey on the
current node. If not: use the wallet's `encrypt` flow once to register, or
run `keySwitch` if there's a stale registration.
