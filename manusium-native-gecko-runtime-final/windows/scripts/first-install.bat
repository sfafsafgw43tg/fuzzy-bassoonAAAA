@echo off
rem scripts\first-install.bat
rem Complete first-time setup for OctoSuite on new PCs.
rem Installs all prerequisites (Node.js >= 22.12, git, Python 3, Android tools,
rem OBS virtual camera, VB-CABLE), builds dependencies ("npm install" / "npm ci",
rem "npm run build"), creates desktop shortcuts, and prepares the browser.
rem
rem Thin wrapper: all logic is in lib\octo.ps1 (Windows PowerShell 5.1, built into Windows 10/11).
rem Paths with spaces and Polish characters are safe: %~dp0 is always quoted and
rem delayed expansion is disabled (so "!" in folder names is not touched).
setlocal EnableExtensions DisableDelayedExpansion
set "OCTO_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%OCTO_PS%" set "OCTO_PS=powershell.exe"
set "OCTO_ELEVATED_ARG="
for %%A in (%*) do if /I "%%~A"=="-Elevated" set "OCTO_ELEVATED_ARG=1"
if not defined OCTO_ELEVATED_ARG (
  net session >nul 2>&1
  if errorlevel 1 (
    call :octo_elevate %*
    call set "OCTO_ELEVATE_RC=%%ERRORLEVEL%%"
    goto :octo_elevated_exit
  )
)
set "OCTO_WANTS_CONSOLE="
echo %* | find /i "-nogui" >nul 2>&1 && set "OCTO_WANTS_CONSOLE=1"
echo %* | find /i "-interactive" >nul 2>&1 && set "OCTO_WANTS_CONSOLE=1"
if not defined OCTO_WANTS_CONSOLE (
  if not defined OCTO_HIDDEN (
    if exist "%SystemRoot%\System32\wscript.exe" (
      if exist "%~dp0lib\hidden.vbs" (
        start "" /b "%SystemRoot%\System32\wscript.exe" //nologo //B "%~dp0lib\hidden.vbs" "%~f0" %*
        endlocal & exit /b 0
      )
    )
  )
)
rem Remember the console code page, switch to UTF-8 for PowerShell output, restore at the end.
set "OCTO_CP="
for /f "tokens=2 delims=:." %%a in ('chcp') do set "OCTO_CP=%%a"
chcp 65001 >nul 2>&1
set "OCTO_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%OCTO_PS%" set "OCTO_PS=powershell.exe"
"%OCTO_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\octo.ps1" first-install %*
set "OCTO_RC=%ERRORLEVEL%"
if defined OCTO_CP chcp %OCTO_CP% >nul 2>&1
if not defined OCTO_NOPAUSE pause
endlocal & exit /b %OCTO_RC%

:octo_elevated_exit
endlocal & exit /b %OCTO_ELEVATE_RC%

:octo_elevate
if "%~1"=="" (set "OCTO_ELEVATE_ARGS=__OCTO_NO_ARGS__") else (set "OCTO_ELEVATE_ARGS=%*")
"%OCTO_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\elevate-installer.ps1" -BatchPath "%~f0" -WorkingDirectory "%~dp0" %OCTO_ELEVATE_ARGS%
exit /b %ERRORLEVEL%
