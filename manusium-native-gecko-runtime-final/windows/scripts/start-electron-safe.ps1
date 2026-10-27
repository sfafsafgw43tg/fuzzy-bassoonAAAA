[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [string[]]$ArgumentList = @(),
  [string]$WorkingDirectory = '',
  [int]$StartupTimeoutSeconds = 12,
  [ValidateSet('None', 'Software', 'Headless')][string]$FallbackMode = 'Software',
  [string]$LogDirectory = ''
)

$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
if (-not $WorkingDirectory) { $WorkingDirectory = Split-Path -Parent $Executable }
$WorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
if (-not $LogDirectory) { $LogDirectory = Join-Path $WorkingDirectory 'logs' }
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$signaturePattern = '0xC0000135|STATUS_DLL_NOT_FOUND|-1073741515|gpu_process_host|GPU process exited unexpectedly|ContextResult::kFatalFailure|Failed to create shared context'
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')

function Quote-ProcessArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\*)"', '$1$1\"' -replace '(\+)$', '$1$1') + '"'
}

function Invoke-ElectronAttempt {
  param(
    [string]$Name,
    [string[]]$Arguments
  )
  $stdoutPath = Join-Path $LogDirectory "$runId-$Name.stdout.log"
  $stderrPath = Join-Path $LogDirectory "$runId-$Name.stderr.log"
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $Executable
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw "Could not start Electron for attempt '$Name'." }
  $exited = $process.WaitForExit($StartupTimeoutSeconds * 1000)
  $stdoutText = ''
  $stderrText = ''
  if ($exited) {
    $stdoutText = $process.StandardOutput.ReadToEnd()
    $stderrText = $process.StandardError.ReadToEnd()
  }
  $stdoutText | Set-Content -LiteralPath $stdoutPath -Encoding utf8
  $stderrText | Set-Content -LiteralPath $stderrPath -Encoding utf8
  $combined = "$stdoutText`n$stderrText"
  $matched = [bool]($combined -match $signaturePattern)
  [ordered]@{
    name = $Name
    arguments = $Arguments
    pid = $process.Id
    exitedDuringStartup = $exited
    exitCode = if ($exited) { $process.ExitCode } else { $null }
    gpuFailureSignature = $matched
    stdout = $stdoutPath
    stderr = $stderrPath
    processStillRunning = -not $exited
  }
}

$attempts = @()
$first = Invoke-ElectronAttempt -Name 'normal' -Arguments $ArgumentList
$attempts += $first

# A running process is treated as a successful launch observation. The wrapper
# never kills a healthy interactive application merely because the timeout elapsed.
$shouldFallback = ($first.exitedDuringStartup -and $first.gpuFailureSignature -and $FallbackMode -ne 'None')
if ($shouldFallback) {
  $fallbackArgs = @($ArgumentList)
  $fallbackArgs += '--disable-gpu'
  $fallbackArgs += '--disable-gpu-compositing'
  $fallbackArgs += '--use-gl=disabled'
  if ($FallbackMode -eq 'Headless') { $fallbackArgs += '--headless' }
  $attempts += Invoke-ElectronAttempt -Name $FallbackMode.ToLowerInvariant() -Arguments $fallbackArgs
}

$result = [ordered]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  executable = $Executable
  workingDirectory = $WorkingDirectory
  fallbackMode = $FallbackMode
  sandboxPolicy = 'preserved; --no-sandbox is never added'
  fallbackTriggered = $shouldFallback
  attempts = $attempts
  status = if ($attempts[-1].processStillRunning) { 'running' } elseif ($attempts[-1].gpuFailureSignature) { 'failed-gpu-initialization' } elseif ($attempts[-1].exitCode -eq 0) { 'exited-cleanly' } else { 'failed' }
}
$result | ConvertTo-Json -Depth 8
