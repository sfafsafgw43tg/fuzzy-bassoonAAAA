@echo off
setlocal
cd /d "%~dp0"
title OctoSuite - rebuild profile startup fix

echo [1/3] Repairing dependencies and Electron runtime...
node tools\ensure-deps.mjs
if errorlevel 1 goto :fail

echo [2/3] Typechecking...
npm.cmd run typecheck
if errorlevel 1 goto :fail

echo [3/3] Rebuilding OctoBrowser...
npm.cmd run build:browser
if errorlevel 1 goto :fail

echo.
echo SUCCESS: profile startup fix rebuilt. Launching Electron now...
npm.cmd run start
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo FAILED with exit code %errorlevel%.
echo Keep this window open and send the error output.
pause
exit /b 1
