[CmdletBinding()]
param(
  [string]$Serial = '',
  [string]$Apk = '',
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$ifEmptyApk = [string]::IsNullOrWhiteSpace($Apk)
if ($ifEmptyApk) { $Apk = Join-Path $PSScriptRoot '..\..\android\avd-camera-check\app\build\outputs\apk\debug\app-debug.apk' }
$adb = if ($env:ADB) { $env:ADB } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
if (-not (Test-Path -LiteralPath $adb)) { throw "ADB was not found at $adb. Set ADB to your adb.exe path." }
if (-not (Test-Path -LiteralPath $Apk)) { throw "APK was not found at $Apk. Build it first with .\gradlew.bat :app:assembleDebug." }
$target = if ($Serial) { @('-s', $Serial) } else { @() }
& $adb @target wait-for-device
if ($LASTEXITCODE -ne 0) { throw 'ADB did not become ready.' }
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  $boot = (& $adb @target shell getprop sys.boot_completed 2>$null) -join "`n"
  $packages = (& $adb @target shell cmd package list packages 2>$null) -join "`n"
  if ($boot -match '\b1\b' -and $packages -match 'package:' -and $packages -notmatch "Can't find service|offline|error:") { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'Android booted for ADB, but its package service did not become ready.' }
& $adb @target reverse tcp:8765 tcp:8765
if ($LASTEXITCODE -ne 0) { throw 'The ADB reverse tunnel for the live camera stream could not be created.' }
$installed = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $output = (& $adb @target install -r $Apk 2>&1) -join "`n"
  if ($LASTEXITCODE -eq 0 -and $output -match '(?m)^Success\b') { $installed = $true; break }
  if ($output -notmatch 'package service|device offline|device not found') { break }
  Start-Sleep -Seconds 3
}
if (-not $installed) { throw "The Octo Camera Controller APK could not be installed: $output" }
$packagePath = (& $adb @target shell pm path app.octo.avdcamera 2>&1) -join "`n"
$packagePath | Out-Host
if ($LASTEXITCODE -ne 0 -or $packagePath -notmatch '(?m)^package:') { throw 'The package manager did not confirm app.octo.avdcamera after installation.' }
if (-not $NoLaunch) {
  & $adb @target shell am start -n 'app.octo.avdcamera/.ControllerActivity' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'The Octo Camera Controller could not be opened.' }
}
$deviceLabel = if ($Serial) { $Serial } else { 'the first ADB device' }
Write-Output "Installed app.octo.avdcamera on $deviceLabel."
