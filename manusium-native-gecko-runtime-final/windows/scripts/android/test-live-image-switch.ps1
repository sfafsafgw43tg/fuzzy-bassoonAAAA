[CmdletBinding()]
param(
  [int]$Port = 8876,
  [string]$Frame = '',
  [string]$ReplacementFrame = ''
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$serverScript = Join-Path $repo 'windows\scripts\android\start-live-camera-server.cjs'
if (-not $Frame) { $Frame = Join-Path $repo '.work\camera-test\chosen-photo-test.jpg' }
if (-not $ReplacementFrame) { $ReplacementFrame = $Frame }
foreach ($required in @($serverScript, $Frame, $ReplacementFrame)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required file was not found: $required" }
}

$oldFrame = $env:OCTO_CAMERA_FRAME
$oldPort = $env:OCTO_CAMERA_PORT
$env:OCTO_CAMERA_FRAME = (Resolve-Path $Frame).Path
$env:OCTO_CAMERA_PORT = [string]$Port
$log = Join-Path $repo 'windows\.work\live-image-switch.log'
$err = "$log.err"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$process = Start-Process node.exe -ArgumentList @($serverScript) -WorkingDirectory (Join-Path $repo 'windows') -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
try {
  $before = $null
  for ($i = 0; $i -lt 30 -and -not $before; $i++) {
    try {
      $candidate = Invoke-RestMethod "http://127.0.0.1:$Port/health"
      if ($candidate.running) { $before = $candidate }
    } catch {}
    if (-not $before) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $before) { throw "MJPEG server did not start. See $log and $err" }

  # Replace the selected source atomically so an active reader never sees a partial JPEG.
  $replacement = (Resolve-Path $ReplacementFrame).Path
  $temporary = "$($env:OCTO_CAMERA_FRAME).replace-$PID"
  Copy-Item -LiteralPath $replacement -Destination $temporary -Force
  Move-Item -LiteralPath $temporary -Destination $env:OCTO_CAMERA_FRAME -Force
  Start-Sleep -Milliseconds 500
  $after = Invoke-RestMethod "http://127.0.0.1:$Port/health"
  Write-Output "Before: frameVersion=$($before.frameVersion) frameBytes=$($before.frameBytes)"
  Write-Output "After:  frameVersion=$($after.frameVersion) frameBytes=$($after.frameBytes)"
  if ([int]$after.frameVersion -le [int]$before.frameVersion) { throw 'The active MJPEG stream did not observe the replacement image.' }
  Write-Output 'LIVE_IMAGE_SWITCH=PASS (server stayed running; no emulator restart required)'
} finally {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  if ($null -eq $oldFrame) { Remove-Item Env:OCTO_CAMERA_FRAME -ErrorAction SilentlyContinue } else { $env:OCTO_CAMERA_FRAME = $oldFrame }
  if ($null -eq $oldPort) { Remove-Item Env:OCTO_CAMERA_PORT -ErrorAction SilentlyContinue } else { $env:OCTO_CAMERA_PORT = $oldPort }
}
