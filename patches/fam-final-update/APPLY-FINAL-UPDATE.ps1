#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
Applies the complete FAM update: central live notices, contrast fixes,
manual server backups, and the daily 23:00 backup schedule.
It never replaces the database or changes IIS, DNS, certificates, or accounts.
#>
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
$SourceDaily=Join-Path $Payload 'backup-daily.ps1'
$TargetApp=Join-Path $Server 'app.py'
$TargetHtml=Join-Path $Server 'www\FAM.html'
$TargetDaily=Join-Path $Server 'windows\backup-daily.ps1'
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
    if (!$Task) { throw 'FAM-Central task is missing. This update only applies to the installed central FAM server.' }
    if ($Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)) { throw 'FAM-Central is not the expected FAM backend task. No file was changed.' }
    if ($Task.State -eq 'Running') { Stop-ScheduledTask -TaskName 'FAM-Central';$script:TaskStopped=$true }
    $Until=(Get-Date).AddSeconds(30)
    while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'The FAM backend did not stop within 30 seconds. No file was changed.' }
}
function Start-FamTask { Start-ScheduledTask -TaskName 'FAM-Central' }
function Set-DailyBackupTask {
    $Action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$TargetDaily+'"') -WorkingDirectory $Server
    $Principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
    $Settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName 'FAM-Central-Backup' -Action $Action -Trigger (New-ScheduledTaskTrigger -Daily -At '23:00') -Principal $Principal -Settings $Settings -Force | Out-Null
}

try {
    foreach ($Entry in @(
        @($SourceApp,'Patch payload app.py is missing.'),@($SourceHtml,'Patch payload FAM.html is missing.'),@($SourceDaily,'Patch payload backup-daily.ps1 is missing.'),
        @($TargetApp,'Installed FAM app.py is missing.'),@($TargetHtml,'Installed FAM.html is missing.'),@($TargetDaily,'Installed backup-daily.ps1 is missing.'),
        @($StartPath,'Installed FAM start.ps1 is missing.')
    )) { Assert-File $Entry[0] $Entry[1] }
    if (!(Test-Path -LiteralPath $DataDir -PathType Container)) { throw 'C:\FAMData is missing. No file was changed.' }
    $ExistingBackup=Get-ScheduledTask -TaskName 'FAM-Central-Backup' -ErrorAction SilentlyContinue
    if ($ExistingBackup -and $ExistingBackup.State -eq 'Running') { throw 'The daily FAM backup is currently running. Wait for it to finish and run this update again.' }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $Backup=Join-Path $BackupDir ('final-update-'+$Stamp)
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Copy-Item -LiteralPath $TargetApp -Destination (Join-Path $Backup 'app.py') -Force
    Copy-Item -LiteralPath $TargetHtml -Destination (Join-Path $Backup 'FAM.html') -Force
    Copy-Item -LiteralPath $TargetDaily -Destination (Join-Path $Backup 'backup-daily.ps1') -Force

    Stop-FamTask
    Copy-Item -LiteralPath $SourceApp -Destination $TargetApp -Force
    Copy-Item -LiteralPath $SourceHtml -Destination $TargetHtml -Force
    Copy-Item -LiteralPath $SourceDaily -Destination $TargetDaily -Force
    $Copied=$true
    Start-FamTask

    $Until=(Get-Date).AddSeconds(30)
    while (!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { throw 'The updated FAM backend did not listen on port 8765. The prior files will be restored.' }
    Set-DailyBackupTask

    Write-Host ''
    Write-Host 'FINAL FAM UPDATE APPLIED.' -ForegroundColor Green
    Write-Host ('Previous application files: '+$Backup)
    Write-Host 'Daily verified database backup: 23:00 server local time.'
    Write-Host 'Open FAM and use پشتیبان‌گیری as level-1 administrator for an immediate dated server backup.'
    exit 0
} catch {
    $Message=$_.Exception.Message
    if ($Copied -and $Backup) {
        try {
            Stop-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
            $Until=(Get-Date).AddSeconds(30)
            while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
            Copy-Item -LiteralPath (Join-Path $Backup 'app.py') -Destination $TargetApp -Force
            Copy-Item -LiteralPath (Join-Path $Backup 'FAM.html') -Destination $TargetHtml -Force
            Copy-Item -LiteralPath (Join-Path $Backup 'backup-daily.ps1') -Destination $TargetDaily -Force
            Write-Warning 'The prior FAM application files were restored from the update backup.'
        } catch { Write-Warning 'Automatic file rollback failed; restore app.py, FAM.html, and backup-daily.ps1 from the backup path shown above.' }
    }
    if ($TaskStopped -or $Copied) {
        try { Start-FamTask } catch { Write-Warning 'FAM-Central needs administrator review in Task Scheduler.' }
    }
    Write-Host ('UPDATE NOT COMPLETE: '+$Message) -ForegroundColor Red
    exit 1
}
