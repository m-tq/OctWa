#!/bin/bash

# ============================================================================
# PVAC Server - Automatic Build Script for Linux
# ============================================================================
# Usage: bash build-linux.sh
#
# Requirements:
#   - GCC/G++ with C++17 support (GCC 8+)
#   - CMake 3.15+
#   - OpenSSL development headers (libssl-dev / openssl-devel)
#   - CPU with AES-NI + SSE2 + SSE4.1 support
# ============================================================================

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
info() { echo -e "${BLUE}[INFO]${NC}  $1"; }
sep()  { echo -e "${BLUE}────────────────────────────────────────────────────${NC}"; }

# ── Detect distro + package manager ──────────────────────────────────────────
detect_distro() {
    DISTRO="unknown"
    PKG_MANAGER="unknown"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO="${ID:-unknown}"
    fi
    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop|kali)  PKG_MANAGER="apt"    ;;
        fedora|rhel|centos|rocky|almalinux) PKG_MANAGER="dnf"   ;;
        arch|manjaro|endeavouros)           PKG_MANAGER="pacman" ;;
        opensuse*|sles)                     PKG_MANAGER="zypper" ;;
    esac
}

# ── Install packages ──────────────────────────────────────────────────────────
install_packages() {
    info "Installing: $*"
    case "$PKG_MANAGER" in
        apt)    sudo apt-get update -qq && sudo apt-get install -y "$@" ;;
        dnf)    sudo dnf install -y "$@" ;;
        pacman) sudo pacman -S --noconfirm "$@" ;;
        zypper) sudo zypper install -y "$@" ;;
        *)
            err "Unknown package manager. Install manually: $*"
            exit 1
            ;;
    esac
}

