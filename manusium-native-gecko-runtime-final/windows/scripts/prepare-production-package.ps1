[CmdletBinding()]
param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$electronDist = Join-Path $SourceRoot 'node_modules\electron\dist'
$browserDist = Join-Path $SourceRoot 'apps\octobrowser\dist'
$checker = Join-Path $SourceRoot 'scripts\verify-windows-graphics-runtime.ps1'

function Require-Path {
  param([string]$Path, [string]$Description)
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required $Description is missing: $Path" }
}

Require-Path $electronDist 'Electron runtime'
Require-Path $browserDist 'browser build output'
Require-Path $checker 'graphics prerequisite checker'

if (-not $SkipBuild) {
  Push-Location $SourceRoot
  try {
    & npm.cmd run build:browser
    if ($LASTEXITCODE -ne 0) { throw "Browser build failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
}

$requiredElectron = @('electron.exe', 'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'icudtl.dat', 'v8_context_snapshot.bin')
foreach ($name in $requiredElectron) { Require-Path (Join-Path $electronDist $name) "Electron file $name" }
Require-Path (Join-Path $browserDist 'main.js') 'browser main bundle'
Require-Path (Join-Path $browserDist 'renderer\browser.js') 'browser renderer bundle'

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$runtimeOut = Join-Path $OutputRoot 'runtime'
$browserOut = Join-Path $OutputRoot 'app'
New-Item -ItemType Directory -Force -Path $runtimeOut,$browserOut | Out-Null

& robocopy.exe $electronDist $runtimeOut /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Electron runtime copy failed with exit code $LASTEXITCODE" }
& robocopy.exe $browserDist $browserOut /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Browser bundle copy failed with exit code $LASTEXITCODE" }

$runtimeReport = Join-Path $OutputRoot 'graphics-runtime-check.json'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $checker -ElectronDist $runtimeOut -JsonOutput $runtimeReport | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Graphics prerequisite checker failed with exit code $LASTEXITCODE" }
$check = Get-Content -LiteralPath $runtimeReport -Raw | ConvertFrom-Json
if (-not $check.readyForProcessTest) { throw 'Production package is missing required runtime components.' }

$manifest = [ordered]@{
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRoot = $SourceRoot
  outputRoot = $OutputRoot
  electronVersion = (Get-Item (Join-Path $runtimeOut 'electron.exe')).VersionInfo.ProductVersion
  browserMain = (Get-Item (Join-Path $browserOut 'main.js')).Length
  browserRenderer = (Get-Item (Join-Path $browserOut 'renderer\browser.js')).Length
  graphicsCheck = 'passed-presence-check; process-level sandbox probe remains separate'
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'package-manifest.json') -Encoding utf8
$manifest | ConvertTo-Json -Depth 5
