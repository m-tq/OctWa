#!/usr/bin/env bash
# patch-for-wasm.sh — Apply WASM compatibility patches to pvac headers.
# Run from main/pvac_server/ before building with build-wasm.sh.
# Idempotent — safe to run multiple times.
#
# Patches applied:
#   1. lpn.hpp          — software AES-256-CTR fallback (replaces #error)
#   2. toeplitz.hpp     — portable PVAC_CTZ64 macro
#   3. bitvec.hpp       — portable PVAC_POPCOUNT64 macro
#   4. random.hpp       — EMSCRIPTEN getentropy() entropy source
#   5. generators.hpp   — NoOpMutex (WASM single-threaded) + SIZE_MAX guard

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PVAC_DIR="$SCRIPT_DIR/../pvac/include/pvac"

echo "[patch] Checking pvac headers..."

# ── 1. lpn.hpp — software AES-256-CTR fallback ───────────────────────────────
LPN="$PVAC_DIR/crypto/lpn.hpp"
if grep -q 'PVAC_USE_SW_AES' "$LPN" 2>/dev/null; then
    echo "[patch] lpn.hpp: already patched"
else
    echo "[patch] lpn.hpp: applying software AES fallback..."
    python3 "$SCRIPT_DIR/patch_lpn_impl.py" "$LPN"
    echo "[patch] lpn.hpp: done"
fi

# ── 2. toeplitz.hpp — portable ctzll ─────────────────────────────────────────
TOEPLITZ="$PVAC_DIR/crypto/toeplitz.hpp"
if grep -q 'PVAC_CTZ64' "$TOEPLITZ" 2>/dev/null; then
    echo "[patch] toeplitz.hpp: already patched"
else
    echo "[patch] toeplitz.hpp: applying portable ctzll..."
    python3 - "$TOEPLITZ" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    c = f.read()
header = '''#pragma once
// PVAC_CTZ64: portable count-trailing-zeros
#if defined(__GNUC__) || defined(__clang__)
#  define PVAC_CTZ64(x) __builtin_ctzll((unsigned long long)(x))
#else
static inline int pvac_ctz64_fb(uint64_t x) {
    if (!x) return 64; int n=0;
    if (!(x&0xFFFFFFFFULL)){n+=32;x>>=32;} if (!(x&0x0000FFFFULL)){n+=16;x>>=16;}
    if (!(x&0x00FFULL)){n+=8;x>>=8;} if (!(x&0x0FULL)){n+=4;x>>=4;}
    if (!(x&0x3ULL)){n+=2;x>>=2;} if (!(x&0x1ULL)){n+=1;} return n;
}
#  define PVAC_CTZ64(x) pvac_ctz64_fb((uint64_t)(x))
#endif
'''
c = c.replace('#pragma once', header.strip(), 1)
c = c.replace('__builtin_ctzll', 'PVAC_CTZ64')
with open(path, 'w') as f:
    f.write(c)
print(f'  patched: {path}')
PYEOF
    echo "[patch] toeplitz.hpp: done"
fi

# ── 3. bitvec.hpp — portable popcountll ──────────────────────────────────────
BITVEC="$PVAC_DIR/core/bitvec.hpp"
if grep -q 'PVAC_POPCOUNT64' "$BITVEC" 2>/dev/null; then
    echo "[patch] bitvec.hpp: already patched"
else
    echo "[patch] bitvec.hpp: applying portable popcountll..."
    python3 - "$BITVEC" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    c = f.read()
header = '''#pragma once
// PVAC_POPCOUNT64: portable popcount
#if defined(__GNUC__) || defined(__clang__)
#  define PVAC_POPCOUNT64(x) __builtin_popcountll((unsigned long long)(x))
#else
static inline int pvac_popcount64_fb(uint64_t x) {
    x=x-((x>>1)&0x5555555555555555ULL);
    x=(x&0x3333333333333333ULL)+((x>>2)&0x3333333333333333ULL);
    x=(x+(x>>4))&0x0f0f0f0f0f0f0f0fULL;
    return (int)((x*0x0101010101010101ULL)>>56);
}
#  define PVAC_POPCOUNT64(x) pvac_popcount64_fb((uint64_t)(x))
#endif
'''
c = c.replace('#pragma once', header.strip(), 1)
c = c.replace('__builtin_popcountll', 'PVAC_POPCOUNT64')
with open(path, 'w') as f:
    f.write(c)
