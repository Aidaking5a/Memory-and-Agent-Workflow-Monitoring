@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-theia-local-infra.ps1" %*
