@echo off
rem OctoSuite installer entrypoint.
rem All setup logic lives in lib\octo.ps1; this wrapper handles visibility.
setlocal EnableExtensions DisableDelayedExpansion
set "OCTO_DIR=%~dp0"
set "OCTO_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%OCTO_PS%" set "OCTO_PS=powershell.exe"
if not exist "%OCTO_DIR%lib\octo.ps1" goto missing_files

:choose_visibility
rem Start normally without administrator rights. Individual privileged actions
rem (drivers, Visual Studio modification, and ACL repair) request UAC only when
rem Windows requires it; ordinary setup stays in the user's account.
set "OCTO_WANTS_BACKGROUND="
echo %* | find /i "-background" >nul 2>&1 && set "OCTO_WANTS_BACKGROUND=1"
echo %* | find /i "-nogui" >nul 2>&1 && set "OCTO_WANTS_BACKGROUND=1"
echo %* | find /i "-interactive" >nul 2>&1 && set "OCTO_WANTS_BACKGROUND="
if defined OCTO_WANTS_BACKGROUND if not defined OCTO_WANTS_CONSOLE if not defined OCTO_HIDDEN if exist "%SystemRoot%\System32\wscript.exe" if exist "%OCTO_DIR%lib\hidden.vbs" (
  start "" /b "%SystemRoot%\System32\wscript.exe" //nologo //B "%OCTO_DIR%lib\hidden.vbs" "%~f0" %*
  endlocal & exit /b 0
)

:run_installer
echo [OctoSuite] Running setup. Do not close this window.
chcp 65001 >nul 2>&1
"%OCTO_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\octo.ps1" install %*
set "OCTO_RC=%ERRORLEVEL%"
if not "%OCTO_RC%"=="0" echo [OctoSuite] Setup failed. Exit code: %OCTO_RC%
if not defined OCTO_NOPAUSE pause
endlocal & exit /b %OCTO_RC%

:missing_files
echo [OctoSuite] Installer files are incomplete.
echo Expected: "%OCTO_DIR%lib\octo.ps1"
echo Re-extract the complete GitHub ZIP and run scripts\install.bat from the extracted folder.
if not defined OCTO_NOPAUSE pause
endlocal & exit /b 2
