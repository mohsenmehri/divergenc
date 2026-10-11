#Requires -Version 5.1
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Config=Get-Content -Raw (Join-Path $PSScriptRoot 'settings.json') | ConvertFrom-Json
$Directory=Join-Path (Split-Path -Parent $Config.DB) 'backups'
New-Item -ItemType Directory -Force -Path $Directory | Out-Null
$Name='fam-'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)+'.sqlite3'
& (Join-Path $Root '.venv\Scripts\python.exe') (Join-Path $Root 'manage.py') backup --db $Config.DB --output (Join-Path $Directory $Name)
if ($LASTEXITCODE -ne 0) { throw 'Daily FAM database backup failed.' }
# Deliberately no automatic deletion of old backups. Monitor capacity and keep
# a protected off-server copy according to the organisation's retention policy.