# ── Check dependencies ────────────────────────────────────────────────────────
check_dependencies() {
    sep
    info "Checking dependencies..."
    sep

    local missing=()

    # CMake
    if command -v cmake &>/dev/null; then
        ok "CMake $(cmake --version | head -n1 | awk '{print $3}')"
    else
        warn "CMake not found"
        missing+=("cmake")
    fi

    # GCC/G++
    if command -v g++ &>/dev/null; then
        ok "G++ $(g++ --version | head -n1 | awk '{print $NF}')"
    else
        warn "G++ not found"
        case "$PKG_MANAGER" in
            apt)    missing+=("build-essential") ;;
            dnf)    missing+=("gcc-c++" "make") ;;
            pacman) missing+=("base-devel") ;;
            *)      missing+=("gcc-c++") ;;
        esac
    fi

    # Make
    if command -v make &>/dev/null; then
        ok "Make $(make --version | head -n1)"
    else
        warn "Make not found"
        missing+=("make")
    fi

    # OpenSSL dev headers
    if [ -f /usr/include/openssl/ssl.h ] || \
       [ -f /usr/local/include/openssl/ssl.h ] || \
       pkg-config --exists openssl 2>/dev/null; then
        ok "OpenSSL development headers found"
    else
        warn "OpenSSL development headers not found"
        case "$PKG_MANAGER" in
            apt)    missing+=("libssl-dev") ;;
            dnf)    missing+=("openssl-devel") ;;
            pacman) missing+=("openssl") ;;
            zypper) missing+=("libopenssl-devel") ;;
            *)      missing+=("openssl-devel") ;;
        esac
    fi

    # pkg-config
    if command -v pkg-config &>/dev/null; then
        ok "pkg-config found"
    else
        warn "pkg-config not found"
        missing+=("pkg-config")
    fi

    echo ""

    if [ ${#missing[@]} -gt 0 ]; then
        warn "Missing: ${missing[*]}"
        echo ""
        read -rp "Install missing dependencies now? (y/n) " reply
        echo ""
        if [[ "$reply" =~ ^[Yy]$ ]]; then
            install_packages "${missing[@]}"
            ok "Dependencies installed"
        else
            err "Cannot build without required dependencies."
            exit 1
        fi
    else
        ok "All dependencies satisfied"
    fi
    echo ""
}

# ── Check CPU features ────────────────────────────────────────────────────────
check_cpu_features() {
    sep
    info "Checking CPU features (required: AES-NI, SSE2, SSE4.1)..."
    sep

    local missing_features=()

    if grep -q "aes" /proc/cpuinfo 2>/dev/null; then
        ok "AES-NI supported"
    else
        warn "AES-NI NOT detected — PVAC requires hardware AES acceleration"
        missing_features+=("AES-NI")
    fi

    if grep -q "sse2" /proc/cpuinfo 2>/dev/null; then
        ok "SSE2 supported"
    else
        warn "SSE2 NOT detected"
        missing_features+=("SSE2")
    fi

    if grep -q "sse4_1" /proc/cpuinfo 2>/dev/null; then
        ok "SSE4.1 supported"
    else
        warn "SSE4.1 NOT detected"
        missing_features+=("SSE4.1")
    fi

    echo ""

    if [ ${#missing_features[@]} -gt 0 ]; then
        warn "Missing CPU features: ${missing_features[*]}"
        warn "Build may succeed but PVAC operations will fail at runtime."
        read -rp "Continue anyway? (y/n) " reply
        echo ""
        if [[ ! "$reply" =~ ^[Yy]$ ]]; then
            err "Aborted."
            exit 1
        fi
    fi
}

# ── Build ─────────────────────────────────────────────────────────────────────
build_project() {
    sep
    info "Building PVAC Server (Release)..."
    sep

    local cores
    cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

    # Clean stale build if it was configured differently
    if [ -f build/CMakeCache.txt ]; then
        local cached_type
        cached_type=$(grep "CMAKE_BUILD_TYPE" build/CMakeCache.txt 2>/dev/null | cut -d= -f2 || true)
        if [ "$cached_type" != "Release" ]; then
            info "Cleaning stale build cache (was: ${cached_type:-unknown})..."
            rm -rf build
        fi
    fi

    mkdir -p build

    info "Configuring with CMake..."
    cmake -B build -S . \
        -DCMAKE_BUILD_TYPE=Release \
        2>&1 | grep -v "^--" || true

    echo ""
    info "Compiling with $cores parallel jobs..."
    cmake --build build --config Release -j "$cores"

    echo ""

    if [ -f build/pvac_server ]; then
        ok "Build complete: build/pvac_server"
    else
        err "Build failed — binary not found at build/pvac_server"
        exit 1
    fi
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    clear
    sep
    echo -e "${BLUE}  PVAC Server - Build Script for Linux${NC}"
    sep
    echo ""

    detect_distro
    info "Distro: $DISTRO  |  Package manager: $PKG_MANAGER"
    echo ""

    check_dependencies
    check_cpu_features
    build_project

    sep
    echo -e "${GREEN}  BUILD SUCCESS!${NC}"
    sep
    echo ""
    ok "Binary: $(pwd)/build/pvac_server"
    echo ""
    echo "Endpoints available after start:"
    echo "  POST /api/ensure_pvac_registered"
    echo "  POST /api/encrypt_balance"
    echo "  POST /api/decrypt_to_public"
    echo "  POST /api/stealth_send"
    echo "  POST /api/claim_stealth"
    echo "  POST /api/scan_stealth"
    echo ""
    echo "To run:"
    echo -e "  ${GREEN}./build/pvac_server [port]${NC}   (default port: 8765)"
    echo ""

    read -rp "Run server now on port 8765? (y/n, default=y) " reply
    echo ""
    if [[ "$reply" =~ ^[Yy]$ ]] || [ -z "$reply" ]; then
        info "Starting PVAC server on port 8765... (Ctrl+C to stop)"
        echo ""
        ./build/pvac_server 8765
        echo ""
        warn "Server stopped."
    fi
}

main
