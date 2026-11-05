[CmdletBinding()]
param(
  [string]$Repository = 'YashasVM/OpenStream',
  [string]$Version = 'latest',
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\.work\openstream-camera-assets'),
  [string]$ObsInstallRoot = '',
  [string]$AndroidSdkRoot = '',
  [string]$AvdSerial = '',
  [switch]$InstallObsPlugin,
  [switch]$InstallApk,
  [switch]$StageOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) { Write-Host "[openstream-camera] $Message" }
function Fail([string]$Message) { throw "[openstream-camera] $Message" }
function Get-Asset([object[]]$Assets, [string[]]$Patterns, [string]$Label) {
  foreach ($pattern in $Patterns) {
    $match = @($Assets | Where-Object { $_.name -match $pattern }) | Select-Object -First 1
    if ($match) { return $match }
  }
  Fail "No $Label release asset matched: $($Patterns -join ', ')"
}
function Download([string]$Uri, [string]$Path) {
  Write-Step "Downloading $Uri"
  Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'OctoSuite-camera-bootstrap' } -Uri $Uri -OutFile $Path
  if (!(Test-Path -LiteralPath $Path) -or (Get-Item $Path).Length -eq 0) { Fail "Downloaded file is empty: $Path" }
}
function Verify-Checksum([string]$Path, [string]$Expected, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Expected)) { Fail "No SHA-256 checksum was provided for $Label; refusing to stage an unverified binary." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.Trim().ToLowerInvariant()) { Fail "SHA-256 mismatch for $Label. Expected $Expected, got $actual." }
  Write-Step "Verified $Label ($actual)"
}
function Find-Checksum([object[]]$Assets, [object]$Asset) {
  $sidecar = @($Assets | Where-Object { $_.name -match ([regex]::Escape($Asset.name) + '.*(sha256|checksum)') }) | Select-Object -First 1
  if (!$sidecar) { $sidecar = @($Assets | Where-Object { $_.name -match '(sha256|checksums|checksum)' }) | Select-Object -First 1 }
  if (!$sidecar) { return '' }
  $file = Join-Path $OutputRoot $sidecar.name
  if (!(Test-Path $file)) { Download $sidecar.browser_download_url $file }
  $line = Get-Content -Raw -LiteralPath $file
  $escaped = [regex]::Escape($Asset.name)
  $hit = [regex]::Match($line, "(?im)(?<hash>[a-f0-9]{64})\s+\*?${escaped}")
  if (!$hit.Success) { $hit = [regex]::Match($line, '(?im)(?<hash>[a-f0-9]{64})') }
  return $(if ($hit.Success) { $hit.Groups['hash'].Value } else { '' })
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$releaseUri = if ($Version -eq 'latest') { "https://api.github.com/repos/$Repository/releases/latest" } else { "https://api.github.com/repos/$Repository/releases/tags/$Version" }
Write-Step "Resolving OpenStream release $Version from $Repository"
$release = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'OctoSuite-camera-bootstrap' } -Uri $releaseUri
$assets = @($release.assets)
if (!$assets.Count) { Fail 'The selected OpenStream release has no downloadable assets. Build the plugin/APK from source on a tool-equipped machine, then provide checksum manifests.' }

# OpenStream is a phone-to-OBS source. These assets are staged for optional OBS/phone workflows;
# OctoSuite emulator injection still uses a Windows virtual-camera driver and webcamN enumeration.
$plugin = Get-Asset $assets @('(?i)obs.*(win|windows).*\.(zip|dll)$', '(?i)openstream.*obs.*\.(zip|dll)$') 'Windows OBS plugin'
$apk = Get-Asset $assets @('(?i)openstream.*\.apk$', '(?i)app.*debug.*\.apk$') 'Android APK'
$pluginPath = Join-Path $OutputRoot $plugin.name
$apkPath = Join-Path $OutputRoot $apk.name
Download $plugin.browser_download_url $pluginPath
Download $apk.browser_download_url $apkPath
Verify-Checksum $pluginPath (Find-Checksum $assets $plugin) 'OBS plugin'
Verify-Checksum $apkPath (Find-Checksum $assets $apk) 'Android APK'

$manifest = [ordered]@{
  repository = $Repository
  release = $release.tag_name
  plugin = @{ name = $plugin.name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginPath).Hash.ToLowerInvariant() }
  apk = @{ name = $apk.name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apkPath).Hash.ToLowerInvariant() }
  stagedAt = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'camera-assets.json') -Encoding UTF8

if (!$StageOnly -and $InstallObsPlugin) {
  if ([string]::IsNullOrWhiteSpace($ObsInstallRoot)) {
    $ObsInstallRoot = @(
      (Join-Path ${env:ProgramFiles} 'obs-studio'),
      (Join-Path ${env:ProgramFiles(x86)} 'obs-studio'),
      (Join-Path ${env:LOCALAPPDATA} 'Programs\obs-studio')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  }
  if (!$ObsInstallRoot) { Fail 'OBS Studio installation was not found. Pass -ObsInstallRoot explicitly.' }
  $pluginDir = Join-Path $ObsInstallRoot 'obs-plugins\64bit'
  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  if ((Get-Item $pluginPath).Extension -eq '.zip') {
    Expand-Archive -LiteralPath $pluginPath -DestinationPath (Join-Path $OutputRoot 'plugin-extracted') -Force
    $dll = Get-ChildItem (Join-Path $OutputRoot 'plugin-extracted') -Recurse -File -Filter *.dll | Select-Object -First 1
    if (!$dll) { Fail 'The plugin archive contained no DLL.' }
    Copy-Item -LiteralPath $dll.FullName -Destination $pluginDir -Force
  } else { Copy-Item -LiteralPath $pluginPath -Destination $pluginDir -Force }
  Write-Step "Installed the verified OBS plugin into $pluginDir"
}

if (!$StageOnly -and $InstallApk) {
  if (!$AndroidSdkRoot) { $AndroidSdkRoot = $env:ANDROID_HOME; if (!$AndroidSdkRoot) { $AndroidSdkRoot = $env:ANDROID_SDK_ROOT } }
  $adb = if ($AndroidSdkRoot) { Join-Path $AndroidSdkRoot 'platform-tools\adb.exe' } else { (Get-Command adb.exe -ErrorAction SilentlyContinue).Source }
  if (!$adb -or !(Test-Path $adb)) { Fail 'adb was not found. Install Android SDK platform-tools or pass -AndroidSdkRoot.' }
  if (!$AvdSerial) { $AvdSerial = (& $adb devices | Select-String '\tdevice$' | Select-Object -First 1).ToString().Split("`t")[0] }
  if (!$AvdSerial) { Fail 'No online Android device was found. Start the AVD before using -InstallApk.' }
  $result = & $adb -s $AvdSerial install -r $apkPath 2>&1
  if ($LASTEXITCODE -ne 0 -or ($result -notmatch '(?im)^Success')) { Fail "APK installation failed: $result" }
  Write-Step "Installed the verified APK on $AvdSerial"
}

Write-Step "Assets staged in $OutputRoot"
