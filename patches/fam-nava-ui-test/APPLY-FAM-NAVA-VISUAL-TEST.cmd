@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY-FAM-NAVA-VISUAL-TEST.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo NAVA VISUAL TEST FAILED. See the message above.
) else (
  echo NAVA VISUAL TEST COMPLETE. Open https://ertebatat-fam/FAM.html to review it.
)
pause
exit /b %RC%
