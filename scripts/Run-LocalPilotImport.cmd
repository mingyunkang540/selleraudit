@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-LocalPilot.ps1" -EnableImport
echo.
pause
