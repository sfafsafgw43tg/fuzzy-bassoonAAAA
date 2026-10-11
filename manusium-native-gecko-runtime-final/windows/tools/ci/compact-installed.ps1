# Run only on a disposable Windows runner. Installs the actual NSIS artifact.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$release = Join-Path $root 'release\compact'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $release "Octo-Compact-Setup-$version.exe"
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Octo Compact'
$evidence = Join-Path $root 'ci-logs\compact'
New-Item -ItemType Directory -Force $evidence | Out-Null
function Assert($ok, $message) { if (-not $ok) { throw $message }; Write-Host "PASS: $message" }
function SizeOf([string]$dir) { return [long](Get-ChildItem -LiteralPath $dir -Recurse -File | Measure-Object Length -Sum).Sum }
Assert (Test-Path $installer) 'Installer artifact exists'
Assert (-not (Test-Path $installDir)) 'No existing compact installation'
Assert (-not (Test-Path (Join-Path $env:APPDATA 'OctoCompact'))) 'No existing compact user profile'
$p = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru
if (-not $p.WaitForExit(180000)) { $p.Kill(); throw 'Installer timed out' }
Assert ($p.ExitCode -eq 0) 'Installer exits 0'
$exe = Join-Path $installDir 'Octo Compact.exe'
foreach ($file in @('Octo Compact.exe', 'resources\app.asar', 'resources\LICENSE.octo.txt', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'icudtl.dat', 'resources.pak')) {
  Assert (Test-Path (Join-Path $installDir $file)) "Installed required file: $file"
}
Assert (-not (Test-Path (Join-Path $installDir 'resources\engines'))) 'No duplicate native engines'
Assert (-not (Test-Path (Join-Path $installDir 'resources\studio.zip'))) 'No emulator archive'
Assert ((Get-Item $exe).VersionInfo.ProductName -eq 'Octo Compact') 'Windows executable is branded Octo Compact'
& node (Join-Path $root 'tools\check-fuses.mjs') $exe
Assert ($LASTEXITCODE -eq 0) 'Installed security fuses and ASAR integrity configuration'
$installedBytes = SizeOf $installDir
$data = Join-Path $env:RUNNER_TEMP ('compact-clean-profile-' + [guid]::NewGuid().ToString('N'))
foreach ($phase in @('first', 'restart')) {
  $report = Join-Path $evidence "$phase.json"
  $arguments = @("--compact-self-test=`"$report`"", "--compact-test-data=`"$data`"")
  if ($phase -eq 'restart') { $arguments += '--compact-test-restart' }
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -RedirectStandardOutput (Join-Path $evidence "$phase.stdout.log") -RedirectStandardError (Join-Path $evidence "$phase.stderr.log")
  if (-not $p.WaitForExit(180000)) { $p.Kill(); throw "Installed browser $phase test timed out" }
  Assert ($p.ExitCode -eq 0) "Installed browser $phase test exits 0"
  Assert (Test-Path $report) "$phase test evidence exists"
  $result = Get-Content $report -Raw | ConvertFrom-Json
  Assert ($result.ok -eq $true) "$phase browser assertions passed"
  Assert ($result.platform -eq 'win32') 'Runtime actually executed on Windows'
}
$size = [ordered]@{ schema = 'octo.compact-size.v1'; version = $version; installedBytes = $installedBytes; installedMiB = [math]::Round($installedBytes / 1MB, 2); installerBytes = (Get-Item $installer).Length; testProfileBytes = (SizeOf $data); electron = $result.electron; chromium = $result.chromium; installerSha256 = (Get-FileHash -Algorithm SHA256 $installer).Hash; gitCommit = $env:GITHUB_SHA; measurement = 'Logical file bytes, excluding user data; not filesystem allocated clusters'; cleanInstallPassed = $true }
$uninstall = Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' | Select-Object -First 1
Assert ($null -ne $uninstall) 'Uninstaller exists'
$p = Start-Process -FilePath $uninstall.FullName -ArgumentList '/S' -PassThru
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'Uninstaller timed out' }
Assert ($p.ExitCode -eq 0) 'Uninstaller exits 0'
$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path $exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
Assert (-not (Test-Path $exe)) 'Uninstall removes installed executable'
$size | ConvertTo-Json | Set-Content (Join-Path $evidence 'installed-size.json') -Encoding utf8
Write-Host ($size | ConvertTo-Json)
Remove-Item -LiteralPath $data -Recurse -Force
