@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "VENV=%LOCALAPPDATA%\FAM-Equipment-Connector\venv"
set "PYTHON="

for %%V in (3.14 3.13 3.12) do (
  if not defined PYTHON (
    py -%%V -c "import sys;print(sys.executable)" >nul 2>&1 && set "PYTHON=py -%%V"
  )
)
if not defined PYTHON (
  python --version >nul 2>&1 && set "PYTHON=python"
)
if not defined PYTHON (
  echo Python 3.12, 3.13 or 3.14 is required on this VDI. No Administrator rights are needed if your VDI team provides a user-accessible Python.
  pause
  exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
  %PYTHON% -m venv "%VENV%"
  if errorlevel 1 goto :failed
)
"%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check --no-input --no-index --find-links "%ROOT%wheels" netmiko==4.8.0
if errorlevel 1 goto :failed
"%VENV%\Scripts\python.exe" "%ROOT%connector.py"
set "RC=%ERRORLEVEL%"
echo.
echo Connector exited with code %RC%.
pause
exit /b %RC%

:failed
echo.
echo The local Connector environment could not be prepared. No device credential was saved.
pause
exit /b 1
