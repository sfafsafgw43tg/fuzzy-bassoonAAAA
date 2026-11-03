<#
.SYNOPSIS
  Register Octo's native camera, verify webcam0, and launch an AVD with webcam0.

.DESCRIPTION
  The Android Emulator only accepts a host camera after it appears in
  `emulator.exe @AVD -webcam-list`. This script never treats a Windows registry
  entry as sufficient. It installs/registers the bundled Media Foundation and
  DirectShow backends, checks the emulator list, and refuses to launch when
  webcam0 is absent.

  For the no-restart hybrid image workflow, start OctoSuite's vStudio Mobile
  provider before this script (or use the OctoSuite Android launch button). The
  provider must publish Local\OctoSuite.VirtualCamera.NV12.v1 before the
  emulator probes DirectShow.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
  [string] $AvdName = 'Google-Pixel-9',
  [string] $SdkRoot = '',
  [string] $NativeCameraDir = '',
  [ValidateSet('none','webcam0')]
  [string] $FrontCamera = 'none',
  [ValidateSet('webcam0')]
  [string] $BackCamera = 'webcam0',
  [switch] $Launch
)

$ErrorActionPreference = 'Stop'

function Require-File([string] $Path, [string] $Label) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label was not found: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

if (-not $SdkRoot) {
  $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
    elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
    else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
$SdkRoot = (Resolve-Path -LiteralPath $SdkRoot).Path
$emulator = Require-File (Join-Path $SdkRoot 'emulator\emulator.exe') 'Android Emulator'

if (-not $NativeCameraDir) {
  $NativeCameraDir = Join-Path $PSScriptRoot '..\..\resources\native-camera'
}
$NativeCameraDir = (Resolve-Path -LiteralPath $NativeCameraDir).Path
$control = Require-File (Join-Path $NativeCameraDir 'octo-cameractl.exe') 'Octo camera control utility'
$source = Require-File (Join-Path $NativeCameraDir 'octo-camera-source.dll') 'Octo Media Foundation source'
$directShow = Require-File (Join-Path $NativeCameraDir 'octo-directshow-camera.dll') 'Octo DirectShow camera'

Write-Host "[1/4] Registering Octo native camera backends..."
# Remove only the two legacy Octo per-user entries. They can shadow the current
# filter after a checkout moves to a different drive.
foreach ($legacy in @(
  'Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\{6E5E5D49-7B17-4D0E-A8B3-5E5A4B0C8D21}',
  'Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\{A6C2B7E1-3D4F-4C9A-8B21-5D7E9F0A4C16}',
  'Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\Instance\Octo Camera (DirectShow)'
)) { Remove-Item -LiteralPath $legacy -Recurse -Force -ErrorAction SilentlyContinue }

& $control install --source $source 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "Media Foundation registration failed with exit code $LASTEXITCODE." }
$registration = Start-Process -FilePath $control -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('register-directshow', "`"$directShow`"")
if ($registration.ExitCode -ne 0) {
  throw "DirectShow registration failed with exit code $($registration.ExitCode). Approve the administrator prompt and rerun this script."
}

Write-Host "[2/4] Verifying registration..."
& $control status 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw 'Octo native camera is not registered.' }

Write-Host "[3/4] Querying the emulator webcam list..."
$list = (& $emulator "@$AvdName" '-webcam-list' 2>&1 | Out-String).Trim()
if ($list) { Write-Host $list }
if ($list -notmatch '(?i)\bwebcam0\b') {
  throw "webcam0 was not enumerated by the Android Emulator. Start the vStudio Mobile/native frame producer first, then rerun this script. Windows registration alone is not enough."
}

$result = [ordered]@{
  avd = $AvdName
  emulator = $emulator
  nativeCameraDir = $NativeCameraDir
  webcam0 = $true
  backCamera = $BackCamera
  frontCamera = $FrontCamera
  launchArgs = @("@$AvdName", '-camera-back', $BackCamera, '-camera-front', $FrontCamera, '-no-snapshot-load', '-no-snapshot-save')
}

if ($Launch) {
  Write-Host "[4/4] Launching $AvdName with back=$BackCamera front=$FrontCamera..."
  if ($PSCmdlet.ShouldProcess($AvdName, 'Launch Android Emulator with webcam0')) {
    $args = @("@$AvdName", '-camera-back', $BackCamera, '-camera-front', $FrontCamera, '-no-snapshot-load', '-no-snapshot-save')
    $child = Start-Process -FilePath $emulator -ArgumentList $args -PassThru
    $result.pid = $child.Id
  }
} else {
  Write-Host '[4/4] Verification complete. Use -Launch to start the AVD.'
}

$result | ConvertTo-Json -Depth 5
