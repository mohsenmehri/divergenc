@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROLLBACK-LATEST-FAM-NAVA-VISUAL-TEST.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ROLLBACK FAILED. See the message above.
) else (
  echo ROLLBACK COMPLETE. Open FAM normally to confirm the prior client returned.
)
pause
exit /b %RC%
