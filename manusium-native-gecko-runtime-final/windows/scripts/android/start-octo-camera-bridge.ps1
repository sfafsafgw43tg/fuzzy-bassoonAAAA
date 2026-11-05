[CmdletBinding()]
param(
  [string]$Avd = 'Octo-Realme12Pro-Unity',
  [string]$Serial = '',
  [int]$Port = 8765,
  [string]$Apk = '',
  [ValidateSet('imagefile', 'videofile', 'emulated')]
  [string]$CameraSource = 'imagefile',
  [string]$CameraFile = '',
  [switch]$NoBoot,
  [switch]$NoInstall,
  [switch]$NoLaunch,
  [switch]$KeepServer = $true
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = if ($env:ADB) { $env:ADB } else { Join-Path $sdk 'platform-tools\adb.exe' }
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$serverScript = Join-Path $repo 'windows\scripts\android\start-live-camera-server.cjs'
if ([string]::IsNullOrWhiteSpace($Apk)) { $Apk = Join-Path $repo 'outputs\Realme12ProStudio-LiveReceiver-debug.apk' }
if ([string]::IsNullOrWhiteSpace($CameraFile)) { $CameraFile = Join-Path $repo '.work\camera-test\chosen-photo-test.jpg' }

foreach ($required in @($adb, $emulator, $serverScript, $Apk)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required file was not found: $required" }
}
if ($CameraSource -ne 'emulated' -and -not (Test-Path -LiteralPath $CameraFile)) { throw "Camera source file was not found: $CameraFile" }

function Invoke-Adb([string[]]$Arguments) {
  $output = & $adb @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ADB failed ($LASTEXITCODE): $($output -join ' ')" }
  return @($output)
}

function Get-TargetSerial {
  if ($Serial) { return $Serial }
  # adb may write harmless daemon-start messages to stderr on its first call.
  # Do not let PowerShell's Stop policy treat that diagnostic as a failure.
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $rows = @(& $adb devices 2>&1 | Where-Object { $_ -match '^emulator-[0-9]+\s+device$' })
  $ErrorActionPreference = $previousErrorAction
  if ($rows) { return (($rows[0].ToString() -split '\s+')[0]) }
  return ''
}

Write-Output "OctoSuite camera bridge: AVD=$Avd port=$Port"

# The server is the non-PnP bridge consumed by the receiver APK.
$env:OCTO_CAMERA_PORT = [string]$Port
$serverLog = Join-Path $repo 'windows\.work\live-camera-server-startup.log'
$serverErr = "$serverLog.err"
New-Item -ItemType Directory -Force (Split-Path $serverLog) | Out-Null
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
  $serverProcess = Start-Process node.exe -ArgumentList @($serverScript) -WorkingDirectory (Join-Path $repo 'windows') -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr -PassThru
  Write-Output "Started MJPEG server PID=$($serverProcess.Id)"
} else {
  Write-Output "MJPEG server already listening on port $Port (PID=$($existing[0].OwningProcess))"
}

$healthy = $false
for ($i = 1; $i -le 30; $i++) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$Port/health"
    if ($health.running -and [int]$health.frameBytes -gt 0) { $healthy = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) { throw "MJPEG server did not become healthy on port $Port. See $serverLog and $serverErr" }
Write-Output "MJPEG healthy: $($health.frameBytes) bytes, frame $($health.frameVersion)"

if (-not $NoBoot) {
  $target = Get-TargetSerial
  if (-not $target) {
    Write-Output "Starting Android Emulator @$Avd"
    $emulatorArgs = @("@$Avd", '-no-snapshot', '-no-boot-anim')
    if ($CameraSource -eq 'emulated') {
      $emulatorArgs += @('-camera-back', 'emulated', '-camera-front', 'emulated')
    } elseif ($CameraSource -eq 'imagefile') {
      $emulatorArgs += @('-camera-back', "imagefile:$CameraFile", '-camera-front', "imagefile:$CameraFile")
    } else {
      $emulatorArgs += @('-camera-back', "videofile:$CameraFile", '-camera-front', "videofile:$CameraFile")
    }
    Write-Output "Camera source: $CameraSource $CameraFile"
    Start-Process $emulator -ArgumentList $emulatorArgs | Out-Null
  } else {
    Write-Output "Using already-running emulator $target"
  }
}

if (-not $Serial) {
  for ($i = 1; $i -le 90; $i++) {
    $Serial = Get-TargetSerial
    if ($Serial) { break }
    Start-Sleep -Seconds 1
  }
}
if (-not $Serial) { throw 'No emulator became available through ADB.' }
Write-Output "ADB target: $Serial"

& $adb -s $Serial wait-for-device | Out-Null
$ready = $false
for ($i = 1; $i -le 90; $i++) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $boot = (& $adb -s $Serial shell getprop sys.boot_completed 2>&1) -join "`n"
  $packages = (& $adb -s $Serial shell cmd package list packages 2>&1) -join "`n"
  $ErrorActionPreference = $previousErrorAction
  if ($boot -match '\b1\b' -and $packages -match 'package:' -and $packages -notmatch 'Can.t find service|offline|error:') { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "Android package service did not become ready on $Serial." }

Invoke-Adb @('-s', $Serial, 'reverse', "tcp:$Port", "tcp:$Port") | Out-Null
Write-Output "ADB reverse active: tcp:$Port -> tcp:$Port"

if (-not $NoInstall) {
  $installed = $false
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    $result = (& $adb -s $Serial install -r $Apk 2>&1) -join "`n"
    if ($LASTEXITCODE -eq 0 -and $result -match '(?m)^Success\b') { $installed = $true; break }
    if ($result -notmatch 'package service|device offline|device not found') { throw "APK installation failed: $result" }
    Start-Sleep -Seconds 3
  }
  if (-not $installed) { throw "APK installation did not complete on $Serial." }
  $packagePath = (& $adb -s $Serial shell pm path app.octo.avdcamera 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $packagePath -notmatch '(?m)^package:') { throw 'Android did not confirm app.octo.avdcamera after installation.' }
  Write-Output "APK verified: app.octo.avdcamera"
}

if (-not $NoLaunch) {
  Invoke-Adb @('-s', $Serial, 'shell', 'am', 'force-stop', 'app.octo.avdcamera') | Out-Null
  Invoke-Adb @('-s', $Serial, 'shell', 'am', 'start', '-n', 'app.octo.avdcamera/.ControllerActivity') | Out-Null
  Write-Output 'Receiver launched: app.octo.avdcamera/.ControllerActivity'
}

Write-Output ''
Write-Output 'OctoSuite camera bridge is ready.'
Write-Output "Host health: http://127.0.0.1:$Port/health"
Write-Output "ADB reverse: tcp:$Port -> tcp:$Port"
if ($CameraSource -eq 'imagefile' -or $CameraSource -eq 'videofile') {
  Write-Output "Android system Camera2 source: $CameraSource"
} else {
  Write-Output 'Android system Camera2 source: emulator-generated emulated camera'
}
