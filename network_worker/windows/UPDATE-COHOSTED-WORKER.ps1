#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
Reconfigure the FAM Network Worker as a token-free co-hosted local Worker.
It talks only to http://127.0.0.1:8765/_internal; browser users cannot reach
that namespace through IIS.  No device credential, browser-visible token, or
named Worker account is created by this script.
#>
[CmdletBinding()]
param(
  [string]$WorkerRoot='C:\FAM-NetworkWorker',
  [string]$TaskName='FAM-NetworkWorker'
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$Python=Join-Path $WorkerRoot 'venv\Scripts\python.exe'
$Package=Join-Path $WorkerRoot 'network_worker'
$Private=Join-Path $WorkerRoot 'private'
foreach($Path in @($Python,(Join-Path $Package 'main.py'),(Join-Path $Package 'client.py'))){
  if(!(Test-Path -LiteralPath $Path -PathType Leaf)){throw ('Required Worker file is missing: '+$Path)}
}
New-Item -ItemType Directory -Force -Path $Private|Out-Null
$Config=[ordered]@{
  controlPlaneUrl='http://127.0.0.1:8765'
  workerId='worker-fam-local'
  pollSeconds=15
  maxParallel=1
  caFile=$null
  probeKeyStore=[ordered]@{type='windows-dpapi';path=(Join-Path $Private 'interactive-probe-key.dpapi')}
  devices=@()
}
[IO.File]::WriteAllText((Join-Path $Private 'worker.json'),($Config|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$Runner = @"
@echo off
setlocal DisableDelayedExpansion
cd /d "$WorkerRoot"

:run
"$Python" -m network_worker.main --config "$Private\worker.json"
timeout /t 30 /nobreak >nul
goto run
"@
[IO.File]::WriteAllText((Join-Path $Private 'run-worker.cmd'),$Runner,[Text.Encoding]::ASCII)
Remove-Item -LiteralPath (Join-Path $Private 'worker.log') -Force -ErrorAction SilentlyContinue
# Remove the old persistent device-credential store; direct credentials stay only in Worker memory.
Remove-Item -LiteralPath (Join-Path $Private 'secrets.json.dpapi') -Force -ErrorAction SilentlyContinue
# Local Service can execute package code and owns only the private DPAPI files.
& icacls.exe $WorkerRoot /grant '*S-1-5-19:(OI)(CI)RX' | Out-Null
& icacls.exe $Private /inheritance:r | Out-Null
& icacls.exe $Private /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
$TaskPath='\' + $TaskName
& schtasks.exe /End /TN $TaskPath 2>$null | Out-Null
& schtasks.exe /Create /TN $TaskPath /SC ONSTART /RU 'NT AUTHORITY\LOCAL SERVICE' /RL LIMITED /TR (Join-Path $Private 'run-worker.cmd') /F | Out-Null
if($LASTEXITCODE -ne 0){throw 'Task Scheduler could not create the Worker task.'}
& schtasks.exe /Run /TN $TaskPath | Out-Null
if($LASTEXITCODE -ne 0){throw 'Task Scheduler could not start the Worker task.'}
Write-Host 'CO-HOSTED WORKER UPDATED. No browser-visible Worker token is used.' -ForegroundColor Green
Write-Host 'Refresh /network-operations after 20 seconds; the automatic local Worker should be ready.'
