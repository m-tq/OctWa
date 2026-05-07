# ============================================================================
# PVAC Server - Windows Release Script
# ============================================================================
# Builds pvac_server.exe and packages it into a zip for distribution.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File release-windows.ps1
#   powershell -ExecutionPolicy Bypass -File release-windows.ps1 -Version "1.2.0"
#
# Output:
#   release/pvac_server-windows-x64-<version>.zip
# ============================================================================

param(
    [string]$Version = ""
)

$Host.UI.RawUI.WindowTitle = "PVAC Server Release Build"

# ── Resolve version ───────────────────────────────────────────────────────────
if (-not $Version) {
    # Try to read from CMakeLists.txt
    $cmakeContent = Get-Content "CMakeLists.txt" -Raw -ErrorAction SilentlyContinue
    if ($cmakeContent -match 'project\s*\([^)]*VERSION\s+([\d.]+)') {
        $Version = $Matches[1]
    } else {
        $Version = "0.0.0"
    }
}

$ZipName    = "pvac_server-windows-x64-$Version.zip"
$ReleaseDir = "release"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  PVAC Server - Windows Release Build" -ForegroundColor Cyan
Write-Host "  Version: $Version" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Build ─────────────────────────────────────────────────────────────
Write-Host "[1/3] Building..." -ForegroundColor Yellow

# Reuse build-windows.ps1 logic inline (non-interactive)
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) {
    Write-Host "[ERROR] CMake not found. Install from https://cmake.org/download/" -ForegroundColor Red
    exit 1
}

$gpp = Get-Command g++ -ErrorAction SilentlyContinue
if (-not $gpp) {
    Write-Host "[ERROR] g++ not found. Install Strawberry Perl: https://strawberryperl.com/" -ForegroundColor Red
    exit 1
}

# Detect OpenSSL
$opensslPaths = @(
    "C:\Strawberry\c",
    "C:\msys64\mingw64",
    "C:\Program Files\OpenSSL-Win64",
    "C:\OpenSSL-Win64"
)
$opensslRoot = $null
foreach ($path in $opensslPaths) {
    if (Test-Path "$path\include\openssl\ssl.h") {
        $opensslRoot = $path
        break
    }
}

# Clean stale MSVC cache
if (Test-Path "build\CMakeCache.txt") {
    $cache = Get-Content "build\CMakeCache.txt" -Raw -ErrorAction SilentlyContinue
    if ($cache -match "MSVC|Visual Studio") {
        Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path "build")) { New-Item -ItemType Directory -Path "build" | Out-Null }

$cmakeArgs = @("-G", "MinGW Makefiles", "-DCMAKE_BUILD_TYPE=Release", "-DPVAC_STATIC=ON")
if ($opensslRoot) { $cmakeArgs += @("-DOPENSSL_ROOT_DIR=$opensslRoot") }
$cmakeArgs += @("-B", "build", "-S", ".")

& cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] CMake configure failed" -ForegroundColor Red; exit 1 }

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if (-not $cores -or $cores -lt 1) { $cores = 4 }

cmake --build build --config Release -j $cores
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Build failed" -ForegroundColor Red; exit 1 }

# Locate exe
$exePath = ""
if     (Test-Path "build\pvac_server.exe")         { $exePath = "build\pvac_server.exe" }
elseif (Test-Path "build\Release\pvac_server.exe") { $exePath = "build\Release\pvac_server.exe" }

if (-not $exePath) {
    Write-Host "[ERROR] pvac_server.exe not found after build" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Built: $exePath" -ForegroundColor Green
Write-Host ""

# ── Step 2: Collect files ─────────────────────────────────────────────────────
Write-Host "[2/3] Collecting release files..." -ForegroundColor Yellow

$buildDir   = Split-Path $exePath
$stagingDir = "release\_staging_win"

if (Test-Path $stagingDir) { Remove-Item -Recurse -Force $stagingDir }
New-Item -ItemType Directory -Path $stagingDir | Out-Null

# Always include the exe
Copy-Item $exePath "$stagingDir\pvac_server.exe"
Write-Host "  + pvac_server.exe" -ForegroundColor Gray

# Include OpenSSL DLL if present (Strawberry Perl build)
$dllPath = Join-Path $buildDir "libcrypto-3-x64__.dll"
if (Test-Path $dllPath) {
    Copy-Item $dllPath "$stagingDir\libcrypto-3-x64__.dll"
    Write-Host "  + libcrypto-3-x64__.dll" -ForegroundColor Gray
}

# Include README
if (Test-Path "README.md") {
    Copy-Item "README.md" "$stagingDir\README.md"
    Write-Host "  + README.md" -ForegroundColor Gray
}

Write-Host ""

# ── Step 3: Zip ───────────────────────────────────────────────────────────────
Write-Host "[3/3] Creating zip..." -ForegroundColor Yellow

if (-not (Test-Path $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir | Out-Null }

$zipPath = "$ReleaseDir\$ZipName"
if (Test-Path $zipPath) { Remove-Item $zipPath }

Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath
Remove-Item -Recurse -Force $stagingDir

$zipSizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host "[OK] $zipPath ($zipSizeKB KB)" -ForegroundColor Green
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  RELEASE READY" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $zipPath" -ForegroundColor White
Write-Host ""
Write-Host "Upload options:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. GitHub CLI (recommended):" -ForegroundColor Yellow
Write-Host "     gh release upload pvac-v$Version $zipPath" -ForegroundColor White
Write-Host ""
Write-Host "  2. Manual: go to https://github.com/m-tq/OctWa/releases" -ForegroundColor Yellow
Write-Host "     → find the release → Edit → drag & drop the zip file" -ForegroundColor White
Write-Host ""
