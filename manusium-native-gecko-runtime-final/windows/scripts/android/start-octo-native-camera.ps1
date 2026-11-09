[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Avd,
  [Parameter(Mandatory=$true)][string]$Frame,
  [string]$CameraName = 'Octo Camera (Windows Virtual Camera)',
  [switch]$InstallDriver,
  [switch]$NoBoot
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$native = Join-Path $repo 'windows\resources\native-camera'
$control = Join-Path $native 'octo-cameractl.exe'
$publisher = Join-Path $native 'octo-camera-feed-publisher.exe'
$source = Join-Path $native 'octo-camera-source.dll'
$directShow = Join-Path $native 'octo-directshow-camera.dll'

foreach ($file in @($emulator, $adb, $control, $publisher, $source, $directShow)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Required native camera file is missing: $file. Build with npm run build:native-camera first." }
}
if (-not (Test-Path -LiteralPath $Frame)) { throw "Frame file was not found: $Frame" }

$winBuild = [Environment]::OSVersion.Version.Build
$windows10DirectShow = $winBuild -lt 22000

if ($InstallDriver) {
  & $control install --source $source --directshow $directShow
  if ($LASTEXITCODE -ne 0) { throw "Octo virtual-camera registration failed with exit code $LASTEXITCODE." }
}

if ($windows10DirectShow) {
  Write-Warning 'Windows 10 detected: using the bundled DirectShow camera filter. Media Foundation registration is unavailable on this host.'
}

$probe = (& $emulator "@$Avd" -webcam-list 2>&1 | Out-String)
if ($probe -notmatch '(?im)webcam\d+') {
  throw "The emulator did not enumerate an Octo webcam. Driver registration may require sign-out/restart, or the installed emulator/backend does not support this virtual camera. Output: $probe"
}
$endpoint = [regex]::Match($probe, '(?im)(webcam\d+)').Groups[1].Value
Write-Output "Verified emulator endpoint: $endpoint"

$publisherProcess = Start-Process -FilePath $publisher -ArgumentList @($Frame) -WorkingDirectory $native -PassThru -WindowStyle Hidden
Write-Output "Started native NV12 publisher PID=$($publisherProcess.Id)"

if (-not $NoBoot) {
  $args = @("@$Avd", '-no-snapshot-load', '-no-snapshot-save', '-no-boot-anim', '-camera-back', $endpoint, '-camera-front', 'none')
  Start-Process -FilePath $emulator -ArgumentList $args -WorkingDirectory (Split-Path $emulator) | Out-Null
  Write-Output "Started $Avd with $endpoint as the back camera."
}
Write-Output 'Native virtual-camera bridge is running. Change the JPEG in place to publish the next frame without restarting the emulator.'
