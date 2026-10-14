#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
  Applies the tested central custom-access migration and the opt-in, read-only
  Network Operations control plane. The SQLite migrations are additive; this
  updater never rewrites state, worksheets, accounts, passwords, or backups.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot='C:\FAM',
    [string]$DataDir='C:\FAMData'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath
$Payload=Join-Path $PatchRoot 'payload'
$Server=Join-Path $InstallRoot 'server'
$SourceApp=Join-Path $Payload 'app.py'
$SourceNetworkOps=Join-Path $Payload 'network_ops.py'
$SourceNetworkPage=Join-Path $Payload 'network_operations.html'
$SourceHtml=Join-Path $Payload 'FAM.html'
$SourceWebConfig=Join-Path $Payload 'web.config'
$TargetApp=Join-Path $Server 'app.py'
$TargetNetworkOps=Join-Path $Server 'network_ops.py'
$TargetNetworkPage=Join-Path $Server 'network_operations.html'
$TargetHtml=Join-Path $Server 'www\FAM.html'
$TargetWebConfig=Join-Path $Server 'www\web.config'
$StartPath=Join-Path $Server 'windows\start.ps1'
$BackupDir=Join-Path $DataDir 'backups'
$Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
$Backup=$null
$TaskWasRunning=$false
$Copied=$false
$HadNetworkOps=$false
$HadNetworkPage=$false

function Assert-File([string]$Path,[string]$Message) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw $Message }
}
function Assert-PayloadHash([string]$Path,[string]$Name) {
    $Expected=($Manifest | Where-Object { $_.Name -eq $Name }).Sha256
    if (!$Expected) { throw "The SHA256 manifest has no entry for $Name." }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected.ToLowerInvariant()) {
        throw "The patch payload hash for $Name does not match SHA256SUMS.txt. No file was changed."
    }
}
function Wait-Backend([bool]$Listening) {
    $Until=(Get-Date).AddSeconds(30)
    do {
        $Open=!!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)
        if ($Open -eq $Listening) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $Until)
    if ($Listening) { throw 'The FAM backend did not listen on port 8765 within 30 seconds.' }
    throw 'The FAM backend did not stop within 30 seconds.'
}
function Stop-FamTask {
    $Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
    if (!$Task) { throw 'FAM-Central is missing. This patch only applies to the installed central FAM server.' }
    if ($Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)) {
        throw 'FAM-Central is not the expected FAM backend task. No file was changed.'
    }
    $script:TaskWasRunning=$Task.State -eq 'Running'
    if ($script:TaskWasRunning) { Stop-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $false }
}
function Start-FamTask { Start-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $true }
function Restore-Backup {
    if (!$Backup) { return }
    Stop-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
    try { Wait-Backend $false } catch { }
    Copy-Item -LiteralPath (Join-Path $Backup 'app.py') -Destination $TargetApp -Force
    Copy-Item -LiteralPath (Join-Path $Backup 'FAM.html') -Destination $TargetHtml -Force
    Copy-Item -LiteralPath (Join-Path $Backup 'web.config') -Destination $TargetWebConfig -Force
    if ($script:HadNetworkOps) { Copy-Item -LiteralPath (Join-Path $Backup 'network_ops.py') -Destination $TargetNetworkOps -Force }
    else { Remove-Item -LiteralPath $TargetNetworkOps -Force -ErrorAction SilentlyContinue }
    if ($script:HadNetworkPage) { Copy-Item -LiteralPath (Join-Path $Backup 'network_operations.html') -Destination $TargetNetworkPage -Force }
    else { Remove-Item -LiteralPath $TargetNetworkPage -Force -ErrorAction SilentlyContinue }
}

