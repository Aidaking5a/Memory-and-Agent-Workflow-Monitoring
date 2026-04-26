@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-theia-local-env.ps1" %*
endlocal