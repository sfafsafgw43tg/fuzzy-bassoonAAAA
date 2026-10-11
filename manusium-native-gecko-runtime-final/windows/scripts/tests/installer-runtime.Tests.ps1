# Executes isolated installer functions. No tool installation, UI or browser runs.
BeforeAll {
  $file = Join-Path $PSScriptRoot '..\lib\octo.ps1'
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
  foreach ($name in @('Test-NativeRuntimeReady', 'Test-AllChromiumRuntimes', 'Get-SetupSteps', 'Invoke-Setup', 'ConvertTo-StepResult')) {
    $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true) | Select-Object -First 1
    . ([scriptblock]::Create($fn.Extent.Text))
  }
  function Warn { param($message) }
  function Say { param($message, $color) }
  function T { param($key) return $key }
  function Test-DevCheckout { return $true }
  function Test-GitCheckout { return $false }
  function Install-Prerequisites { return $true }
  function Invoke-EnsureDependencies { return $true }
  function Invoke-Npm { param($arguments) }
  function Assert-NotRunning { param($ids) }
  function New-DesktopShortcut { return $true }
  function Test-Ready { return $true }
}
Describe 'native runtime setup cannot succeed with missing payloads' {
  BeforeEach {
    $script:InstallRoot = Join-Path $TestDrive 'source'
    New-Item -ItemType Directory -Force (Join-Path $InstallRoot 'tools') | Out-Null
    '["155.0.8059.39","156.0.8078.12"]' | Set-Content (Join-Path $InstallRoot 'tools\chromium-versions.json')
    foreach ($version in @('155.0.8059.39','156.0.8078.12')) {
      $dir = Join-Path $InstallRoot "resources\engines\chromium\$version"
      New-Item -ItemType Directory -Force (Join-Path $dir 'locales') | Out-Null
      foreach ($name in @('inkbrowser-chrome.exe','chrome.dll','chrome_elf.dll','chrome_child.dll','resources.pak','chrome_100_percent.pak','chrome_200_percent.pak','icudtl.dat','v8_context_snapshot.bin','locales\en-US.pak')) {
        'fixture - not a real executable' | Set-Content (Join-Path $dir $name)
      }
      @{
        schema='octo.engine-manifest.v1'; kind='chromium'; version=$version; protocol='cdp'
        executable='inkbrowser-chrome.exe'; platforms=@('win32-x64'); distribution='source-built'; modified=$true
        sha256=(Get-FileHash (Join-Path $dir 'inkbrowser-chrome.exe') -Algorithm SHA256).Hash
      } | ConvertTo-Json | Set-Content (Join-Path $dir 'runtime.json')
    }
  }
  It 'requires both complete version directories' {
    Test-AllChromiumRuntimes (Join-Path $InstallRoot 'resources') | Should -BeTrue
    Remove-Item (Join-Path $InstallRoot 'resources\engines\chromium\156.0.8078.12\chrome.dll')
    Test-AllChromiumRuntimes (Join-Path $InstallRoot 'resources') | Should -BeFalse
  }
  It 'rejects a renamed or tampered executable' {
    Add-Content (Join-Path $InstallRoot 'resources\engines\chromium\155.0.8059.39\inkbrowser-chrome.exe') 'tampered'
    Test-AllChromiumRuntimes (Join-Path $InstallRoot 'resources') | Should -BeFalse
  }
  It 'does not package or create a shortcut after dependency failure' {
    Mock Invoke-EnsureDependencies { return $false }
    Mock Invoke-Npm { throw 'must not run' }
    Mock New-DesktopShortcut { throw 'must not run' }
    Invoke-Setup | Should -BeFalse
    Should -Invoke Invoke-Npm -Times 0
    Should -Invoke New-DesktopShortcut -Times 0
  }
  It 'does not package or create a shortcut after runtime failure' {
    Mock Test-AllChromiumRuntimes { return $false }
    Mock Invoke-Npm { throw 'must not run' }
    Mock New-DesktopShortcut { throw 'must not run' }
    Invoke-Setup | Should -BeFalse
    Should -Invoke Invoke-Npm -Times 0
    Should -Invoke New-DesktopShortcut -Times 0
  }
}
