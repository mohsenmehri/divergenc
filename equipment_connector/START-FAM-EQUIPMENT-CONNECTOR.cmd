@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo Windows PowerShell is required on this VDI. No Administrator rights are required by this Connector.
  pause
  exit /b 1
)
where ssh.exe >nul 2>&1
if errorlevel 1 (
  echo OpenSSH Client (ssh.exe) is not available on this VDI. Ask the VDI team to enable only the Windows OpenSSH Client feature.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%connector.ps1"
set "RC=%ERRORLEVEL%"
echo.
echo Connector exited with code %RC%.
pause
exit /b %RC%
