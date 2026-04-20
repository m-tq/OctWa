# PVAC Server

High-performance C++ server for Private Verifiable Anonymous Computation operations.

## Quick Start

### Linux - One-Click Build

The easiest way to build on Linux:

```bash
chmod +x auto-build.sh
./auto-build.sh
```

This script will:
- ✅ Detect your Linux distribution automatically
- ✅ Check for required dependencies (CMake, GCC, OpenSSL, etc.)
- ✅ Auto-install missing dependencies (with your permission)
- ✅ Verify CPU features (AES-NI, SSE2, SSE4.1)
- ✅ Build the server using all available CPU cores

Supported distributions:
- Ubuntu / Debian / Linux Mint / Pop!_OS
- Fedora / RHEL / CentOS / Rocky / AlmaLinux
- Arch / Manjaro / EndeavourOS
- openSUSE / SLES

### Manual Build

#### Linux

```bash
chmod +x build.sh
./build.sh
```

#### Windows

```powershell
.\build-windows.ps1
```

## Requirements

### Linux
- CMake 3.15+
- GCC/G++ with C++17 support
- OpenSSL development files
- Make
- CPU with AES-NI, SSE2, and SSE4.1 support

### Windows
- CMake 3.15+
- Visual Studio 2019+ or MinGW-w64
- OpenSSL (automatically handled by vcpkg in build script)

## Running

After building:

```bash
cd build
./pvac_server [port]
```

Default port: `8765`

Example:
```bash
./pvac_server 8765
```

## Architecture

The server provides HTTP endpoints for:
- PVAC encryption/decryption operations
- Zero-knowledge proofs
- Range proofs
- Stealth address operations
- Transaction building

## API Endpoints

See the main documentation for API details.

## Development

### Debug Build

```bash
mkdir -p build
cd build
cmake -DCMAKE_BUILD_TYPE=Debug ..
make -j$(nproc)
```

Debug builds include AddressSanitizer and UndefinedBehaviorSanitizer.

### Project Structure

```
pvac_server/
├── src/           # Server implementation
├── lib/           # Third-party libraries (httplib, tweetnacl, etc.)
├── pvac/          # PVAC cryptographic library
├── build/         # Build output (gitignored)
├── auto-build.sh  # Automatic build script for Linux
├── build.sh       # Manual build script for Linux
└── build-windows.ps1  # Build script for Windows
```

## Troubleshooting

### Missing Dependencies

If you encounter missing dependencies, the `auto-build.sh` script will detect and offer to install them automatically.

For manual installation:

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install build-essential cmake libssl-dev pkg-config
```

**Fedora/RHEL:**
```bash
sudo dnf install gcc-c++ cmake openssl-devel pkg-config
```

**Arch:**
```bash
sudo pacman -S base-devel cmake openssl pkg-config
```

### CPU Feature Requirements

The PVAC library requires:
- AES-NI (hardware AES acceleration)
- SSE2
- SSE4.1

Most modern x86_64 CPUs support these features. Check with:
```bash
grep -E "aes|sse2|sse4_1" /proc/cpuinfo
```

### Build Errors

If the build fails:
1. Ensure all dependencies are installed
2. Check that your CPU supports required features
3. Try a clean build:
   ```bash
   rm -rf build
   ./auto-build.sh
   ```

## License

See main project LICENSE file.
