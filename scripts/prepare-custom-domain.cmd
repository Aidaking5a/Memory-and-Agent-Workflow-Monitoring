@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-custom-domain.ps1" %*
