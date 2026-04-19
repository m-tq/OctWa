# ========================================
# PVAC Server - Windows Build Script
# ========================================
# Right-click -> Run with PowerShell
# Or: powershell -ExecutionPolicy Bypass -File build-windows.ps1
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
Write-Host "[OK] CMake found" -ForegroundColor Green
Write-Host ""

# Step 2: Check Compiler
Write-Host "[2/5] Checking C++ Compiler..." -ForegroundColor Yellow
$compilerType = ""
$cl = Get-Command cl -ErrorAction SilentlyContinue
$gpp = Get-Command g++ -ErrorAction SilentlyContinue

if ($cl) {
    Write-Host "[OK] Visual Studio compiler found" -ForegroundColor Green
    $compilerType = "MSVC"
} elseif ($gpp) {
    Write-Host "[OK] MinGW compiler found" -ForegroundColor Green
    $compilerType = "MinGW"
} else {
    Write-Host "[ERROR] No C++ compiler found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Visual Studio or MinGW"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Step 3: Check OpenSSL
Write-Host "[3/5] Checking OpenSSL..." -ForegroundColor Yellow

# Try to find OpenSSL installation (including Strawberry Perl)
$opensslPaths = @(
    "C:\Strawberry\c",                          # Strawberry Perl
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

if ($opensslRoot) {
    $env:OPENSSL_ROOT_DIR = $opensslRoot
} else {
    Write-Host "[ERROR] OpenSSL development files not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "CMake needs OpenSSL library files (headers + libs)."
    Write-Host ""
    Write-Host "Options to install OpenSSL:"
    Write-Host "1. Strawberry Perl (includes OpenSSL)" -ForegroundColor Cyan
    Write-Host "   https://strawberryperl.com/"
    Write-Host ""
    Write-Host "2. Official OpenSSL for Windows" -ForegroundColor Cyan
    Write-Host "   https://slproweb.com/products/Win32OpenSSL.html"
    Write-Host "   Download: Win64 OpenSSL v3.x.x (FULL, NOT Light!)"
    Write-Host ""
    Write-Host "Searched in:"
    foreach ($path in $opensslPaths) {
        Write-Host "  - $path" -ForegroundColor Gray
    }
    Write-Host ""
    $continue = Read-Host "Try to continue anyway? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit 1
    }
}
Write-Host ""

# Step 4: Build
Write-Host "[4/5] Configuring and building..." -ForegroundColor Yellow
if (-not (Test-Path "build")) {
    New-Item -ItemType Directory -Path "build" | Out-Null
}

Push-Location build

try {
    # Configure
    Write-Host "  Running CMake configuration..." -ForegroundColor Gray
    
    $cmakeArgs = @()
    if ($compilerType -eq "MinGW") {
        $cmakeArgs += @("-G", "MinGW Makefiles")
    }
    $cmakeArgs += @("-DCMAKE_BUILD_TYPE=Release")
    
    if ($opensslRoot) {
        $cmakeArgs += @("-DOPENSSL_ROOT_DIR=$opensslRoot")
    }
    
    $cmakeArgs += ".."
    
    & cmake $cmakeArgs
    
    if ($LASTEXITCODE -ne 0) {
        throw "CMake configuration failed - check error messages above"
    }
    
    Write-Host "  Configuration complete" -ForegroundColor Gray
    Write-Host ""
    
    # Build
    Write-Host "  Compiling... (this may take 30-60 seconds)" -ForegroundColor Gray
    # Redirect stderr to stdout so warnings don't trigger false failure detection
    cmake --build . --config Release 2>&1 | ForEach-Object { Write-Host $_ }
    
    # Check for actual executable rather than exit code (warnings cause non-zero exit on MinGW)
    $builtExe = $false
    if (Test-Path "Release\pvac_server.exe") { $builtExe = $true }
    if (Test-Path "pvac_server.exe")         { $builtExe = $true }
    
    if (-not $builtExe -and $LASTEXITCODE -ne 0) {
        throw "Build failed - check error messages above"
    }
    
    Write-Host "[OK] Build complete!" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[ERROR] $_" -ForegroundColor Red
    Write-Host ""
    Pop-Location
    Read-Host "Press Enter to exit"
    exit 1
}

Pop-Location
Write-Host ""

# Step 5: Verify
Write-Host "[5/5] Verifying..." -ForegroundColor Yellow
$exePath = ""
if (Test-Path "build\Release\pvac_server.exe") {
    $exePath = "build\Release\pvac_server.exe"
} elseif (Test-Path "build\pvac_server.exe") {
    $exePath = "build\pvac_server.exe"
}

if (-not $exePath) {
    Write-Host "[ERROR] Executable not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Executable: $exePath" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESS!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Ask to run
$run = Read-Host "Run server now? (Y/N, default=Y)"
if ($run -eq "" -or $run -eq "Y" -or $run -eq "y") {
    Write-Host ""
    Write-Host "Starting server on port 8765..." -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
    Write-Host ""
    & ".\$exePath"
    Write-Host ""
    Write-Host "Server stopped" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
