@echo off
rem OctoSuite first-install launcher.
setlocal EnableExtensions DisableDelayedExpansion
set "OCTO_ROOT=%~dp0"
title OctoSuite First Install
echo [OctoSuite] Launching first-time setup...
if not exist "%OCTO_ROOT%scripts\first-install.bat" goto missing
call "%OCTO_ROOT%scripts\first-install.bat" %*
set "OCTO_RC=%ERRORLEVEL%"
echo [OctoSuite] First-time setup finished with exit code %OCTO_RC%.
if not defined OCTO_NOPAUSE pause
endlocal & exit /b %OCTO_RC%

:missing
echo [OctoSuite] Missing scripts\first-install.bat.
echo Re-extract the complete ZIP before running setup.
if not defined OCTO_NOPAUSE pause
endlocal & exit /b 2
