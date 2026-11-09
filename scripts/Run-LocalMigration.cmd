@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Verify-LocalFoundation.ps1" -MigrateOnly
echo.
pause
