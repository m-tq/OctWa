# OctWa → New Octra Client Migration Prompt

## Context
You are an autonomous engineering agent tasked with preparing the OctWa
(web app + browser extension wallet) for compatibility with the upcoming
Octra **new client release**.

The current codebase is tightly coupled to the legacy Octra pre-client
(transaction-centric, synchronous, RPC-like).

The new Octra client introduces:
- encrypted runtime sessions
- async compute jobs
- encrypted-first data model
- event-based result delivery
- expanded wallet key capabilities

Your task is to refactor and prepare the codebase **without rewriting it**.

---

## High-Level Goal
Refactor OctWa so that:
- UI and SDK are **client-agnostic**
- encrypted data is treated as **opaque by default**
- all blockchain interactions are **async + event-driven**
- wallet permissions are **capability-based**
- migration to the new client requires only implementing a new adapter

---

## REQUIRED CHANGES (EXECUTE ALL)

---

## 1. Introduce Client Adapter Abstraction (CRITICAL)

### Action
Create a client abstraction layer that decouples UI and SDK from
any specific Octra client implementation.

### Requirements
- Define a single interface (TypeScript) for all client operations
- No UI component may directly call RPC, CLI, or HTTP endpoints
- All interactions must go through the adapter

### Example Interface
```ts
interface OctraClientAdapter {
  connect(): Promise<void>
  execute(action: string, payload: unknown): Promise<JobId>
  onEvent(handler: (event: ClientEvent) => void): void
  disconnect(): Promise<void>
}
```

### Acceptance Criteria
- Existing pre-client logic is wrapped in `PreClientAdapter`
- A placeholder `NextClientAdapter` exists (methods may throw NotImplemented)
- UI imports only the adapter factory, never the client directly

---

## 2. Convert Transaction Flow to Async Job Model

### Action
Replace all synchronous “send → success” flows with async job tracking.

### Requirements
- Every transaction or runtime call returns a `jobId`
- UI must support states:
  - pending
  - completed
  - failed
- No assumption that a transaction result is immediate

### Example Pattern
```ts
const jobId = await client.execute("send_tx", payload)
jobStore.track(jobId)
```

### Acceptance Criteria
- No UI path assumes immediate finality
- Job status is updated via events, not return values

---

## 3. Implement Internal Event Bus

### Action
Add a global event-handling mechanism for client events.

### Requirements
- Support events such as:
  - job_started
  - job_completed
  - job_failed
  - encrypted_result_ready
- UI subscribes to events, not polling

### Acceptance Criteria
- Event system exists (EventEmitter / observable / store-based)
- Client adapter feeds events into this system
- UI reacts to events instead of blocking calls

---

## 4. Treat Encrypted Data as Opaque by Default

### Action
Refactor all balance, tx result, and contract outputs to be
opaque encrypted values unless explicitly decrypted.

### Requirements
- Introduce a generic encrypted value type
- UI must not auto-render encrypted values
- Decryption must be user-initiated

### Example Type
```ts
type EncryptedValue = {
  blob: Uint8Array
  typeHint?: string
}
```

### Acceptance Criteria
- No component assumes numeric/string data
- Encrypted values show as 🔒 “Encrypted”
- Decrypt action requires explicit user consent

---

## 5. Add Wallet Capability / Permission Model

### Action
Expand wallet permissions beyond “connect & send”.

### Required Capabilities
- tx_sign
- runtime_execute
- decrypt_result
- reencrypt_for_third_party

### Requirements
- dApps must request specific capabilities
- Wallet UI must display permission prompts
- Permissions must be revocable

### Acceptance Criteria
- Permission model exists in SDK
- UI supports capability approval dialogs
- No silent decrypt or re-encrypt is possible

---

## 6. Separate Wallet UI from Runtime / App UI

### Action
Refactor UI layout so wallet functionality does not block
future runtime & contract interaction features.

### Required Separation
- WalletPanel (keys, accounts, permissions)
- Activity / Jobs Panel (async compute + tx)
- App / Contract Interaction Panel (future use)

### Acceptance Criteria
- UI structure allows runtime features without redesign
- Wallet view is not hardcoded to “send transaction” only

---

## 7. Remove Assumptions Tied to Legacy Pre-Client

### Action
Audit and eliminate assumptions such as:
- single-shot CLI execution
- plaintext balances
- tx hash == result
- synchronous RPC responses

### Acceptance Criteria
- No hardcoded output parsing
- No logic depends on specific CLI output strings
- All client outputs treated as structured events

---

## 8. Migration Safety Rules (DO NOT VIOLATE)

- Do NOT rewrite the entire app
- Do NOT remove legacy pre-client support
- Do NOT speculate on undocumented new-client APIs
- Do NOT auto-decrypt any data
- Do NOT log encrypted payloads

---

## Final Deliverables

The agent must produce:
1. Client adapter abstraction + implementations
2. Async job tracking system
3. Event bus for client events
4. Encrypted value handling in UI
5. Capability-based wallet permission model
6. Refactored UI layout ready for runtime features

When these are complete, OctWa must be able to
integrate the new Octra client by **only implementing**
`NextClientAdapter`.

---

## Success Definition

If the new Octra client is released tomorrow,
integration should require:
- ZERO UI rewrite
- ZERO wallet UX redesign
- ONLY adapter implementation

If this condition is met, the migration is successful.

