# PVAC WebAssembly Build

Compiles the PVAC FHE library to WebAssembly so it can run directly in the browser,
without requiring the native `pvac_server` sidecar process.

## What changed from native

Three files were patched to remove hardware-only dependencies:

| File | Change |
|---|---|
| `pvac/include/pvac/crypto/lpn.hpp` | Added `PVAC_USE_SW_AES` branch with a pure C++ AES-256-CTR implementation instead of `#error` |
| `pvac/include/pvac/crypto/toeplitz.hpp` | Replaced `__builtin_ctzll` with portable `PVAC_CTZ64` macro |
| `pvac/include/pvac/core/bitvec.hpp` | Replaced `__builtin_popcountll` with portable `PVAC_POPCOUNT64` macro |
| `pvac/include/pvac/core/random.hpp` | Added `__EMSCRIPTEN__` branch using `getentropy()` |

All changes are backward-compatible — native builds still use AES-NI/ARM-AES.

## Prerequisites

```bash
# Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh   # or emsdk_env.bat on Windows
```

## Build

```bash
cd main/pvac_server
chmod +x build-wasm.sh
./build-wasm.sh
```

Output in `build-wasm/`:
- `pvac_wasm.js`   — Emscripten JS loader
- `pvac_wasm.wasm` — WebAssembly binary (~2-4 MB)

## Usage in TypeScript

```typescript
import PvacModule from '../build-wasm/pvac_wasm.js'
import { PvacWasm } from './pvac-wasm'

// 1. Load WASM module (once per app lifetime)
const pvac = new PvacWasm()
await pvac.load(PvacModule)

// 2. Init from wallet seed (32 bytes)
const seed = new Uint8Array(32) // derive from wallet private key
pvac.init(seed)

// 3. Encrypt balance
const payload = pvac.buildEncryptPayload(1_000_000n) // 1 OCT in raw units
// payload = { cipher, amount_commitment, zero_proof, blinding }

// 4. Decrypt balance
const balance = pvac.decryptValue(cipher)
console.log('Balance:', balance) // bigint

// 5. Build decrypt payload
const decPayload = pvac.buildDecryptPayload(500_000n, currentCipher)
// decPayload = { cipher, amount_commitment, zero_proof, blinding, range_proof_balance }

// 6. Get PVAC pubkey for node registration
const pubkeyB64 = pvac.getPubkeyB64()
const aesKat    = pvac.aesKat()
```

## Performance Notes

The software AES-256-CTR fallback is ~10-20x slower than hardware AES-NI.
In practice this means:

| Operation | Native (AES-NI) | WASM (SW-AES) |
|---|---|---|
| keygen | ~50ms | ~500ms-1s |
| encrypt | ~100ms | ~1-2s |
| zero proof | ~200ms | ~2-4s |
| range proof | ~500ms | ~5-10s |

These are one-time operations per transaction — acceptable for browser use.
Stealth scan/send/claim (which use Web Crypto API natively) are unaffected.

## Architecture

```
Browser
├── pvac-wasm.ts          ← TypeScript wrapper (this file)
│   └── PvacWasm class    ← mirrors PvacBridge + PvacOps from C++
├── build-wasm/
│   ├── pvac_wasm.js      ← Emscripten loader
│   └── pvac_wasm.wasm    ← compiled PVAC library
└── stealth-ts/           ← pure TS stealth (no WASM needed)
    └── stealth.ts        ← X25519 ECDH + AES-GCM via Web Crypto API
```
