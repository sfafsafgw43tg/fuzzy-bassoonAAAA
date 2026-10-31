[CmdletBinding()]
param(
  [string]$Serial = '',
  [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\.work\octo-camera-selection' }
$adb = if ($env:ADB) { $env:ADB } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
if (-not (Test-Path -LiteralPath $adb)) { throw "ADB was not found at $adb." }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$target = if ($Serial) { @('-s', $Serial) } else { @() }
$sandbox = 'files'
$raw = (& $adb @target exec-out run-as app.octo.avdcamera cat "$sandbox/selection.json" 2>$null | Out-String).Trim()
if (-not $raw) { throw 'The controller has no selected photo or video.' }
try { $selection = $raw | ConvertFrom-Json } catch { throw "The controller selection is invalid: $raw" }
if ($selection.type -notin @('photo', 'video')) { throw "Unsupported controller media type: $($selection.type)" }
$extension = if ($selection.type -eq 'video') { 'mp4' } elseif ($selection.extension -eq 'png') { 'png' } else { 'jpg' }
$local = Join-Path $OutputDirectory "selected.$extension"
$serialArgs = if ($Serial) { " -s `"$Serial`"" } else { '' }
$command = "`"$adb`"$serialArgs exec-out run-as app.octo.avdcamera cat `"$sandbox/selected-media`" > `"$local`""
& cmd.exe /d /c $command
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $local)) { throw 'The selected media could not be pulled from the emulator.' }
[ordered]@{ type=[string]$selection.type; path=(Resolve-Path $local).Path; name=[string]$selection.name; extension=$extension } | ConvertTo-Json
