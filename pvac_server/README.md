# pvac-local-server

> **⬇️ Ready-to-run binaries:** [github.com/m-tq/OctWa/releases/tag/pvac_server](https://github.com/m-tq/OctWa/releases/tag/pvac_server)
> **📖 Source & build guide:** [github.com/m-tq/OctWa/tree/master/pvac_server](https://github.com/m-tq/OctWa/tree/master/pvac_server)

Native C++ sidecar for OctWa wallet — handles heavy PVAC cryptographic operations
that require hardware AES-NI (range proofs, stealth send, decrypt-to-public).

## What it does

| Endpoint | Operation | Time |
|---|---|---|
| `POST /decrypt_to_public` | Aggregated range proof for balance | ~4-20 min |
| `POST /stealth_send` | Two parallel range proofs | ~8-40 min |
| `GET /health` | Liveness check | <1ms |

Binds to `127.0.0.1:9090` only (localhost). No auth token needed.

---

## Quick Start

### Windows (Strawberry Perl / MinGW)

```powershell
.\build-windows.ps1
```

Output: `build\pvac_server.exe` — single static binary, no DLL dependencies.

### Linux

```bash
chmod +x build-linux.sh
./build-linux.sh
```

Output: `build/pvac_server` — single static binary.

### Run

```
pvac_server.exe          # Windows, default port 9090
pvac_server.exe 9090     # explicit port
./pvac_server            # Linux
```

---

## Build Requirements

### Windows
- **Strawberry Perl** (recommended) — includes MinGW-w64 + OpenSSL
  https://strawberryperl.com/
- CMake 3.15+

### Linux
- GCC/G++ with C++17
- OpenSSL dev (`libssl-dev` / `openssl-devel`)
- CMake 3.15+

### CPU
- x86_64 with AES-NI, SSE2, SSE4.1 (all modern Intel/AMD CPUs since ~2010)

---

## Distribution (Windows)

The build produces **2 files** in `build/` — copy both to distribute:

| File | Size | Description |
|---|---|---|
| `pvac_server.exe` | ~1.9 MB | Main server binary |
| `libcrypto-3-x64__.dll` | ~4.8 MB | OpenSSL runtime (auto-bundled by build) |

**Why 2 files?** Strawberry Perl's OpenSSL ships as a DLL-only build (its `libcrypto.a`
is an import library, not a true static archive). A fully single-file build would
require compiling OpenSSL from source with `-static` — the build script handles
bundling the DLL automatically so users just copy the `build/` folder.

All other dependencies (`KERNEL32.dll`, `WS2_32.dll`, `bcrypt.dll`,
`api-ms-win-crt-*.dll`) are Windows system DLLs present on every Windows 10/11.

### Linux
On Linux, the binary links `libstdc++` and `libgcc` statically. Only `glibc`
remains dynamic (always present). Single file distribution.

---

## API Reference

### `GET /health`

```json
{
  "status": "ok",
  "version": "2.0.0",
  "service": "pvac-local-server",
  "threads": 9,
  "cores": 12
}
```

### `POST /decrypt_to_public`

Request:
```json
{
  "private_key":     "base64-encoded 32-byte seed or 64-byte sk",
  "public_key":      "base64 or hex 32-byte Ed25519 pubkey",
  "address":         "octXXX...",
  "amount":          "50000000",
  "current_cipher":  "hfhe_v1|...",
  "current_balance": "160000000",
  "nonce":           8,
  "ou":              "10000",
  "timestamp":       1234567890.123,
  "rpc_url":         "http://46.101.86.250:8080"
}
```

Response:
```json
{
  "success": true,
  "tx": { "from": "...", "to_": "...", "amount": "50000000", ... }
}
```

### `POST /stealth_send`

Request:
```json
{
  "private_key":           "base64...",
  "public_key":            "base64...",
  "from_address":          "octXXX...",
  "to_address":            "octYYY...",
  "amount":                "50000000",
  "current_cipher":        "hfhe_v1|...",
  "recipient_view_pubkey": "base64 32-byte Curve25519 pubkey",
  "nonce":                 8,
  "ou":                    "5000",
  "timestamp":             1234567890.123,
  "rpc_url":               "http://46.101.86.250:8080"
}
```

Response:
```json
{
  "success": true,
  "tx": { "from": "...", "to_": "stealth", "amount": "0", ... }
}
```

---

## Key Design Decisions

### Cipher trust
The server trusts `current_cipher` from the browser — the browser already fetches
fresh cipher from the node before calling. Server-side re-fetch was removed because
it could return a different wallet's cipher on shared nodes.

### Nonce
The server uses the nonce sent by the browser. The browser fetches fresh nonce
(`fetchBalance(address, true)`) immediately before calling the server.

### Balance hint
`current_balance` is passed from the browser (WASM-decrypted) to avoid the server
re-decrypting the cipher. If the cipher changed on-chain, the hint is ignored and
the server decrypts the fresh cipher itself.

### Parallel execution
- `decrypt_to_public`: encrypt(amount) runs while balance is read (saves ~5s)
- `stealth_send`: both range proofs run concurrently (halves wall-clock time)

---

## WASM Patches (for browser build)

The PVAC library requires patches for WebAssembly compatibility.
Run before `build-wasm.sh`:

```bash
bash wasm/patch-for-wasm.sh
bash build-wasm.sh
```

Patches applied:
- `lpn.hpp` — software AES-256-CTR fallback (no AES-NI in WASM)
- `toeplitz.hpp` — portable `PVAC_CTZ64` macro
- `bitvec.hpp` — portable `PVAC_POPCOUNT64` macro
- `random.hpp` — `getentropy()` entropy source for WASM
- `generators.hpp` — `NoOpMutex` (WASM single-threaded) + `SIZE_MAX` guard

---

## Project Structure

```
pvac_server/
├── src/
│   ├── main.cpp              # HTTP server, endpoints, nonce/cipher logic
│   ├── pvac_ops.hpp          # PvacOps wrapper, ProofCacheEntry
│   └── pvac_ops_parallel.hpp # Parallel decrypt + stealth implementations
├── lib/
│   ├── pvac_bridge.hpp       # C++ wrapper around pvac_c_api (from webcli)
│   ├── stealth.hpp           # Stealth crypto (ECDH, AES-GCM) (from webcli)
│   ├── tx_builder.hpp        # Transaction signing (from webcli)
│   ├── httplib.h             # cpp-httplib single-header HTTP server
│   ├── json.hpp              # nlohmann/json single-header
│   ├── tweetnacl.c/h         # Ed25519/X25519 crypto
│   └── randombytes.c         # Entropy source
├── pvac/
│   ├── pvac_c_api.h          # PVAC C API declarations
│   ├── pvac_c_api.cpp        # PVAC C API implementation
│   └── include/              # PVAC library headers
├── wasm/
│   ├── pvac-wasm.ts          # TypeScript WASM wrapper
│   ├── pvac_wasm_bridge.c    # JS-friendly uint64 bridge functions
│   ├── patch-for-wasm.sh     # Apply WASM compatibility patches
│   └── README.md             # WASM build guide
├── crypto_utils.hpp          # Crypto utilities (from webcli)
├── CMakeLists.txt            # Build configuration
├── build-windows.ps1         # Windows build script
├── build-linux.sh            # Linux build script
├── build-wasm.sh             # WASM build script
└── README.md                 # This file
```
