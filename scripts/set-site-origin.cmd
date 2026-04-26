@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-site-origin.ps1" %*
endlocal
