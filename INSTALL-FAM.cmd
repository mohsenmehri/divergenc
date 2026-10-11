@echo off
setlocal
set "FAM_SETUP_SCRIPT=%~dp0server\windows\setup-ertebatat.ps1"
set "FAM_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "FAM_POWERSHELL=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
"%FAM_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "try { $q=[char]34; $a='-NoProfile -ExecutionPolicy Bypass -File '+$q+$env:FAM_SETUP_SCRIPT+$q+' -PauseAtEnd'; $p=Start-Process -FilePath $env:FAM_POWERSHELL -Verb RunAs -ArgumentList $a -Wait -PassThru; exit $p.ExitCode } catch { Write-Error $_; exit 1 }"
set "FAM_EXIT=%ERRORLEVEL%"
if "%FAM_EXIT%"=="0" echo FAM server setup completed. Read the client trust instructions.
if "%FAM_EXIT%"=="2" echo FAM server configured; DNS/client readiness still needs verification.
if not "%FAM_EXIT%"=="0" if not "%FAM_EXIT%"=="2" echo Setup did not complete. Check the private setup log under C:\FAMData\logs.
pause
exit /b %FAM_EXIT%
