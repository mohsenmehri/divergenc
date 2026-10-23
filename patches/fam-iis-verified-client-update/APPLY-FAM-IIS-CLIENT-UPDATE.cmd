@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY-FAM-IIS-CLIENT-UPDATE.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo UPDATE FAILED. No unsafe partial update was left behind; read the message above.
) else (
  echo UPDATE COMPLETE. Open the FAM address normally to confirm FAM UI-17 in the sidebar.
)
pause
exit /b %RC%
