#!/bin/bash
# ============================================================================
# PVAC Server - Linux Release Script
# ============================================================================
# Builds pvac_server and packages it into a tar.gz for distribution.
#
# Usage:
#   bash release-linux.sh
#   bash release-linux.sh 1.2.0
#
# Output:
#   release/pvac_server-linux-x64-<version>.tar.gz
# ============================================================================

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC}  $1"; }
sep()  { echo -e "${BLUE}────────────────────────────────────────────────────${NC}"; }

# ── Resolve version ───────────────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    # Try to read from CMakeLists.txt
    VERSION=$(grep -oP 'project\s*\([^)]*VERSION\s+\K[\d.]+' CMakeLists.txt 2>/dev/null || true)
    VERSION="${VERSION:-0.0.0}"
fi

TARBALL="pvac_server-linux-x64-${VERSION}.tar.gz"
RELEASE_DIR="release"
STAGING_DIR="${RELEASE_DIR}/_staging_linux"

sep
echo -e "${BLUE}  PVAC Server - Linux Release Build${NC}"
echo -e "${BLUE}  Version: ${VERSION}${NC}"
sep
echo ""

# ── Step 1: Check dependencies ────────────────────────────────────────────────
info "Checking build dependencies..."

command -v cmake >/dev/null 2>&1 || err "cmake not found. Install: sudo apt install cmake"
command -v g++   >/dev/null 2>&1 || err "g++ not found. Install: sudo apt install build-essential"
command -v make  >/dev/null 2>&1 || err "make not found. Install: sudo apt install make"

if [ ! -f /usr/include/openssl/ssl.h ] && \
   [ ! -f /usr/local/include/openssl/ssl.h ] && \
   ! pkg-config --exists openssl 2>/dev/null; then
    err "OpenSSL dev headers not found. Install: sudo apt install libssl-dev"
fi

ok "All dependencies found"
echo ""

# ── Step 2: Build ─────────────────────────────────────────────────────────────
sep
info "Building (Release, static)..."
sep

CORES=$(nproc 2>/dev/null || echo 4)

# Clean stale cache if build type changed
if [ -f build/CMakeCache.txt ]; then
    CACHED_TYPE=$(grep "CMAKE_BUILD_TYPE" build/CMakeCache.txt 2>/dev/null | cut -d= -f2 || true)
    if [ "$CACHED_TYPE" != "Release" ]; then
        info "Cleaning stale build cache (was: ${CACHED_TYPE:-unknown})..."
        rm -rf build
    fi
fi

mkdir -p build

cmake -B build -S . \
    -DCMAKE_BUILD_TYPE=Release \
    -DPVAC_STATIC=ON \
    2>&1 | grep -v "^--" || true

echo ""
info "Compiling with $CORES parallel jobs..."
cmake --build build --config Release -j "$CORES"

[ -f build/pvac_server ] || err "Build failed — binary not found at build/pvac_server"
ok "Built: build/pvac_server ($(du -sh build/pvac_server | cut -f1))"
echo ""

# ── Step 3: Collect files ─────────────────────────────────────────────────────
sep
info "Collecting release files..."
sep

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

cp build/pvac_server "$STAGING_DIR/pvac_server"
chmod +x "$STAGING_DIR/pvac_server"
echo "  + pvac_server"

[ -f README.md ] && cp README.md "$STAGING_DIR/README.md" && echo "  + README.md"

echo ""

# ── Step 4: Package ───────────────────────────────────────────────────────────
sep
info "Creating tarball..."
sep

mkdir -p "$RELEASE_DIR"
TARBALL_PATH="${RELEASE_DIR}/${TARBALL}"

tar -czf "$TARBALL_PATH" -C "$STAGING_DIR" .
rm -rf "$STAGING_DIR"

SIZE=$(du -sh "$TARBALL_PATH" | cut -f1)
ok "$TARBALL_PATH ($SIZE)"
echo ""
sep
echo -e "${GREEN}  RELEASE READY${NC}"
sep
echo ""
echo "  $TARBALL_PATH"
echo ""
