#Requires -Version 5.1
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Config=Get-Content -Raw (Join-Path $PSScriptRoot 'settings.json') | ConvertFrom-Json
$Directory=Join-Path (Split-Path -Parent $Config.DB) 'backups'
$Logs=Join-Path (Split-Path -Parent $Config.DB) 'logs'
New-Item -ItemType Directory -Force -Path $Directory,$Logs | Out-Null
$Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
$Destination=Join-Path $Directory ('fam-'+$Stamp+'.sqlite3')
$Arguments='"'+(Join-Path $Root 'manage.py')+'" backup --db "'+$Config.DB+'" --output "'+$Destination+'"'
$Process=Start-Process -FilePath (Join-Path $Root '.venv\Scripts\python.exe') -ArgumentList $Arguments -WorkingDirectory $Root -RedirectStandardOutput (Join-Path $Logs ('backup-'+$Stamp+'.log')) -RedirectStandardError (Join-Path $Logs ('backup-'+$Stamp+'-error.log')) -Wait -PassThru -NoNewWindow
if ($Process.ExitCode -ne 0) { throw "Daily FAM backup failed. Inspect the private backup-$Stamp logs." }
Write-Host "Verified daily backup: $Destination"
# Deliberately no automatic deletion of old backups. Monitor capacity and keep
# a protected off-server copy according to the organisation's retention policy.
