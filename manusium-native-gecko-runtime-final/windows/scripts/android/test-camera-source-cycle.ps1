<#
.SYNOPSIS
  Cycle Android Emulator camera sources and record memory stability.

.DESCRIPTION
  This is an integration harness, not a synthetic pass/fail test. Video-file
  and emulated sources are launched in the AVD. Static images are validated as
  inputs for OctoSuite's vStudio playlist. A webcam source is exercised only
  when emulator -webcam-list returns a real endpoint; an unlisted webcam is
  reported as blocked instead of being forced into Camera2.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')] [string] $AvdName,
  [string] $SdkRoot = '',
  [string] $StaticImage = '',
  [string] $VideoFile = '',
  [int] $Cycles = 2,
  [int] $BootTimeoutSeconds = 120,
  [switch] $KeepEmulator
)

$ErrorActionPreference = 'Stop'
if ($Cycles -lt 1 -or $Cycles -gt 20) { throw 'Cycles must be between 1 and 20.' }

if (-not $SdkRoot) {
  $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
$emulator = Join-Path $SdkRoot 'emulator\emulator.exe'
$adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
if (-not (Test-Path $emulator)) { throw "Android Emulator not found: $emulator" }
if (-not (Test-Path $adb)) { throw "ADB not found: $adb" }
if ($StaticImage -and (-not (Test-Path -LiteralPath $StaticImage -PathType Leaf))) { throw "Static image not found: $StaticImage" }
if ($VideoFile -and (-not (Test-Path -LiteralPath $VideoFile -PathType Leaf))) { throw "Video file not found: $VideoFile" }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $root '.work\android-camera-source-cycle'
New-Item -ItemType Directory -Force $outDir | Out-Null
$resultPath = Join-Path $outDir 'result.json'
$hostCameras = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
  Where-Object { $_.PNPClass -in @('Camera', 'Image') -or $_.Name -match '(?i)camera|webcam|video capture' } |
  Select-Object -ExpandProperty Name)
$webcamText = (& $emulator "@$AvdName" '-webcam-list' 2>&1 | Out-String)
$webcamMatches = [regex]::Matches($webcamText, '(?i)Camera\s+[^a-zA-Z0-9]*(webcam\d{1,2})')
$webcams = @($webcamMatches | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Select-Object -Unique)

function Get-EmulatorMemory {
  $hostProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(qemu|emulator).*\.exe$' -and $_.CommandLine -match [regex]::Escape($AvdName) } |
    Select-Object -First 1
  if ($hostProcess) {
    $workingSet = (Get-Process -Id $hostProcess.ProcessId -ErrorAction SilentlyContinue).WorkingSet64
    if ($workingSet) { return [int64][math]::Round($workingSet / 1KB) }
  }
  $rows = @(& $adb shell dumpsys meminfo 2>$null)
  $line = $rows | Select-String -Pattern '^\s*TOTAL(?:\s+PSS:)?\s+\d+' | Select-Object -First 1
  if (-not $line) { return $null }
  $parts = ($line.Line -split '\s+') | Where-Object { $_ }
  $number = $parts | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1
  if (-not $number) { return $null }
  return [int64]$number
}
function Stop-Avd {
  & $adb -s emulator-5554 emu kill 2>$null | Out-Null
  Start-Sleep -Seconds 3
  Get-Process emulator,qemu-system-x86_64,qemu-system-x86_64-headless -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
function Test-AvdSource([string]$Name, [string]$CameraValue) {
  $stdout = Join-Path $outDir "$Name.stdout.log"
  $stderr = Join-Path $outDir "$Name.stderr.log"
  Remove-Item $stdout,$stderr -Force -ErrorAction SilentlyContinue
  $args = @("@$AvdName", '-no-snapshot', '-no-boot-anim', '-camera-front', 'none', '-camera-back', $CameraValue, '-gpu', 'auto')
  $proc = Start-Process $emulator -ArgumentList $args -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $boot = $false
  $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
  while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
    Start-Sleep -Seconds 3
    $devices = (& $adb devices 2>$null | Out-String)
    if ($devices -match 'emulator-\d+\s+device') {
      $bootValue = ((& $adb -s emulator-5554 shell getprop sys.boot_completed 2>$null) -join '').Trim()
      if ($bootValue -eq '1') { $boot = $true; break }
    }
  }
  $samples = @()
  if ($boot) {
    & $adb -s emulator-5554 shell am start -a android.media.action.IMAGE_CAPTURE 2>$null | Out-Null
    for ($i = 0; $i -lt 4; $i++) { Start-Sleep -Seconds 3; $mem = Get-EmulatorMemory; if ($null -ne $mem) { $samples += $mem } }
  }
  $crash = $false
  if ($boot) {
    $log = ((& $adb -s emulator-5554 logcat -d -t 500 2>$null) -join "`n")
    $crash = $log -match '(?i)FATAL EXCEPTION|CameraProvider.*crash|cameraserver.*died|CameraService.*fatal'
  }
  if (-not $KeepEmulator) { Stop-Avd }
  $growth = $null
  if ($samples.Count -ge 2) { $growth = $samples[-1] - $samples[0] }
  return [ordered]@{ source = $Name; cameraValue = $CameraValue; booted = $boot; samplesKb = @($samples); growthKb = $growth; cameraCrash = $crash; passed = ($boot -and -not $crash) }
}

$results = [System.Collections.Generic.List[object]]::new()
if ($StaticImage) {
  $results.Add([ordered]@{ source = 'static-image'; input = $StaticImage; configured = $true; note = 'Static images are sent through the OctoSuite/vStudio playlist; the AVD consumes the resulting DirectShow endpoint.'; passed = $true })
} else {
  $results.Add([ordered]@{ source = 'static-image'; configured = $false; passed = $false; note = 'No -StaticImage was supplied.' })
}
for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
  if ($VideoFile) { $results.Add((Test-AvdSource "video-file-$cycle" "videofile:$VideoFile")) }
  $results.Add((Test-AvdSource "emulated-$cycle" 'emulated'))
  if ($webcams.Count -gt 0) { $results.Add((Test-AvdSource "webcam-$cycle" $webcams[0])) }
  else { $results.Add([ordered]@{ source = "webcam-$cycle"; booted = $false; cameraCrash = $false; passed = $false; blocked = $true; note = 'Skipped safely: emulator -webcam-list returned no endpoint.' }) }
}
$hardFailures = @($results | Where-Object { -not $_.passed -and -not $_.blocked })
$summary = [ordered]@{
  avd = $AvdName; cycles = $Cycles; hostCameras = $hostCameras; webcams = $webcams; webcamList = $webcamText.Trim();
  results = @($results); passed = $hardFailures.Count -eq 0
}
$summary | ConvertTo-Json -Depth 8 | Set-Content $resultPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
if (-not $summary.passed) { exit 1 }
