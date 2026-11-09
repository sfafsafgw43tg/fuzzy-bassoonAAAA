$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $root 'build'
cmake -S $root -B $build -G 'Visual Studio 18 2026' -A x64
if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed.' }
cmake --build $build --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
Write-Host (Join-Path $build 'Release\OctoAndroidManager.exe')
