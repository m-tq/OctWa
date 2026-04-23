# ========================================
# PVAC Server - Windows Build Script
# ========================================
# Right-click -> Run with PowerShell
# Or: powershell -ExecutionPolicy Bypass -File build-windows.ps1
#
# IMPORTANT: PVAC requires GCC/MinGW (uses __int128 and AES-NI intrinsics).
#            MSVC is NOT supported.
# ========================================

$Host.UI.RawUI.WindowTitle = "PVAC Server Build"
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PVAC Server - Automated Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check CMake
Write-Host "[1/5] Checking CMake..." -ForegroundColor Yellow
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) {
    Write-Host "[ERROR] CMake not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install from: https://cmake.org/download/"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] CMake found: $($cmake.Source)" -ForegroundColor Green
Write-Host ""

# Step 2: Check Compiler — MinGW/GCC REQUIRED (MSVC does not support __int128)
Write-Host "[2/5] Checking C++ Compiler (MinGW/GCC required)..." -ForegroundColor Yellow

$gpp = Get-Command g++ -ErrorAction SilentlyContinue

if ($gpp) {
    $gccVersion = & g++ --version 2>&1 | Select-Object -First 1
    Write-Host "[OK] MinGW/GCC found: $gccVersion" -ForegroundColor Green
    Write-Host "     Path: $($gpp.Source)" -ForegroundColor Gray
} else {
    Write-Host "[ERROR] MinGW/GCC (g++) not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "PVAC requires GCC — MSVC is NOT supported (needs __int128 and AES-NI)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Install MinGW via Strawberry Perl (recommended, includes OpenSSL):" -ForegroundColor Cyan
    Write-Host "  https://strawberryperl.com/"
    Write-Host ""
    Write-Host "Or install MSYS2 + MinGW-w64:" -ForegroundColor Cyan
    Write-Host "  https://www.msys2.org/"
    Write-Host "  Then run: pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-openssl cmake"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Step 3: Check OpenSSL
Write-Host "[3/5] Checking OpenSSL..." -ForegroundColor Yellow

$opensslPaths = @(
    "C:\Strawberry\c",
    "C:\msys64\mingw64",
    "C:\Program Files\OpenSSL-Win64",
    "C:\Program Files\OpenSSL",
    "C:\OpenSSL-Win64",
    "C:\OpenSSL",
    "$env:ProgramFiles\OpenSSL-Win64",
    "$env:ProgramFiles\OpenSSL"
)

$opensslRoot = $null
foreach ($path in $opensslPaths) {
    if (Test-Path "$path\include\openssl\ssl.h") {
        $opensslRoot = $path
        Write-Host "[OK] OpenSSL found at: $opensslRoot" -ForegroundColor Green
        break
    }
}

if (-not $opensslRoot) {
    Write-Host "[ERROR] OpenSSL development files not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install options:" -ForegroundColor Yellow
    Write-Host "  1. Strawberry Perl (recommended — includes OpenSSL + MinGW):" -ForegroundColor Cyan
    Write-Host "     https://strawberryperl.com/"
    Write-Host ""
    Write-Host "  2. MSYS2 MinGW64:" -ForegroundColor Cyan
    Write-Host "     pacman -S mingw-w64-x86_64-openssl"
    Write-Host ""
    Write-Host "  3. Official OpenSSL for Windows:" -ForegroundColor Cyan
    Write-Host "     https://slproweb.com/products/Win32OpenSSL.html"
    Write-Host "     (Download Win64 FULL, not Light)"
    Write-Host ""
    Write-Host "Searched in:" -ForegroundColor Gray
    foreach ($path in $opensslPaths) { Write-Host "  - $path" -ForegroundColor Gray }
    Write-Host ""
    $continue = Read-Host "Try to continue without OpenSSL path hint? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") { exit 1 }
}
Write-Host ""

# Step 4: Configure and Build
Write-Host "[4/5] Configuring and building..." -ForegroundColor Yellow

# Clean build dir if it contains MSVC artifacts (incompatible with MinGW)
if (Test-Path "build\CMakeCache.txt") {
    $cacheContent = Get-Content "build\CMakeCache.txt" -Raw -ErrorAction SilentlyContinue
    if ($cacheContent -match "MSVC|Visual Studio") {
        Write-Host "  Detected stale MSVC build cache — cleaning..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue
        Write-Host "  Cleaned." -ForegroundColor Gray
    }
}

if (-not (Test-Path "build")) {
    New-Item -ItemType Directory -Path "build" | Out-Null
}

try {
    # Configure with MinGW Makefiles generator
    Write-Host "  Running CMake configuration (MinGW Makefiles)..." -ForegroundColor Gray

    $cmakeArgs = @("-G", "MinGW Makefiles", "-DCMAKE_BUILD_TYPE=Release")
    if ($opensslRoot) {
        $cmakeArgs += @("-DOPENSSL_ROOT_DIR=$opensslRoot")
    }
    $cmakeArgs += @("-B", "build", "-S", ".")

    & cmake @cmakeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "CMake configuration failed — check error messages above"
    }

    Write-Host "  Configuration complete." -ForegroundColor Gray
    Write-Host ""

    # Build with parallel jobs
    $cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
    if (-not $cores -or $cores -lt 1) { $cores = 4 }
    Write-Host "  Compiling with $cores parallel jobs (may take 30-90 seconds)..." -ForegroundColor Gray

    cmake --build build --config Release -j $cores 2>&1 | ForEach-Object { Write-Host $_ }

    # Check for executable (MinGW exit code may be non-zero due to warnings)
    $builtExe = (Test-Path "build\pvac_server.exe") -or (Test-Path "build\Release\pvac_server.exe")
    if (-not $builtExe) {
        throw "Build failed — pvac_server.exe not found"
    }

    Write-Host ""
    Write-Host "[OK] Build complete!" -ForegroundColor Green

} catch {
    Write-Host ""
    Write-Host "[ERROR] $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Step 5: Verify
Write-Host "[5/5] Verifying..." -ForegroundColor Yellow

$exePath = ""
if     (Test-Path "build\pvac_server.exe")         { $exePath = "build\pvac_server.exe" }
elseif (Test-Path "build\Release\pvac_server.exe") { $exePath = "build\Release\pvac_server.exe" }

if (-not $exePath) {
    Write-Host "[ERROR] Executable not found after build!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$exeSize = [math]::Round((Get-Item $exePath).Length / 1KB)
Write-Host "[OK] Executable: $exePath ($exeSize KB)" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESS!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Endpoints available after start:" -ForegroundColor Gray
Write-Host "  POST /api/ensure_pvac_registered" -ForegroundColor Gray
Write-Host "  POST /api/encrypt_balance" -ForegroundColor Gray
Write-Host "  POST /api/decrypt_to_public" -ForegroundColor Gray
Write-Host "  POST /api/stealth_send" -ForegroundColor Gray
Write-Host "  POST /api/claim_stealth" -ForegroundColor Gray
Write-Host "  POST /api/scan_stealth" -ForegroundColor Gray
Write-Host ""

# Ask to run
$run = Read-Host "Run server now? (Y/N, default=Y)"
if ($run -eq "" -or $run -eq "Y" -or $run -eq "y") {
    Write-Host ""
    Write-Host "Starting PVAC server on port 8765..." -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray
    Write-Host ""
    & ".\$exePath"
    Write-Host ""
    Write-Host "Server stopped." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
