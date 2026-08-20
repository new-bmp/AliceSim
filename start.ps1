[CmdletBinding()]
param(
  [ValidateRange(0, 65535)]
  [int]$Port = 4173,
  [ValidateRange(0, 100)]
  [int]$PortSpan = 20,
  [switch]$NoBrowser,
  [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$vendorRoot = Join-Path $projectRoot ".vendor"
$requirementsPath = Join-Path $projectRoot "requirements.txt"
$spiceRequirementsPath = Join-Path $projectRoot "requirements-spice.txt"
$script:PythonExecutable = $null
$script:PythonPrefix = @()

Set-Location -LiteralPath $projectRoot
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-AlicePython {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  $candidates = @(
    @{ Executable = "py"; Prefix = @("-3") },
    @{ Executable = "python"; Prefix = @() }
  )
  try {
    foreach ($candidate in $candidates) {
      if (-not (Get-Command $candidate.Executable -ErrorAction SilentlyContinue)) { continue }
      $prefix = $candidate.Prefix
      & $candidate.Executable @prefix -c "import struct, sys; raise SystemExit(0 if sys.version_info >= (3, 10) and struct.calcsize('P') == 8 else 1)" 2>$null
      if ($LASTEXITCODE -eq 0) {
        $script:PythonExecutable = $candidate.Executable
        $script:PythonPrefix = $prefix
        return
      }
    }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  throw "64-bit Python 3.10 or newer was not found. Install Python from https://www.python.org/downloads/ and run AliceSIM again."
}

function Invoke-AlicePython {
  param([string[]]$PythonArguments)
  $prefix = $script:PythonPrefix
  & $script:PythonExecutable @prefix @PythonArguments
}

function Test-AliceClang {
  $previousVendor = $env:ALICESIM_VENDOR_ROOT
  $previousPreference = $ErrorActionPreference
  $env:ALICESIM_VENDOR_ROOT = $vendorRoot
  $ErrorActionPreference = "SilentlyContinue"
  $checkScript = @'
import os
import sys
from pathlib import Path
root = Path(os.environ['ALICESIM_VENDOR_ROOT'])
sys.path.insert(0, str(root))
from clang import cindex
library = root / 'clang' / 'native' / 'libclang.dll'
if library.exists():
    cindex.Config.set_library_file(str(library))
cindex.Index.create()
'@
  try {
    Invoke-AlicePython -PythonArguments @("-c", $checkScript) *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $env:ALICESIM_VENDOR_ROOT = $previousVendor
    $ErrorActionPreference = $previousPreference
  }
}

function Test-AliceDatasheetParser {
  $previousVendor = $env:ALICESIM_VENDOR_ROOT
  $previousPreference = $ErrorActionPreference
  $env:ALICESIM_VENDOR_ROOT = $vendorRoot
  $ErrorActionPreference = "SilentlyContinue"
  $checkScript = @'
import os
import sys
from pathlib import Path
root = Path(os.environ['ALICESIM_VENDOR_ROOT'])
sys.path.insert(0, str(root))
from pypdf import PdfReader
import pdfplumber
'@
  try {
    Invoke-AlicePython -PythonArguments @("-c", $checkScript) *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $env:ALICESIM_VENDOR_ROOT = $previousVendor
    $ErrorActionPreference = $previousPreference
  }
}

function Install-AliceDependencies {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
  try {
    Write-Host "Preparing the project-local Clang and datasheet parser runtime..." -ForegroundColor Yellow
    Invoke-AlicePython -PythonArguments @(
      "-m", "pip", "install", "--disable-pip-version-check", "--timeout", "15", "--retries", "1",
      "--target", $vendorRoot, "-r", $requirementsPath
    )
    if ($LASTEXITCODE -eq 0) { return $true }

    Write-Host "Primary package source was unavailable; trying the Tsinghua mirror..." -ForegroundColor Yellow
    Invoke-AlicePython -PythonArguments @(
      "-m", "pip", "install", "--disable-pip-version-check", "--target", $vendorRoot,
      "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--trusted-host", "pypi.tuna.tsinghua.edu.cn",
      "-r", $requirementsPath
    )
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Test-AliceSpice {
  $previousVendor = $env:ALICESIM_VENDOR_ROOT
  $previousPreference = $ErrorActionPreference
  $env:ALICESIM_VENDOR_ROOT = $vendorRoot
  $ErrorActionPreference = "SilentlyContinue"
  $checkScript = @'
import os
import sys
from pathlib import Path
root = Path(os.environ['ALICESIM_VENDOR_ROOT'])
sys.path.insert(0, str(root))
from PySpice.Spice.Netlist import Circuit
from PySpice.Unit import u_Ohm, u_V
dll = root / 'PySpice' / 'Spice' / 'NgSpice' / 'Spice64_dll' / 'dll-vs' / 'ngspice.dll'
if not dll.exists():
    raise SystemExit(1)
circuit = Circuit('AliceSIM startup check')
circuit.V('supply', 'vin', circuit.gnd, 1 @ u_V)
circuit.R('load', 'vin', circuit.gnd, 1000 @ u_Ohm)
analysis = circuit.simulator().operating_point()
value = float(analysis['vin'].as_ndarray().reshape(-1)[0])
raise SystemExit(0 if abs(value - 1.0) < 1e-6 else 1)
'@
  try {
    Invoke-AlicePython -PythonArguments @("-c", $checkScript) *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $env:ALICESIM_VENDOR_ROOT = $previousVendor
    $ErrorActionPreference = $previousPreference
  }
}

function Install-AliceSpiceDependencies {
  $previousPreference = $ErrorActionPreference
  $previousVendor = $env:ALICESIM_VENDOR_ROOT
  $ErrorActionPreference = "Continue"
  $env:ALICESIM_VENDOR_ROOT = $vendorRoot
  New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
  try {
    Write-Host "Preparing the optional PySpice / NGSpice DC solver..." -ForegroundColor Yellow
    Invoke-AlicePython -PythonArguments @(
      "-m", "pip", "install", "--disable-pip-version-check", "--timeout", "20", "--retries", "1",
      "--no-deps", "--target", $vendorRoot, "-r", $spiceRequirementsPath
    )
    if ($LASTEXITCODE -ne 0) {
      Invoke-AlicePython -PythonArguments @(
        "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--target", $vendorRoot,
        "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--trusted-host", "pypi.tuna.tsinghua.edu.cn",
        "-r", $spiceRequirementsPath
      )
    }
    if ($LASTEXITCODE -ne 0) { return $false }
    $postInstall = "from PySpice.Scripts.pyspice_post_installation import main; main()"
    Invoke-AlicePython -PythonArguments @("-c", $postInstall, "--install-ngspice-dll", "--ngspice-version", "34")
    return $LASTEXITCODE -eq 0
  } finally {
    $env:ALICESIM_VENDOR_ROOT = $previousVendor
    $ErrorActionPreference = $previousPreference
  }
}

function Get-AliceInstanceId {
  $normalizedRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd("\", "/").Replace("/", "\").ToLowerInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedRoot))
    return -join ($bytes[0..5] | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
  }
}

function Test-LocalPortOpen {
  param([int]$CandidatePort)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $attempt = $client.BeginConnect("127.0.0.1", $CandidatePort, $null, $null)
    if (-not $attempt.AsyncWaitHandle.WaitOne(50)) { return $false }
    $client.EndConnect($attempt)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Find-RunningAliceSim {
  param([string]$ExpectedInstance)
  if ($Port -eq 0) { return $null }
  foreach ($candidatePort in $Port..([Math]::Min(65535, $Port + $PortSpan))) {
    if (-not (Test-LocalPortOpen -CandidatePort $candidatePort)) { continue }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$candidatePort/api/health" -TimeoutSec 1
      if ($health.service -eq "AliceSIM" -and $health.instance -eq $ExpectedInstance) {
        return "http://127.0.0.1:$candidatePort"
      }
    } catch {
      continue
    }
  }
  return $null
}

try {
  $existingUrl = Find-RunningAliceSim -ExpectedInstance (Get-AliceInstanceId)
  if ($existingUrl) {
    Write-Host "AliceSIM is already running at $existingUrl" -ForegroundColor Cyan
    if (-not $NoBrowser) { Start-Process $existingUrl }
    exit 0
  }

  Resolve-AlicePython
  $pythonVersion = Invoke-AlicePython -PythonArguments @("-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))")
  Write-Host "Python $pythonVersion" -ForegroundColor DarkGray

  $clangReady = Test-AliceClang
  $datasheetParserReady = Test-AliceDatasheetParser
  if ((-not $clangReady -or -not $datasheetParserReady) -and -not $SkipDependencies) {
    $installed = Install-AliceDependencies
    $clangReady = $installed -and (Test-AliceClang)
    $datasheetParserReady = $installed -and (Test-AliceDatasheetParser)
  }
  if ($clangReady) {
    Write-Host "Clang 18 runtime ready" -ForegroundColor Green
  } else {
    Write-Warning "Clang 18 could not be prepared. AliceSIM will start with the browser-side basic analyzer."
  }
  if ($datasheetParserReady) {
    Write-Host "PDF datasheet parser ready" -ForegroundColor Green
  } else {
    Write-Warning "PDF datasheet parsing is unavailable. Structured-text drafts and the rest of AliceSIM remain usable."
  }

  $spiceReady = Test-AliceSpice
  if (-not $spiceReady -and -not $SkipDependencies) {
    $spiceInstalled = Install-AliceSpiceDependencies
    $spiceReady = $spiceInstalled -and (Test-AliceSpice)
  }
  if ($spiceReady) {
    Write-Host "PySpice / NGSpice DC solver ready" -ForegroundColor Green
  } else {
    Write-Warning "PySpice could not be prepared. AliceSIM will keep using its built-in live DC solver."
  }

  Write-Host "Starting the AliceSIM backend..." -ForegroundColor Cyan
  Write-Host "The launcher will choose the next free local port when $Port is occupied." -ForegroundColor DarkGray
  $serverArguments = @(
    "server.py", "--host", "127.0.0.1", "--port", [string]$Port, "--port-span", [string]$PortSpan
  )
  $serverArguments += $(if ($NoBrowser) { "--no-browser" } else { "--open-browser" })
  Invoke-AlicePython -PythonArguments $serverArguments
  exit $LASTEXITCODE
} catch {
  Write-Host "AliceSIM launcher failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
