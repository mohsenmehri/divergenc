#Requires -Version 5.1
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Config=Get-Content -Raw (Join-Path $PSScriptRoot 'settings.json') | ConvertFrom-Json
$env:FAM_PUBLIC_ORIGIN=$Config.PUBLIC_ORIGIN
$env:FAM_DB=$Config.DB
$env:FAM_BIND='127.0.0.1'
$env:FAM_PORT='8765'
# Equipment Management connects directly from this FAM server to the device
# with Windows OpenSSH (ssh.exe) through the one-shot equipment_probe.py helper.
# It is not a Worker service, VDI connector, or credential store.
$env:FAM_EQUIPMENT_OPS_ENABLED='1'
$env:FAM_EQUIPMENT_CONNECTOR_ENABLED='0'
$env:FAM_EQUIPMENT_PYTHON=Join-Path $Root '.venv\Scripts\python.exe'
$env:FAM_EQUIPMENT_SSH=Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
# Dedicated host-key store (public keys only). accept-new records a device key on
# first contact and refuses any later change; set 'strict' to require pre-trusted keys.
$EquipmentDir=Join-Path (Split-Path -Parent $Config.DB) 'equipment'
New-Item -ItemType Directory -Force -Path $EquipmentDir | Out-Null
$env:FAM_EQUIPMENT_KNOWN_HOSTS=Join-Path $EquipmentDir 'known_hosts'
$env:FAM_EQUIPMENT_RUNTIME_DIR=Join-Path $EquipmentDir 'tmp'
$env:FAM_EQUIPMENT_HOST_KEY_POLICY='accept-new'
$env:PYTHONUTF8='1'
$env:PYTHONUNBUFFERED='1'
New-Item -ItemType Directory -Force -Path $Config.LOG_DIR | Out-Null
Set-Location $Root
& (Join-Path $Root '.venv\Scripts\python.exe') (Join-Path $Root 'app.py') *>> (Join-Path $Config.LOG_DIR 'service.log')
exit $LASTEXITCODE
