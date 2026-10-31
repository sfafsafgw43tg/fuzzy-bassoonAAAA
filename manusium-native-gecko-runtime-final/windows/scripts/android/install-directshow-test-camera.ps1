<#
.SYNOPSIS
  Install or start a known virtual-camera provider for AVD testing.

.DESCRIPTION
  This helper does not download or execute arbitrary driver code. Lensio is
  installed only from a caller-supplied, verified executable and Unity Capture
  is registered only from a caller-supplied DLL. OBS is started normally and
  asked to expose its existing virtual camera. The emulator's -webcam-list
  output remains the source of truth; Windows registration alone is not a pass.

  Lensio's virtual-camera installer requires an elevated PowerShell process.
  OBS startup itself should remain unelevated.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('lensio', 'unity-capture', 'obs')]
  [string] $Provider,

  [string] $LensioExe = "$env:LOCALAPPDATA\LensioStudio\LensioStudio.exe",
  [string] $UnityCaptureDll = '',
  [string] $SdkRoot = '',
  [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
  [string] $AvdName = 'Google-Pixel-9',
  [switch] $SkipWebcamList
)

$ErrorActionPreference = 'Stop'
function Is-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Resolve-Obs {
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe' }
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'obs-studio\bin\64bit\obs64.exe' }
  if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Programs\obs-studio\bin\64bit\obs64.exe' }
  return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
function Resolve-Regsvr32([bool] $Is64Bit) {
  if ($Is64Bit) { return Join-Path $env:WINDIR 'System32\regsvr32.exe' }
  return Join-Path $env:WINDIR 'SysWOW64\regsvr32.exe'
}
function Assert-File([string] $Path, [string] $Description) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Description was not found: $Path" }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt 1024) { throw "$Description is unexpectedly small: $Path" }
}

if (-not $SdkRoot) {
  $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
$emulator = Join-Path $SdkRoot 'emulator\emulator.exe'
if (-not $SkipWebcamList) { Assert-File $emulator 'Android Emulator' }

$action = ''
switch ($Provider) {
  'lensio' {
    Assert-File $LensioExe 'LensioStudio executable'
    if (-not (Is-Administrator)) {
      throw 'Lensio virtual-camera registration requires an elevated PowerShell. Re-run this script as Administrator; normal Lensio streaming remains unelevated.'
    }
    if ($PSCmdlet.ShouldProcess($LensioExe, 'Install/register Lensio virtual camera')) {
      $process = Start-Process -FilePath $LensioExe -ArgumentList '--install-virtual-camera' -Wait -PassThru
      if ($process.ExitCode -ne 0) { throw "Lensio virtual-camera installer exited with $($process.ExitCode)." }
      $action = 'Lensio virtual-camera installer completed.'
    }
  }
  'unity-capture' {
    Assert-File $UnityCaptureDll 'Unity Capture DLL'
    if (-not (Is-Administrator)) { throw 'Unity Capture DLL registration requires an elevated PowerShell.' }
    $regsvr = Resolve-Regsvr32 ([Environment]::Is64BitOperatingSystem)
    Assert-File $regsvr 'System regsvr32'
    if ($PSCmdlet.ShouldProcess($UnityCaptureDll, "Register with $regsvr")) {
      $process = Start-Process -FilePath $regsvr -ArgumentList @('/s', $UnityCaptureDll) -Wait -PassThru
      if ($process.ExitCode -ne 0) { throw "regsvr32 exited with $($process.ExitCode)." }
      $action = 'Unity Capture DLL registration completed.'
    }
  }
  'obs' {
    $obs = Resolve-Obs
    if (-not $obs) { throw 'OBS Studio was not found in the standard installation paths.' }
    if ($PSCmdlet.ShouldProcess($obs, 'Start OBS normally and request its virtual camera')) {
      Start-Process -FilePath $obs -ArgumentList '--startvirtualcam' | Out-Null
      Start-Sleep -Seconds 5
      $action = 'OBS was started normally with --startvirtualcam. Safe Mode must not be used because it can skip obs-virtualcam.'
    }
  }
}

$devices = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
  Where-Object { $_.PNPClass -in @('Camera', 'Image') -or $_.Name -match '(?i)camera|webcam|video capture' } |
  Select-Object -ExpandProperty Name)
$webcamList = ''
if (-not $SkipWebcamList) { $webcamList = (& $emulator "@$AvdName" -webcam-list 2>&1 | Out-String).Trim() }
[ordered]@{
  provider = $Provider
  action = $action
  windowsCameraDevices = $devices
  emulatorWebcamList = $webcamList
  emulatorEndpointReady = [bool]($webcamList -match '(?i)webcam\d+')
  note = 'A registered Windows provider is not sufficient; the endpoint must appear in emulator -webcam-list before Android Camera2 can use it.'
} | ConvertTo-Json -Depth 6
