@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-desktop-installer-win.ps1" %*
endlocal
