# scripts/lib/utf8-entry.ps1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ScriptPath,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "PowerShell entrypoint was not found: $ScriptPath" }
$sourcePath=(Resolve-Path -LiteralPath $ScriptPath).Path
$source=[IO.File]::ReadAllText($sourcePath,(New-Object System.Text.UTF8Encoding($false)))
$tempPath=Join-Path (Split-Path -Parent $sourcePath) ('.octo-utf8-{0}.ps1' -f $PID)
[IO.File]::WriteAllText($tempPath,$source,(New-Object System.Text.UTF8Encoding($true)))
try { & $tempPath @Arguments; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } } finally { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
