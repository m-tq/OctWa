# PVAC Browser Refactor — Progress Tracking

Refactoring semua private operations dari native `pvac_server` sidecar ke
browser-based WASM + pure TypeScript. No local server required.

---

## Status

| Operasi | Status | Engine | Estimasi Waktu |
|---|---|---|---|
| `decrypt_balance` (read) | ✅ Done | WASM | ~1-3s |
| `encrypt_balance` | ✅ Done | WASM | ~5-15s |
| `decrypt_to_public` | ✅ Done | **Full WASM** | ~10-60 min (range proof) |
| `stealth_send` | ✅ Done | **Full WASM** | ~20-120 min (2x range proof) |
| `stealth_scan` | ✅ Done | Pure TS (Web Crypto) | <1s |
| `claim_stealth` | ✅ Done | WASM + Web Crypto | ~5-15s |

---

## Arsitektur

```
Browser
├── src/lib/pvac/
│   ├── types.ts              — shared types + progress tracking
│   ├── crypto-utils.ts       — Web Crypto helpers (ECDH, AES-GCM, Ed25519, tx signing)
│   ├── wasm-loader.ts        — singleton WASM loader + keypair cache
│   ├── node-registration.ts  — PVAC pubkey registration via RPC
│   ├── balance-ops.ts        — decrypt_balance, encrypt_balance, decrypt_to_public
│   ├── stealth-ops.ts        — stealth_send, stealth_scan, claim_stealth
│   └── index.ts              — barrel export
│
├── src/hooks/
│   └── usePvacOperation.ts   — React hook: isRunning, progress, error, run()
│
├── src/components/
│   └── PvacProgressBar.tsx   — progress indicator UI component
│
└── pvac_server/
    ├── build-wasm/
    │   ├── pvac_wasm.mjs     — Emscripten ES module loader (176KB)
    │   └── pvac_wasm.wasm    — WebAssembly binary (658KB)
    └── wasm/
        └── pvac-wasm.ts      — low-level WASM wrapper (PvacWasm class)
```

---

## Komponen yang diupdate

| Komponen | Perubahan |
|---|---|
| `EncryptBalanceDialog.tsx` | `handleEncryptWithBrowser` → WASM real implementation |
| `DecryptBalanceDialog.tsx` | `handleDecryptWithBrowser` → WASM real implementation |
| `PrivateTransfer.tsx` | `handleSendWithBrowser` → WASM stealth send |
| `ClaimTransfers.tsx` | `claimOne` browser path → WASM claim |
| `vite.config.ts` | `assetsInclude: ['**/*.wasm']`, pvac-wasm chunk |

---

## C++ Bugs Fixed (WASM compatibility)

| File | Bug | Fix |
|---|---|---|
| `lpn.hpp` | `#error` — no software AES | AES-256-CTR pure C++ fallback (`PVAC_USE_SW_AES`) |
| `generators.hpp` | `std::mutex` crash (WASM single-threaded) | `NoOpMutex` for `__EMSCRIPTEN__` |
| `generators.hpp` | `n \|= n >> 32` UB on WASM32 (size_t=32bit) | Guard `sizeof(size_t) > 4` |
| `toeplitz.hpp` | `__builtin_ctzll` not portable | `PVAC_CTZ64` macro |
| `bitvec.hpp` | `__builtin_popcountll` not portable | `PVAC_POPCOUNT64` macro |
| `random.hpp` | No WASM entropy source | `getentropy()` via `__EMSCRIPTEN__` |
| `randombytes.c` | `/dev/urandom` not available in WASM | `getentropy()` for `__EMSCRIPTEN__` |

Apply patches: `bash wasm/patch-for-wasm.sh` then `bash build-wasm.sh`

---

## Fallback Strategy

Semua operasi menggunakan **dual-path**:
1. **PVAC Server** (jika dikonfigurasi) — ~700ms, native speed
2. **Browser WASM** (fallback, selalu tersedia) — ~5-30s, no server needed

Stealth scan adalah **pure TypeScript** — tidak butuh WASM sama sekali.

---

## Build Output

```
pvac_wasm.wasm    658KB  (lazy loaded, hanya saat operasi private pertama)
pvac-wasm.js       70KB  (Emscripten loader, code-split chunk)
```

---

## Web Worker Architecture (UI Non-Blocking)

Semua operasi PVAC berjalan di **Web Worker** terpisah — UI tidak pernah freeze.

```
Main Thread (React UI)              Worker Thread
────────────────────────            ─────────────────────────
pvacOp.runWorker('encrypt', ...)  → pvac-worker.ts
  ↓ PvacProgressBar updates          loads WASM lazily
  ↓ UI stays responsive              runs keygen/encrypt/proof
  ↓ receives progress events    ←── postMessage({ type:'progress' })
  ↓ receives result             ←── postMessage({ type:'result' })
```

**Files:**
- `src/lib/pvac/pvac-worker.ts` — Worker implementation (runs in worker thread)
- `src/lib/pvac/pvac-worker-client.ts` — Client singleton (runs in main thread)
- `src/hooks/usePvacOperation.ts` — React hook with `runWorker()` method

**Build output:**
```
pvac-worker.js    ~1KB   (worker entry, isolated bundle)
pvac-wasm.js      70KB   (WASM loader, lazy-loaded by worker)
pvac_wasm.wasm   658KB   (WASM binary, cached by browser)
```

**bigint serialization:** `postMessage` cannot transfer bigint.
All `amountRaw` values are serialized as strings and converted back in the worker.


- [ ] Optimize WASM dengan `-O3 -flto` untuk performa lebih baik
- [ ] Add Web Worker support untuk non-blocking UI saat proof generation
- [ ] Cache WASM binary di IndexedDB untuk faster subsequent loads
- [ ] Add WASM SIMD support (`-msimd128`) untuk ~2x speedup di browser modern
