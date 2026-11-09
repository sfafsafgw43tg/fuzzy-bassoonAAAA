@echo off
rem OctoSuite root installer launcher.
setlocal EnableExtensions DisableDelayedExpansion
set "OCTO_ROOT=%~dp0"
title OctoSuite Installer
echo [OctoSuite] Launching installer...
if not exist "%OCTO_ROOT%scripts\install.bat" goto missing
call "%OCTO_ROOT%scripts\install.bat" %*
set "OCTO_RC=%ERRORLEVEL%"
echo [OctoSuite] Installer finished with exit code %OCTO_RC%.
if not defined OCTO_NOPAUSE pause
endlocal & exit /b %OCTO_RC%

:missing
echo [OctoSuite] Missing scripts\install.bat.
echo Re-extract the complete ZIP before running the installer.
if not defined OCTO_NOPAUSE pause
endlocal & exit /b 2
