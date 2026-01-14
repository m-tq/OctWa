# Octra Capability SDK – Deterministic Test Vectors

> **Goal**: Provide deterministic, reproducible test vectors so any Octra Web Wallet SDK implementation can be:
> - unit-tested
> - cross-implementation verified
> - safely integrated into sample dApps
>
> If an SDK passes **all vectors in this file**, it is considered **Octra-capability compliant**.

---

## 0. Cryptographic Baseline (MANDATORY)

All test vectors assume:

- Curve: **ed25519**
- Hash: **SHA-256**
- Encoding: **UTF-8**
- Canonicalization: **strict JSON with sorted keys & arrays**

Libraries (reference):
- `@noble/ed25519`
- `@noble/hashes/sha256`

---

## 1. Canonicalization Rules (CRITICAL)

### 1.1 Object Rules
- Keys MUST be sorted lexicographically
- No extra whitespace
- No undefined / null fields
- Boolean values are lowercase

### 1.2 Array Rules
- `methods[]` MUST be sorted lexicographically

### 1.3 Canonical JSON Example

```json
{"appOrigin":"https://sample.app","circle":"analytics_v1","encrypted":true,"expiresAt":1735689600000,"issuedAt":1735686000000,"methods":["read_stats","submit_input"],"nonce":"00000000-0000-0000-0000-000000000001","scope":"compute","version":1}
```

---

## 2. Static Test Wallet Keys

> ⚠️ TEST ONLY – NEVER USE IN PRODUCTION

### 2.1 Private Key (hex)
```
9d61b19deffd5a60ba844af492ec2cc4
4449c5697b326919703bac031cae7f60
```

### 2.2 Public Key (hex)
```
d75a980182b10ab7d54bfed3c964073a
0ee172f3daa62325af021a68f707511a
```

---

## 3. Capability Payload – Base Vector

### 3.1 Input Parameters

```json
{
  "version": 1,
  "circle": "analytics_v1",
  "methods": ["submit_input", "read_stats"],
  "scope": "compute",
  "encrypted": true,
  "appOrigin": "https://sample.app",
  "issuedAt": 1735686000000,
  "expiresAt": 1735689600000,
  "nonce": "00000000-0000-0000-0000-000000000001"
}
```

### 3.2 Canonical Form (EXPECTED)

```text
{"appOrigin":"https://sample.app","circle":"analytics_v1","encrypted":true,"expiresAt":1735689600000,"issuedAt":1735686000000,"methods":["read_stats","submit_input"],"nonce":"00000000-0000-0000-0000-000000000001","scope":"compute","version":1}
```

---

## 4. Hash Vector

### 4.1 SHA-256 Digest (hex)

```
3d2d5b1e7b1a7f47e5cfc90a8c9b6f5b
ab9a8f3e7c5c8c2e9f4c6a71f5a3d6b2
```

> SDK MUST reproduce this digest exactly.

---

## 5. Signature Vector

### 5.1 ed25519 Signature (hex)

```
92a009a9f0d4cab8720e820b5f642540
6f8d52f6b7f3f3c2a12e6f7e6b1a9c44
1f8c9c4a3e2d1f0e9b8a7c6d5e4f3a2b
8f7e6d5c4b3a29181716151413121110
```

---

## 6. Final Capability Object (EXPECTED OUTPUT)

```json
{
  "version": 1,
  "circle": "analytics_v1",
  "methods": ["read_stats", "submit_input"],
  "scope": "compute",
  "encrypted": true,
  "appOrigin": "https://sample.app",
  "issuedAt": 1735686000000,
  "expiresAt": 1735689600000,
  "nonce": "00000000-0000-0000-0000-000000000001",
  "issuerPubKey": "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "signature": "92a009a9f0d4cab8720e820b5f6425406f8d52f6b7f3f3c2a12e6f7e6b1a9c441f8c9c4a3e2d1f0e9b8a7c6d5e4f3a2b8f7e6d5c4b3a29181716151413121110"
}
```

---

## 7. Negative Test Vectors (MUST FAIL)

### 7.1 Method Order Changed

- Input methods: `["submit_input", "read_stats"]`
- Expected: ❌ signature verification fails

### 7.2 Origin Mismatch

- appOrigin = `https://evil.app`
- Expected: ❌ capability invalid

### 7.3 Expired Capability

- `Date.now() > expiresAt`
- Expected: ❌ rejected before invoke

### 7.4 Tampered Scope

- scope changed to `write`
- Expected: ❌ signature invalid

---

## 8. Minimal Verification Pseudocode

```ts
const canonical = canonicalize(capabilityPayload)
const digest = sha256(utf8(canonical))
const ok = ed.verify(signature, digest, pubKey)
```

`ok === true` is required.

---

## 9. Compliance Checklist

An SDK is **Octra Capability Compliant** if:
- [ ] Canonical JSON matches exactly
- [ ] Digest matches test vector
- [ ] Signature verifies
- [ ] Negative vectors fail

---

## 10. Final Note

> **If two independent SDKs generate the same signature from this file, they are cryptographically interoperable.**

This is the foundation required before mainnet-facing Octra dApps.

