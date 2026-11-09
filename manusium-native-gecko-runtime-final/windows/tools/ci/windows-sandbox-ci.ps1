$ErrorActionPreference = 'Stop'

Write-Host "Windows Sandbox CI probe on $([Environment]::OSVersion.VersionString)"
$feature = Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -ErrorAction SilentlyContinue
$available = $feature -and $feature.State -eq 'Enabled'

if (-not $available) {
  Write-Warning 'Windows Sandbox is not enabled on this hosted runner. Running the platform-safe generator/guard tests only; no live VM claim is made.'
  exit 0
}

$windowsSandbox = Join-Path $env:windir 'System32\WindowsSandbox.exe'
if (-not (Test-Path -LiteralPath $windowsSandbox)) {
  Write-Warning 'Windows Sandbox feature is enabled but WindowsSandbox.exe is missing; skipping live launch.'
  exit 0
}

$root = Join-Path $env:RUNNER_TEMP 'octosuite-wsb-ci'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$marker = Join-Path $root 'sandbox-ran.txt'
$wsb = Join-Path $root 'smoke.wsb'
$escaped = [System.Security.SecurityElement]::Escape($root)
@"
<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$escaped</HostFolder>
      <SandboxFolder>C:\\OctoCi</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>cmd.exe /c echo ok&gt; C:\\OctoCi\\sandbox-ran.txt</Command>
  </LogonCommand>
</Configuration>
"@ | Set-Content -LiteralPath $wsb -Encoding UTF8

Write-Host 'Launching a disposable Windows Sandbox smoke VM.'
$proc = Start-Process -FilePath $windowsSandbox -ArgumentList @($wsb) -PassThru
$deadline = (Get-Date).AddMinutes(8)
while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $marker)) {
  Start-Sleep -Seconds 5
}
if (-not (Test-Path -LiteralPath $marker)) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'Windows Sandbox launched but did not create the CI marker before the timeout.'
}
Write-Host 'Live Windows Sandbox smoke launch passed.'
try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
