[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$AvdName,
  [string]$Serial = '',
  [string]$Emulator = '',
  [string]$OutputDirectory = '',
  [int]$Width = 1280,
  [int]$Height = 720,
  [ValidateSet('stretch','fit','crop')][string]$Fit = 'fit'
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Emulator)) { $Emulator = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\.work\octo-camera-selection' }
$adb = if ($env:ADB) { $env:ADB } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
$sync = Join-Path $PSScriptRoot 'sync-octo-camera-selection.ps1'
$prepareImage = Join-Path $PSScriptRoot 'prepare-octo-camera-image.ps1'
$controllerApk = Join-Path $PSScriptRoot '..\..\android\avd-camera-check\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $Emulator)) { throw "Emulator was not found at $Emulator." }
if ($Serial -and -not ((& $adb devices 2>$null) -match [regex]::Escape($Serial))) { $Serial = '' }
$syncArgs = @('-OutputDirectory', $OutputDirectory)
if ($Serial) { $syncArgs = @('-Serial', $Serial) + $syncArgs }
$selection = (& powershell -NoProfile -ExecutionPolicy Bypass -File $sync @syncArgs | ConvertFrom-Json)
if (-not $selection.type -or -not $selection.path -or -not (Test-Path -LiteralPath ([string]$selection.path))) { throw 'The controller did not provide a readable selected media file.' }
$sourcePath = [string]$selection.path
if ($selection.type -eq 'photo') {
  $prepared = Join-Path $OutputDirectory "camera-$Width`x$Height-$Fit.jpg"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $prepareImage -InputPath $sourcePath -OutputPath $prepared -Width $Width -Height $Height -Fit $Fit | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $prepared)) { throw 'The selected image could not be resized for the emulator camera.' }
  $sourcePath = (Resolve-Path $prepared).Path
}
$cameraArgument = if ($selection.type -eq 'video') { "videofile:$sourcePath" } else { "imagefile:$sourcePath" }
$old = Get-Process emulator* -ErrorAction SilentlyContinue
if ($old) {
  if (Test-Path $adb) { & $adb emu kill 2>$null | Out-Null }
  Start-Sleep -Seconds 2
  Get-Process emulator* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
$args = @('@' + $AvdName, '-no-snapshot', '-camera-front', 'none', '-camera-back', $cameraArgument)
Start-Process -FilePath $Emulator -ArgumentList $args | Out-Null
Write-Output "Started $AvdName with back camera source: $cameraArgument"
if (Test-Path $adb) {
  $deadline = (Get-Date).AddSeconds(90)
  $boot = ''
  do {
    try { & $adb wait-for-device 2>$null | Out-Null; $boot = (& $adb shell getprop sys.boot_completed 2>$null).Trim() } catch { $boot = '' }
    if ($boot -eq '1') { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  if ($boot -ne '1') { throw 'The emulator did not finish booting within 90 seconds.' }
  if (-not (Test-Path -LiteralPath $controllerApk)) { throw "Controller APK was not found at $controllerApk." }
  & $adb install -r $controllerApk | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The controller APK could not be installed after the AVD booted.' }
  & $adb shell am start -n 'app.octo.avdcamera/.ControllerActivity' | Out-Null
  Write-Output 'Octo Camera Controller opened on the device.'
}
