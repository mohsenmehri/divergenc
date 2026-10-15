#Requires -Version 5.1
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Config=Get-Content -Raw (Join-Path $PSScriptRoot 'settings.json') | ConvertFrom-Json
$env:FAM_PUBLIC_ORIGIN=$Config.PUBLIC_ORIGIN
$env:FAM_DB=$Config.DB
$env:FAM_BIND='127.0.0.1'
$env:FAM_PORT='8765'
$env:FAM_NETWORK_OPERATIONS_ENABLED=if ($Config.PSObject.Properties['NETWORK_OPERATIONS_ENABLED'] -and [bool]$Config.NETWORK_OPERATIONS_ENABLED) { '1' } else { '0' }
$env:FAM_DEVICE_NETWORKS=if ($Config.PSObject.Properties['DEVICE_NETWORKS']) { [string]$Config.DEVICE_NETWORKS } else { '' }
$env:PYTHONUTF8='1'
$env:PYTHONUNBUFFERED='1'
New-Item -ItemType Directory -Force -Path $Config.LOG_DIR | Out-Null
Set-Location $Root
& (Join-Path $Root '.venv\Scripts\python.exe') (Join-Path $Root 'app.py') *>> (Join-Path $Config.LOG_DIR 'service.log')
exit $LASTEXITCODE
