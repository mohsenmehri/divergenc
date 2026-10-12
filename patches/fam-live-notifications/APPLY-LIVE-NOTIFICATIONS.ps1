#Requires -Version 5.1
#Requires -RunAsAdministrator
<# Applies the matching FAM central client and server status endpoint.
   No database, account, IIS binding, certificate, DNS, or firewall change. #>
[CmdletBinding()]
param(
    [string]$InstallRoot='C:\FAM',
    [string]$DataDir='C:\FAMData'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath
$Server=Join-Path $InstallRoot 'server'
$Payload=Join-Path $PatchRoot 'payload'
$SourceApp=Join-Path $Payload 'app.py'
$SourceHtml=Join-Path $Payload 'FAM.html'
$TargetApp=Join-Path $Server 'app.py'
$TargetHtml=Join-Path $Server 'www\FAM.html'
$StartPath=Join-Path $Server 'windows\start.ps1'
$BackupDir=Join-Path $DataDir 'backups'
$Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
$Backup=$null
$TaskStopped=$false
$Copied=$false

function Assert-File([string]$Path,[string]$Message) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw $Message }
}
function Stop-FamTask {
    $Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
    if (!$Task) { throw 'FAM-Central task is missing. This patch only applies to the installed central FAM server.' }
    if ($Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)) { throw 'FAM-Central is not the expected FAM backend task. No file was changed.' }
    if ($Task.State -eq 'Running') { Stop-ScheduledTask -TaskName 'FAM-Central';$script:TaskStopped=$true }
    $Until=(Get-Date).AddSeconds(30)
    while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'The FAM backend did not stop within 30 seconds. No file was changed.' }
}
function Start-FamTask { Start-ScheduledTask -TaskName 'FAM-Central' }

try {
    foreach ($Entry in @(
        @($SourceApp,'Patch payload app.py is missing.'),@($SourceHtml,'Patch payload FAM.html is missing.'),
        @($TargetApp,'Installed FAM app.py is missing.'),@($TargetHtml,'Installed FAM.html is missing.'),
        @($StartPath,'Installed FAM start.ps1 is missing.')
    )) { Assert-File $Entry[0] $Entry[1] }
    if (!(Test-Path -LiteralPath $DataDir -PathType Container)) { throw 'C:\FAMData is missing. No file was changed.' }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $Backup=Join-Path $BackupDir ('live-notifications-'+$Stamp)
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Copy-Item -LiteralPath $TargetApp -Destination (Join-Path $Backup 'app.py') -Force
    Copy-Item -LiteralPath $TargetHtml -Destination (Join-Path $Backup 'FAM.html') -Force

    Stop-FamTask
    Copy-Item -LiteralPath $SourceApp -Destination $TargetApp -Force
    Copy-Item -LiteralPath $SourceHtml -Destination $TargetHtml -Force
    $Copied=$true
    Start-FamTask

    $Until=(Get-Date).AddSeconds(30)
    while (!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { throw 'The updated FAM backend did not listen on port 8765. The backup was restored.' }

    Write-Host ''
    Write-Host 'LIVE NOTIFICATIONS PATCH APPLIED.' -ForegroundColor Green
    Write-Host ('Backup: '+$Backup)
    Write-Host 'Open FAM in browsers again; the page is configured not to cache.'
    exit 0
} catch {
    $Message=$_.Exception.Message
    if ($Copied -and $Backup) {
        try {
            # Do not overwrite files while the new backend is still importing
            # them; stop only the known FAM task before the file rollback.
            Stop-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
            $Until=(Get-Date).AddSeconds(30)
            while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
            Copy-Item -LiteralPath (Join-Path $Backup 'app.py') -Destination $TargetApp -Force
            Copy-Item -LiteralPath (Join-Path $Backup 'FAM.html') -Destination $TargetHtml -Force
            Write-Warning 'The prior FAM application files were restored from the patch backup.'
        } catch { Write-Warning 'Automatic file rollback failed; restore app.py and FAM.html from the backup path shown above.' }
    }
    if ($TaskStopped -or $Copied) {
        try { Start-FamTask } catch { Write-Warning 'FAM-Central needs administrator review in Task Scheduler.' }
    }
    Write-Host ('PATCH NOT COMPLETE: '+$Message) -ForegroundColor Red
    exit 1
}
