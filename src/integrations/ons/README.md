# ONS Integration

> Drop-in resolver for the Octra Name Service. Zero runtime dependencies
> outside the standard `fetch` API.

This folder is a **self-contained integration**: it has its own RPC client, its own configuration surface, and its own cache. Nothing inside wires itself to wallet internals — the host app decides when to resolve a name, how long to cache it, and how to render the result.

The same files can be copied verbatim into an explorer, a dApp starter, or published as an npm package with minimal changes.

---

## Contents

```
integrations/ons/
  config.ts         network → contract address + rpc endpoint
  client.ts         typed view-only client (resolve, reverse, records)
  cache.ts          lru cache with per-entry TTL
  react.ts          optional React hook (useOnsResolver)
  index.ts          public entrypoint
  README.md         this file
```

`react.ts` is the only file that touches React. Non-React hosts import from `client.ts` directly.

---

## Quick start

### Resolve a name to an address

```ts
import { resolveOnsName } from '@/integrations/ons'

const address = await resolveOnsName('alice')
// → "oct7voWd6kADDiYdbCf4xFumSTXsMCsKK5eFqxzu5z8MyiE"
// → ""  if the name is unregistered, expired, or its destination is unset
```

### Resolve + surface the view pubkey for stealth routing

```ts
import { lookupOnsName } from '@/integrations/ons'

const record = await lookupOnsName('alice')
if (record) {
  console.log(record.destination)   // plaintext oct address
  console.log(record.viewPk)        // base64 curve25519 pubkey for stealth
  console.log(record.expiry)        // absolute epoch number
  console.log(record.isActive)      // true while not expired
}
```

### Reverse lookup (address → primary name)

```ts
import { reverseOnsLookup } from '@/integrations/ons'

const name = await reverseOnsLookup('oct7voWd6…')
// → "alice"   when the holder set a primary name
// → ""        when no primary is set or the name is no longer valid
```

### React hook (optional)

```tsx
import { useOnsResolver } from '@/integrations/ons/react'

function Recipient({ input }: { input: string }) {
  const { state, address, viewPk } = useOnsResolver(input)
  if (state === 'pending')    return <span>resolving…</span>
  if (state === 'not-found')  return <span>name not registered</span>
  if (state === 'passthrough') return null   // input is already an oct address
  return (
    <span>
      {input}.oct → <code>{address}</code>
    </span>
  )
}
```

The hook debounces input (250 ms by default), caches results in memory, and treats well-formed `oct…` inputs as passthrough (no RPC call).

---

## Configuring the contract address

Defaults are empty until you wire them in. Source the contract address from environment variables (or any other config surface your host already uses):

```ts
import { configureOns } from '@/integrations/ons'

configureOns({
  network:     'mainnet',
  contract:    import.meta.env.VITE_ONS_CONTRACT_MAINNET,  // oct1MAINNET...
  rpcUrl:      import.meta.env.VITE_RPC_MAINNET,           // https://rpc.octra.network
  cacheTtlMs:  30_000,                                     // optional cache TTL
})
```

Call this once at app bootstrap. The resolver keeps the last configuration in memory, so subsequent `resolveOnsName` / `lookupOnsName` / `useOnsResolver` calls use it automatically.

Multiple networks are supported via separate `createOnsClient(config)` instances if the host app needs to resolve across devnet and mainnet at once.

---

## How it works

1. **Input classification** — if the string matches the oct address regex, the resolver short-circuits to passthrough and never hits the network.
2. **Label validation** — 3..63 chars, `a-z0-9-`, lowercase, `.oct` suffix stripped.
3. **View call** — JSON-RPC `contract_call` against `resolve(label)`. No tx, no fee.
4. **Cache** — the result is cached for `cacheTtlMs` (default 15 s). Configurable per call via `{ fresh: true }`.
5. **Enrichment** — `lookupOnsName` additionally reads `view_pk_of`, `expiry_of`, and `is_active` in parallel.

---

## Integration into OctWa Wallet

`AddressInput` imports the hook and shows an inline preview when the user types a name instead of an address. The Send flow submits the resolved address if a name matches, otherwise submits the raw input as before.

The wallet never performs a write against the ONS contract — resolution only. Registrations, transfers, and marketplace actions live in the ONS dApp itself.

---

## Explorer integration

Explorers can pre-resolve addresses in tx lists:

```ts
import { reverseOnsLookup } from '@/integrations/ons'

const name = await reverseOnsLookup(tx.from)
const display = name ? `${name}.oct` : tx.from
```

Since reverse lookups only succeed when the owner explicitly set a primary name, this is safe to batch across an entire tx feed without privacy surprises.

---

## Removing the integration

Because the folder is self-contained, removing ONS support is a single-directory delete plus removing its imports from the host. No shared state, no cross-module hooks, no build-time configuration to unwind.
