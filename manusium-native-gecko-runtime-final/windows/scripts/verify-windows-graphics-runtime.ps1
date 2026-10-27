[CmdletBinding()]
param(
  [string]$ElectronDist = '',
  [string]$JsonOutput = ''
)

$ErrorActionPreference = 'Stop'

function Get-FileRecord {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [ordered]@{ path = $Path; present = $false }
  }
  $item = Get-Item -LiteralPath $Path
  $version = $item.VersionInfo
  [ordered]@{
    path = $Path
    present = $true
    length = $item.Length
    fileVersion = $version.FileVersion
    productVersion = $version.ProductVersion
  }
}

function Test-DllLoadable {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  # Do not load arbitrary DLLs into this PowerShell process. Presence and PE
  # metadata are reported; actual child-process loading is tested separately.
  return $true
}

function Get-ApiSetRecord {
  param([string]$Name)
  $systemPath = Join-Path $env:WINDIR "System32\$Name"
  if (Test-Path -LiteralPath $systemPath -PathType Leaf) {
    return Get-FileRecord $systemPath
  }
  $winSxs = Join-Path $env:WINDIR 'WinSxS'
  $match = Get-ChildItem -LiteralPath $winSxs -Filter $Name -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($match) {
    $record = Get-FileRecord $match.FullName
    $record.apiSetResolvedFromWinSxS = $true
    return $record
  }
  [ordered]@{ path = $systemPath; apiSet = $true; present = $false; note = 'API-set DLL may be provided by the Windows loader rather than as a System32 file.' }
}

$system32 = Join-Path $env:WINDIR 'System32'
$systemFiles = @(
  'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll',
  'd3d11.dll', 'dxgi.dll', 'dcomp.dll', 'd3d12.dll'
) | ForEach-Object { Get-FileRecord (Join-Path $system32 $_) }
$apiSetFiles = @('api-ms-win-crt-runtime-l1-1-0.dll', 'api-ms-win-crt-heap-l1-1-0.dll') | ForEach-Object { Get-ApiSetRecord $_ }

$runtimeFiles = @()
if ($ElectronDist) {
  $runtimeFiles = @('electron.exe', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vulkan-1.dll', 'ffmpeg.dll') |
    ForEach-Object { Get-FileRecord (Join-Path $ElectronDist $_) }
}

$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
$result = [ordered]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  computer = $env:COMPUTERNAME
  windows = [ordered]@{
    productName = $os.ProductName
    displayVersion = $os.DisplayVersion
    currentBuild = $os.CurrentBuild
    ubr = $os.UBR
    architecture = $env:PROCESSOR_ARCHITECTURE
  }
  systemFiles = @($systemFiles + $apiSetFiles)
  electronDist = $ElectronDist
  electronFiles = $runtimeFiles
  status = 'diagnostic-only'
  limitations = @(
    'This script does not install, repair, or load DLLs into the PowerShell process.'
    'A successful presence check does not prove AppContainer GPU-child compatibility.'
    'Run the bounded Electron software-rendering probe separately for process-level evidence.'
  )
}

$requiredSystem = @($systemFiles | Where-Object { -not $_.present })
$requiredRuntime = @($runtimeFiles | Where-Object { -not $_.present })
$result.missingSystemFiles = @($requiredSystem | ForEach-Object { $_.path } | Where-Object { $_ })
$result.missingElectronFiles = @($requiredRuntime | ForEach-Object { $_.path } | Where-Object { $_ })
$result.readyForProcessTest = ($requiredSystem.Count -eq 0 -and $requiredRuntime.Count -eq 0)

$json = $result | ConvertTo-Json -Depth 8
if ($JsonOutput) {
  $parent = Split-Path -Parent $JsonOutput
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Set-Content -LiteralPath $JsonOutput -Value $json -Encoding utf8
}
$json
