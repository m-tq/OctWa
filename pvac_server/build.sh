#!/bin/bash

# PVAC Server Build Script

set -e

echo "🔨 Building PVAC Server..."

# Create build directory
mkdir -p build
cd build

# Configure with CMake
echo "📋 Configuring..."
cmake ..

# Build
echo "🔧 Compiling..."
make -j$(nproc)

echo "✅ Build complete!"
echo ""
echo "To run the server:"
echo "  cd build"
echo "  ./pvac_server [port]"
echo ""
echo "Default port: 8765"

