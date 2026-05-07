#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-wasm.sh — Build pvac_wasm.mjs + pvac_wasm.wasm via Emscripten
#
# Prerequisites:
#   - Emscripten SDK installed and activated (emcc in PATH)
#     https://emscripten.org/docs/getting_started/downloads.html
#   - Run from: main/pvac_server/
#
# Usage:
#   ./build-wasm.sh              # Release build (SIMD enabled)
#   ./build-wasm.sh --debug      # Debug build (larger, with assertions)
#
# From WSL (Windows):
#   wsl -d Ubuntu-22.04 -- bash /mnt/c/.../main/pvac_server/build-wasm.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Activate emsdk if not already active
if ! command -v emcc &>/dev/null; then
    if [ -f ~/emsdk/emsdk_env.sh ]; then
        source ~/emsdk/emsdk_env.sh 2>/dev/null || true
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_TYPE="Release"
EXTRA_FLAGS=""
ASSERTIONS_FLAG="-s ASSERTIONS=0"

if [[ "${1:-}" == "--debug" ]]; then
    BUILD_TYPE="Debug"
    EXTRA_FLAGS="-g"
    ASSERTIONS_FLAG="-s ASSERTIONS=2"
    echo "[wasm] Debug build"
else
    echo "[wasm] Release build (SIMD)"
fi

OUT_DIR="$SCRIPT_DIR/build-wasm"
mkdir -p "$OUT_DIR"

# Force clean output
rm -f "$OUT_DIR/pvac_wasm.mjs" "$OUT_DIR/pvac_wasm.wasm"

echo "[wasm] emcc version: $(emcc --version | head -1)"
echo "[wasm] OUT_DIR: $OUT_DIR"
echo ""

# ── SIMD + optimization flags ─────────────────────────────────────────────────
# -msimd128        : Enable WebAssembly SIMD (128-bit vectors) — critical for AES perf
# -O3              : Maximum optimization (vs -O2)
# -ffast-math      : Aggressive float opts (safe for integer crypto)
SIMD_FLAGS="-msimd128 -O3 -ffast-math"

# ── Exported C functions (full set for all browser operations) ───────────────
# With WASM_BIGINT=1, Emscripten supports native i64 via JS BigInt.
# We can call uint64_t functions directly — no lo/hi bridge needed.
# Bridge functions (pvac_js_*) are kept for compatibility but originals are used.
EXPORTS='["_pvac_default_params","_pvac_keygen_from_seed","_pvac_enc_value_seeded","_pvac_dec_value_fp","_pvac_ct_sub","_pvac_commit_ct","_pvac_make_zero_proof_bound","_pvac_pedersen_commit","_pvac_make_range_proof","_pvac_serialize_range_proof","_pvac_free_range_proof","_pvac_make_aggregated_range_proof","_pvac_serialize_agg_range_proof","_pvac_free_agg_range_proof","_pvac_serialize_cipher","_pvac_deserialize_cipher","_pvac_serialize_pubkey","_pvac_serialize_zero_proof","_pvac_free_params","_pvac_free_pubkey","_pvac_free_seckey","_pvac_free_cipher","_pvac_free_zero_proof","_pvac_free_bytes","_pvac_aes_kat","_pvac_js_enc_value_seeded","_pvac_js_make_zero_proof_bound","_pvac_js_pedersen_commit","_pvac_js_make_range_proof","_pvac_js_make_aggregated_range_proof","_malloc","_free"]'

RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAPU8","HEAP32","HEAPU32"]'

# ── Compile C files ───────────────────────────────────────────────────────────
echo "[wasm] Compiling C files..."

emcc \
    $SIMD_FLAGS \
    -I"$SCRIPT_DIR/pvac/include" \
    -I"$SCRIPT_DIR/lib" \
    -c "$SCRIPT_DIR/lib/tweetnacl.c" -o "$OUT_DIR/tweetnacl.o" 2>&1

emcc \
    $SIMD_FLAGS \
    -I"$SCRIPT_DIR/pvac/include" \
    -I"$SCRIPT_DIR/lib" \
    -c "$SCRIPT_DIR/lib/randombytes.c" -o "$OUT_DIR/randombytes.o" 2>&1

# JS bridge: uint64 wrappers (lo/hi uint32 pairs) for Emscripten ccall compat
emcc \
    $SIMD_FLAGS \
    -I"$SCRIPT_DIR/pvac" \
    -I"$SCRIPT_DIR/pvac/include" \
    -I"$SCRIPT_DIR/lib" \
    -c "$SCRIPT_DIR/wasm/pvac_wasm_bridge.c" -o "$OUT_DIR/pvac_wasm_bridge.o" 2>&1

# ── Compile C++ files ─────────────────────────────────────────────────────────
echo "[wasm] Compiling C++ files..."

emcc \
    -std=c++17 \
    $SIMD_FLAGS \
    -DNDEBUG \
    -Wno-shift-count-overflow \
    $EXTRA_FLAGS \
    -I"$SCRIPT_DIR/pvac/include" \
    -I"$SCRIPT_DIR/lib" \
    -c "$SCRIPT_DIR/pvac/pvac_c_api.cpp" -o "$OUT_DIR/pvac_c_api.o" 2>&1

# ── Link ──────────────────────────────────────────────────────────────────────
echo "[wasm] Linking..."

emcc \
    "$OUT_DIR/pvac_c_api.o" \
    "$OUT_DIR/tweetnacl.o" \
    "$OUT_DIR/randombytes.o" \
    "$OUT_DIR/pvac_wasm_bridge.o" \
    $SIMD_FLAGS \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="PvacModule" \
    -s EXPORTED_FUNCTIONS="$EXPORTS" \
    -s EXPORTED_RUNTIME_METHODS="$RUNTIME_METHODS" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=134217728 \
    -s MAXIMUM_MEMORY=2147483648 \
    -s STACK_SIZE=33554432 \
    -s MALLOC=dlmalloc \
    -s NO_EXIT_RUNTIME=1 \
    -s ENVIRONMENT='web,worker,node' \
    -s EXPORT_ES6=1 \
    -s WASM_BIGINT=1 \
    $ASSERTIONS_FLAG \
    -s SINGLE_FILE=0 \
    $EXTRA_FLAGS \
    -o "$OUT_DIR/pvac_wasm.mjs" \
    2>&1

echo ""
echo "[wasm] ✓ Build complete:"
ls -lh "$OUT_DIR/pvac_wasm.mjs" "$OUT_DIR/pvac_wasm.wasm"
echo ""
echo "[wasm] SIMD opcode count:"
node -e "
const fs = require('fs');
const w = fs.readFileSync('$OUT_DIR/pvac_wasm.wasm');
let n = 0; for (let i = 0; i < w.length-1; i++) if (w[i]===0xFD) n++;
console.log('  0xFD opcodes:', n, n > 1000 ? '(SIMD active)' : '(SIMD minimal - check flags)');
" 2>/dev/null || true
echo ""
echo "[wasm] Output files:"
echo "  $OUT_DIR/pvac_wasm.mjs    — ES module loader (import this)"
echo "  $OUT_DIR/pvac_wasm.wasm   — WebAssembly binary"
