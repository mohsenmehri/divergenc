@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROLLBACK-CUSTOM-ACCESS-UPDATE.ps1"
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
