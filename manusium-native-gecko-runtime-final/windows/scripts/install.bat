@echo off
rem OctoSuite installer entrypoint.
rem This file intentionally stays small: all setup logic lives in lib\octo.ps1.
setlocal EnableExtensions DisableDelayedExpansion
set "OCTO_DIR=%~dp0"
set "OCTO_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%OCTO_PS%" set "OCTO_PS=powershell.exe"

echo [OctoSuite] Starting installer...
if not exist "%OCTO_DIR%lib\octo.ps1" goto missing_files
if not exist "%OCTO_DIR%lib\elevate-installer.ps1" goto missing_files

rem Do not use net session or a parenthesized elevation block. Both can fail silently
rem on locked-down Windows installations. fltmc is part of Windows and gives a
rem reliable administrator-token check.
if /I "%~1"=="-Elevated" goto run_installer
fltmc >nul 2>&1
if not errorlevel 1 goto run_installer
goto request_elevation

:request_elevation
if "%~1"=="" (set "OCTO_ELEVATE_ARGS=__OCTO_NO_ARGS__") else (set "OCTO_ELEVATE_ARGS=%*")
echo [OctoSuite] Requesting administrator permission...
"%OCTO_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%OCTO_DIR%lib\elevate-installer.ps1" -BatchPath "%~f0" -WorkingDirectory "%OCTO_DIR%" %OCTO_ELEVATE_ARGS%
set "OCTO_RC=%ERRORLEVEL%"
if "%OCTO_RC%"=="0" goto elevation_done
echo [OctoSuite] Administrator elevation failed or was cancelled. Exit code: %OCTO_RC%
if not defined OCTO_NOPAUSE pause
endlocal & exit /b %OCTO_RC%

:elevation_done
endlocal & exit /b 0

:run_installer
echo [OctoSuite] Running setup. Do not close this window.
chcp 65001 >nul 2>&1
"%OCTO_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%OCTO_DIR%lib\octo.ps1" install %*
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
