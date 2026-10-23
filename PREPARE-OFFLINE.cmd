@echo off
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
echo Run this ONLY on an Internet-connected Windows PC. It downloads files, not software installations.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\windows\prepare-offline.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo PREPARATION INCOMPLETE. Do not transfer an incomplete kit; read the error above.
pause
exit /b %RESULT%
