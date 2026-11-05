[CmdletBinding()]
param(
  [string]$Avd = 'Octo-Realme12Pro-Unity',
  [ValidatePattern('^webcam\d+$')]
  [string]$WebcamEndpoint = 'webcam0',
  [string]$WindowsDevicePath = '',
  [switch]$NoLaunch,
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$windowsRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repo = Split-Path -Parent $windowsRoot
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$diag = Join-Path $PSScriptRoot 'diagnose-unity-capture.ps1'
$install = Join-Path $PSScriptRoot 'install-octo-camera-controller.ps1'
if (-not (Test-Path $adb)) { throw "ADB not found: $adb" }
if (-not (Test-Path $emulator)) { throw "Emulator not found: $emulator" }

Write-Output '=== 1. Unity Capture / DirectShow diagnostics ==='
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $diag -Emulator $emulator -Avd $Avd
$diagExit = $LASTEXITCODE
Write-Output "diagnostic_exit=$diagExit"
if ($WindowsDevicePath) { Write-Output "requested_windows_device_path=$WindowsDevicePath" }
Write-Output "requested_emulator_endpoint=$WebcamEndpoint"

Write-Output '=== 2. Explicit emulator webcam probe ==='
$probe = (& $emulator "@$Avd" '-webcam-list' 2>&1) -join "`n"
$probe | Write-Output
$probeExit = $LASTEXITCODE
$listed = [regex]::Matches($probe, '(?m)^\s*(webcam\d+)\b') | ForEach-Object { $_.Groups[1].Value }
if ($listed -contains $WebcamEndpoint) {
  Write-Output "endpoint_detected=$WebcamEndpoint"
} else {
  Write-Warning "endpoint_not_detected=$WebcamEndpoint; emulator cannot consume a raw Windows DirectShow path until it lists this endpoint."
}

if (-not $NoLaunch) {
  Write-Output '=== 3. Launch AVD with selected endpoint ==='
  $existing = @(Get-Process emulator -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match [regex]::Escape($Avd) })
  if (-not $existing) {
    $args = @("@$Avd", '-no-snapshot-load', '-camera-back', $WebcamEndpoint, '-camera-front', $WebcamEndpoint)
    Start-Process -FilePath $emulator -ArgumentList $args -WindowStyle Normal | Out-Null
  } else { Write-Output 'AVD process already exists; reusing it.' }
  & $adb wait-for-device | Out-Host
  $serial = ((& $adb devices) | Where-Object { $_ -match '^emulator-\d+\s+device$' } | Select-Object -First 1) -replace '\s+device$',''
  if (-not $serial) { throw 'The emulator launched, but ADB did not expose an emulator serial.' }
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    $boot = (& $adb shell getprop sys.boot_completed 2>$null) -join "`n"
    if ($boot -match '\b1\b') { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "AVD $Avd did not reach sys.boot_completed=1." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Serial $serial
  if ($LASTEXITCODE -ne 0) { throw 'Receiver APK installation failed.' }
}

if (-not $SkipTests) {
  Write-Output '=== 4. Focused mock/manual camera tests ==='
  Push-Location $windowsRoot
  try {
    npm exec vitest -- run apps/octobrowser/test/android-camera.test.ts --reporter=verbose
    if ($LASTEXITCODE -ne 0) { throw 'Focused camera tests failed.' }
  } finally { Pop-Location }
}
Write-Output '=== CAMERA STACK VERIFICATION COMPLETE ==='
Write-Output "diagnostic_exit=$diagExit probe_exit=$probeExit endpoint=$WebcamEndpoint"