try {
    $Manifest=@()
    Get-Content -LiteralPath (Join-Path $Payload 'SHA256SUMS.txt') | Where-Object { $_.Trim() } | ForEach-Object {
        if ($_ -notmatch '^([a-fA-F0-9]{64})  (app\.py|network_ops\.py|network_operations\.html|FAM\.html|web\.config)$') { throw 'SHA256SUMS.txt is malformed.' }
        $Manifest+=@{Sha256=$matches[1];Name=$matches[2]}
    }
    if ($Manifest.Count -ne 5 -or @($Manifest.Name | Select-Object -Unique).Count -ne 5) { throw 'SHA256SUMS.txt must contain exactly the five expected payload files.' }
    foreach ($Entry in @(
        @($SourceApp,'Patch payload app.py is missing.'),@($SourceNetworkOps,'Patch payload network_ops.py is missing.'),@($SourceNetworkPage,'Patch payload network_operations.html is missing.'),
        @($SourceHtml,'Patch payload FAM.html is missing.'),@($SourceWebConfig,'Patch payload web.config is missing.'),
        @($TargetApp,'Installed FAM app.py is missing.'),@($TargetHtml,'Installed FAM.html is missing.'),@($TargetWebConfig,'Installed FAM web.config is missing.'),
        @($StartPath,'Installed FAM start.ps1 is missing.')
    )) { Assert-File $Entry[0] $Entry[1] }
    foreach ($Name in @('app.py','network_ops.py','network_operations.html','FAM.html','web.config')) {
        Assert-PayloadHash (Join-Path $Payload $Name) $Name
    }
    if (!(Test-Path -LiteralPath $DataDir -PathType Container)) { throw 'C:\FAMData is missing. No file was changed.' }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $Backup=Join-Path $BackupDir ('custom-access-'+$Stamp)
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Copy-Item -LiteralPath $TargetApp -Destination (Join-Path $Backup 'app.py') -Force
    Copy-Item -LiteralPath $TargetHtml -Destination (Join-Path $Backup 'FAM.html') -Force
    Copy-Item -LiteralPath $TargetWebConfig -Destination (Join-Path $Backup 'web.config') -Force
    $HadNetworkOps=Test-Path -LiteralPath $TargetNetworkOps -PathType Leaf
    $HadNetworkPage=Test-Path -LiteralPath $TargetNetworkPage -PathType Leaf
    if ($HadNetworkOps) { Copy-Item -LiteralPath $TargetNetworkOps -Destination (Join-Path $Backup 'network_ops.py') -Force }
    if ($HadNetworkPage) { Copy-Item -LiteralPath $TargetNetworkPage -Destination (Join-Path $Backup 'network_operations.html') -Force }

    Stop-FamTask
    # Mark the transaction as copied before the first write, so any partial
    # replacement is rolled back along with newly created Network Operations files.
    $Copied=$true
    Copy-Item -LiteralPath $SourceApp -Destination $TargetApp -Force
    Copy-Item -LiteralPath $SourceNetworkOps -Destination $TargetNetworkOps -Force
    Copy-Item -LiteralPath $SourceNetworkPage -Destination $TargetNetworkPage -Force
    Copy-Item -LiteralPath $SourceHtml -Destination $TargetHtml -Force
    Copy-Item -LiteralPath $SourceWebConfig -Destination $TargetWebConfig -Force
    Start-FamTask
    Write-Host ''
    Write-Host 'CUSTOM ACCESS + NETWORK OPERATIONS UPDATE APPLIED.' -ForegroundColor Green
    Write-Host ('Backup: '+$Backup)
    Write-Host 'Network Operations stays disabled until FAM_NETWORK_OPS_ENABLED=1 is set and a separate Worker is paired.'
    Write-Host 'Open FAM again. The server response is no-cache, so no browser cache cleanup is required.'
    exit 0
} catch {
    $Message=$_.Exception.Message
    if ($Copied -and $Backup) {
        try { Restore-Backup;Start-FamTask;Write-Warning 'The prior FAM application files were restored from the patch backup.' }
        catch { Write-Warning 'Automatic rollback failed; restore the files from the backup path shown above.' }
    } elseif ($TaskWasRunning) {
        try { Start-FamTask } catch { Write-Warning 'FAM-Central needs administrator review in Task Scheduler.' }
    }
    Write-Host ('PATCH NOT COMPLETE: '+$Message) -ForegroundColor Red
    exit 1
}
