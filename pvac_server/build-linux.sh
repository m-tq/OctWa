#!/bin/bash

# ============================================================================
# PVAC Server - Automatic Build Script for Linux
# ============================================================================
# This script will:
# 1. Detect your Linux distribution
# 2. Check for required dependencies
# 3. Auto-install missing dependencies (with sudo permission)
# 4. Build the PVAC server
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        DISTRO_VERSION=$VERSION_ID
    elif [ -f /etc/lsb-release ]; then
        . /etc/lsb-release
        DISTRO=$DISTRIB_ID
        DISTRO_VERSION=$DISTRIB_RELEASE
    else
        DISTRO="unknown"
    fi
    
    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop)
            PKG_MANAGER="apt"
            ;;
        fedora|rhel|centos|rocky|almalinux)
            PKG_MANAGER="dnf"
            ;;
        arch|manjaro|endeavouros)
            PKG_MANAGER="pacman"
            ;;
        opensuse*|sles)
            PKG_MANAGER="zypper"
            ;;
        *)
            PKG_MANAGER="unknown"
            ;;
    esac
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if package is installed (Debian/Ubuntu)
is_installed_apt() {
    dpkg -l "$1" 2>/dev/null | grep -q "^ii"
}

# Check if package is installed (Fedora/RHEL)
is_installed_dnf() {
    rpm -q "$1" >/dev/null 2>&1
}

# Check if package is installed (Arch)
is_installed_pacman() {
    pacman -Q "$1" >/dev/null 2>&1
}

# Install packages based on distribution
install_packages() {
    local packages="$1"
    
    print_info "Installing: $packages"
    
    case "$PKG_MANAGER" in
        apt)
            sudo apt update
            sudo apt install -y $packages
            ;;
        dnf)
            sudo dnf install -y $packages
            ;;
        pacman)
            sudo pacman -S --noconfirm $packages
            ;;
        zypper)
            sudo zypper install -y $packages
            ;;
        *)
            print_error "Unknown package manager. Please install manually: $packages"
            exit 1
            ;;
    esac
}

# Check and install dependencies
check_dependencies() {
    print_header "Checking Dependencies"
    
    local missing_deps=()
    local install_cmd=""
    
    # Check CMake
    if command_exists cmake; then
        CMAKE_VERSION=$(cmake --version | head -n1 | awk '{print $3}')
        print_success "CMake found (version $CMAKE_VERSION)"
    else
        print_warning "CMake not found"
        missing_deps+=("cmake")
    fi
    
    # Check GCC/G++
    if command_exists g++; then
        GCC_VERSION=$(g++ --version | head -n1 | awk '{print $3}')
        print_success "G++ found (version $GCC_VERSION)"
    else
        print_warning "G++ not found"
        case "$PKG_MANAGER" in
            apt) missing_deps+=("build-essential") ;;
            dnf) missing_deps+=("gcc-c++") ;;
            pacman) missing_deps+=("base-devel") ;;
            *) missing_deps+=("gcc") ;;
        esac
    fi
    
    # Check Make
    if command_exists make; then
        print_success "Make found"
    else
        print_warning "Make not found"
        if [ "$PKG_MANAGER" != "apt" ]; then
            missing_deps+=("make")
        fi
    fi
    
    # Check OpenSSL development files
    print_info "Checking OpenSSL development files..."
    if [ "$PKG_MANAGER" = "apt" ]; then
        if is_installed_apt "libssl-dev"; then
            print_success "OpenSSL development files found"
        else
            print_warning "OpenSSL development files not found"
            missing_deps+=("libssl-dev")
        fi
    elif [ "$PKG_MANAGER" = "dnf" ]; then
        if is_installed_dnf "openssl-devel"; then
            print_success "OpenSSL development files found"
        else
            print_warning "OpenSSL development files not found"
            missing_deps+=("openssl-devel")
        fi
    elif [ "$PKG_MANAGER" = "pacman" ]; then
        if is_installed_pacman "openssl"; then
            print_success "OpenSSL development files found"
        else
            print_warning "OpenSSL development files not found"
            missing_deps+=("openssl")
        fi
    else
        # Generic check
        if [ -f /usr/include/openssl/ssl.h ] || [ -f /usr/local/include/openssl/ssl.h ]; then
            print_success "OpenSSL development files found"
        else
            print_warning "OpenSSL development files not found"
            missing_deps+=("openssl-devel")
        fi
    fi
    
    # Check pkg-config
    if command_exists pkg-config; then
        print_success "pkg-config found"
    else
        print_warning "pkg-config not found"
        missing_deps+=("pkg-config")
    fi
    
    # Install missing dependencies
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo ""
        print_warning "Missing dependencies detected: ${missing_deps[*]}"
        echo ""
        read -p "Do you want to install missing dependencies? (y/n) " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            install_packages "${missing_deps[*]}"
            print_success "Dependencies installed successfully"
        else
            print_error "Cannot proceed without required dependencies"
            exit 1
        fi
    else
        print_success "All dependencies are satisfied"
    fi
    
    echo ""
}

# Check CPU features
check_cpu_features() {
    print_header "Checking CPU Features"
    
    if [ -f /proc/cpuinfo ]; then
        if grep -q "aes" /proc/cpuinfo; then
            print_success "AES-NI support detected"
        else
            print_warning "AES-NI not detected (required for PVAC)"
        fi
        
        if grep -q "sse2" /proc/cpuinfo; then
            print_success "SSE2 support detected"
        else
            print_warning "SSE2 not detected (required for PVAC)"
        fi
        
        if grep -q "sse4_1" /proc/cpuinfo; then
            print_success "SSE4.1 support detected"
        else
            print_warning "SSE4.1 not detected (required for PVAC)"
        fi
    else
        print_warning "Cannot detect CPU features"
    fi
    
    echo ""
}

# Build the project
build_project() {
    print_header "Building PVAC Server"
    
    # Create build directory
    print_info "Creating build directory..."
    mkdir -p build
    cd build
    
    # Configure with CMake
    print_info "Configuring with CMake..."
    cmake .. || {
        print_error "CMake configuration failed"
        exit 1
    }
    
    # Build
    print_info "Compiling (using $(nproc) cores)..."
    make -j$(nproc) || {
        print_error "Compilation failed"
        exit 1
    }
    
    cd ..
    
    print_success "Build completed successfully!"
    echo ""
}

# Main script
main() {
    clear
    print_header "PVAC Server - Automatic Build Script"
    echo ""
    
    # Detect distribution
    detect_distro
    print_info "Detected: $DISTRO (Package Manager: $PKG_MANAGER)"
    echo ""
    
    # Check dependencies
    check_dependencies
    
    # Check CPU features
    check_cpu_features
    
    # Build
    build_project
    
    # Success message
    print_header "Build Complete!"
    echo ""
    print_success "PVAC Server has been built successfully!"
    echo ""
    echo "To run the server:"
    echo "  ${GREEN}cd build${NC}"
    echo "  ${GREEN}./pvac_server [port]${NC}"
    echo ""
    echo "Default port: 8765"
    echo ""
    print_info "Example: ./pvac_server 8765"
    echo ""
}

# Run main function
main
