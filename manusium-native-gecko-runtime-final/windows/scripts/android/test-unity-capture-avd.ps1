<#
.SYNOPSIS
  Validate a host virtual camera through an Android Studio AVD.

.DESCRIPTION
  Backward-compatible wrapper for the Android camera acceptance test. The
  provider controls endpoint identity validation; live CameraX frames and
  CameraProvider stability remain mandatory in real mode.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
  [string] $AvdName,

  [ValidatePattern('^webcam\d{1,2}$')]
  [string] $BackCamera = 'webcam0',

  [ValidatePattern('^(none|webcam\d{1,2})$')]
  [string] $FrontCamera = 'none',

  [ValidateSet('unity-capture', 'obs', 'directshow')]
  [string] $Provider = 'unity-capture',

  [string] $SdkRoot,
  [string] $AvdHome,
  [int] $BootTimeoutSeconds = 180,
  [switch] $SkipBuild,
  [switch] $KeepEmulator,
  [switch] $MockUnityCapture
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-avd-camera.ps1'
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Camera validator is missing: $validator"
}

$args = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $validator,
  '-AvdName', $AvdName,
  '-BackCamera', $BackCamera,
  '-FrontCamera', $FrontCamera,
  '-Provider', $Provider,
  '-BootTimeoutSeconds', $BootTimeoutSeconds
)
if ($SdkRoot) { $args += @('-SdkRoot', $SdkRoot) }
if ($AvdHome) { $args += @('-AvdHome', $AvdHome) }
if ($SkipBuild) { $args += '-SkipBuild' }
if ($KeepEmulator) { $args += '-KeepEmulator' }
if ($MockUnityCapture) { $args += '-MockUnityCapture' }

& powershell.exe @args
if ($LASTEXITCODE -ne 0) {
  throw "Android camera provider test failed with exit code $LASTEXITCODE. Review android-tools.log and android-camera-result.json."
}
Write-Host "Android camera provider test passed: $AvdName / $Provider / $BackCamera"
