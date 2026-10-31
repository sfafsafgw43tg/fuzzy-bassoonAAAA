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
& $adb @target install -r $Apk
if ($LASTEXITCODE -ne 0) { throw 'The Octo Camera Controller APK could not be installed.' }
if (-not $NoLaunch) {
  & $adb @target shell am start -n 'app.octo.avdcamera/.ControllerActivity' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'The Octo Camera Controller could not be opened.' }
}
$deviceLabel = if ($Serial) { $Serial } else { 'the first ADB device' }
Write-Output "Installed app.octo.avdcamera on $deviceLabel."
