[CmdletBinding()]
param(
  [string]$Emulator = '',
  [string]$Avd = ''
)
$ErrorActionPreference = 'Continue'
$clsids = @(
  '{5C2CD55C-92AD-4999-8666-912BD3E70010}',
  '{5C2CD55C-92AD-4999-8666-912BD3E70002}'
)
Write-Output '=== Windows ==='
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Write-Output '=== Unity Capture CLSID registrations ==='
foreach ($clsid in $clsids) {
  reg.exe query "HKLM\SOFTWARE\Classes\CLSID\$clsid" /s
  reg.exe query "HKLM\SOFTWARE\Classes\Wow6432Node\CLSID\$clsid" /s
}
Write-Output '=== DirectShow video-input category ==='
reg.exe query 'HKLM\SOFTWARE\Classes\CLSID\{860BB310-5D01-11d0-BD3B-00A0C911CE86}' /s
Write-Output '=== Present host camera-like devices ==='
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
  Where-Object { $_.Class -in @('Camera','Image','Media') -or $_.FriendlyName -match '(?i)camera|webcam|unity|capture|virtual' } |
  Select-Object Class,FriendlyName,Status,InstanceId | Format-List
Write-Output '=== Native Octo camera status ==='
$root = Join-Path $PSScriptRoot '..\..\resources\native-camera'
$ctl = Join-Path $root 'octo-cameractl.exe'
$src = Join-Path $root 'octo-camera-source.dll'
$ds = Join-Path $root 'octo-directshow-camera.dll'
if (Test-Path $ctl) { & $ctl status --source $src --directshow $ds } else { Write-Output "Missing $ctl" }
Write-Output '=== Android Emulator webcam-list ==='
if (-not $Emulator) { $Emulator = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe' }
if (Test-Path $Emulator) {
  $args = @()
  if ($Avd) { $args += "@$Avd" }
  $args += '-webcam-list'
  & $Emulator @args
  Write-Output "emulator_exit=$LASTEXITCODE"
} else { Write-Output "Missing emulator at $Emulator" }