print(f'  patched: {path}')
PYEOF
    echo "[patch] bitvec.hpp: done"
fi

# ── 4. random.hpp — EMSCRIPTEN getentropy ────────────────────────────────────
RANDOM="$PVAC_DIR/core/random.hpp"
if grep -q '__EMSCRIPTEN__' "$RANDOM" 2>/dev/null; then
    echo "[patch] random.hpp: already patched"
else
    echo "[patch] random.hpp: applying EMSCRIPTEN entropy patch..."
    python3 - "$RANDOM" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    c = f.read().replace('\r\n', '\n').replace('\r', '\n')

new_content = '''#pragma once

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <algorithm>

#if defined(__EMSCRIPTEN__)
    #include <unistd.h>  // getentropy
#elif defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
    #include <stdlib.h>
#elif defined(__linux__)
    #include <unistd.h>
    #include <sys/random.h>
    #include <fcntl.h>
    #include <errno.h>
#elif defined(_WIN32)
    #define NOMINMAX
    #include <windows.h>
    #include <bcrypt.h>
    #pragma comment(lib, "bcrypt.lib")
#else
    #include <random>
#endif

namespace pvac {

inline uint64_t load_le64(const uint8_t * p) {
    uint64_t x = 0;
    for (int i = 0; i < 8; i++) x |= (uint64_t)p[i] << (8 * i);
    return x;
}

inline void store_le64(uint8_t * p, uint64_t x) {
    for (int i = 0; i < 8; i++) p[i] = (uint8_t)((x >> (8 * i)) & 0xFF);
}

inline void csprng_bytes(uint8_t * out, size_t n) {
#if defined(__EMSCRIPTEN__)
    if (::getentropy(out, n) != 0) { std::abort(); }

#elif defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
    arc4random_buf(out, n);

#elif defined(__linux__)
    size_t off = 0;
    while (off < n) {
        ssize_t r = getrandom(out + off, n - off, 0);
        if (r > 0) { off += r; continue; }
        if (r < 0 && errno == EINTR) { continue; }
        int fd = ::open("/dev/urandom", O_RDONLY);
        if (fd < 0) { std::abort(); }
        while (off < n) {
            ssize_t z = ::read(fd, out + off, n - off);
            if (z > 0) { off += z; continue; }
            if (z < 0 && errno == EINTR) { continue; }
            break;
        }
        ::close(fd);
        break;
    }
    if (off != n) { std::abort(); }

#elif defined(_WIN32)
    NTSTATUS st = BCryptGenRandom(NULL, out, (ULONG)n, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (st != 0) { std::abort(); }

#else
    std::random_device rd;
    size_t off = 0;
    while (off < n) {
        uint64_t x   = ((uint64_t)rd() << 32) ^ rd();
        size_t   take = std::min((size_t)8, n - off);
        std::memcpy(out + off, &x, take);
        off += take;
    }
#endif
}

inline uint64_t csprng_u64() {
    uint8_t b[8];
    csprng_bytes(b, 8);
    return load_le64(b);
}

}
'''
with open(path, 'w', newline='\n') as f:
    f.write(new_content)
print(f'  patched: {path}')
PYEOF
    echo "[patch] random.hpp: done"
fi

echo ""
echo "[patch] All patches applied. Ready to build WASM."
echo "        Run: bash build-wasm.sh"

# -- 5. generators.hpp -- NoOpMutex + SIZE_MAX guard --------------------------
GENERATORS=" \/crypto/bulletproofs/generators.hpp\
if
