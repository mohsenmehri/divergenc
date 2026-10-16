@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY-FINAL-UPDATE.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo UPDATE NOT COMPLETE. Read the message above; no database was replaced.
) else (
  echo UPDATE COMPLETE. You may now close this window.
)
pause
exit /b %RC%
