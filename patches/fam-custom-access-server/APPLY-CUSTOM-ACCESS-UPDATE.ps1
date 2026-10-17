#Requires -Version 5.1
#Requires -RunAsAdministrator
<# Offline SERVER repair: verified source allowlist; private SQLite backup;
   rollback restores code only, never overwrites current user data. #>
[CmdletBinding()]
param([string]$InstallRoot='C:\FAM',[string]$DataDir='C:\FAMData',[string]$RollbackBackup='')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath;$Payload=Join-Path $PatchRoot 'payload'
$Server=Join-Path $InstallRoot 'server';$StartPath=Join-Path $Server 'windows\start.ps1'
$FAMPython=Join-Path $Server '.venv\Scripts\python.exe'
$SshClient=Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$EquipmentDir=Join-Path $DataDir 'equipment';$BackupDir=Join-Path $DataDir 'backups'
$ExpectedNames=@('app.py','account_policy.py','equipment_guard.py','equipment_diagnostics.py','manage.py','bootstrap_admin.py','equipment_ops.py','equipment_inventory.py','equipment_probe.py','start.ps1','preflight_backup.py','install.ps1','setup-ertebatat.ps1','setup-common.psm1','backup-daily.ps1','verify_deployment.py','FAM.html','login.html','login.css','login.js','web.config')
$Target=@{}
foreach($Name in @('app.py','account_policy.py','equipment_guard.py','equipment_diagnostics.py','manage.py','bootstrap_admin.py','equipment_ops.py','equipment_inventory.py','equipment_probe.py')){$Target[$Name]=Join-Path $Server $Name}
foreach($Name in @('start.ps1','preflight_backup.py','install.ps1','setup-ertebatat.ps1','setup-common.psm1','backup-daily.ps1','verify_deployment.py')){$Target[$Name]=Join-Path $Server ('windows\'+$Name)}
foreach($Name in @('login.html','login.css','login.js','web.config')){$Target[$Name]=Join-Path $Server ('www\'+$Name)}
$Target['FAM.html']=Join-Path $Server 'private_ui\FAM.html'
$LegacyHtml=Join-Path $Server 'www\FAM.html'
$Backup=$null;$Copied=$false;$Stopped=$false;$DailyEnabled=$false;$DailyExists=$false;$Presence=@{}
function Assert-File([string]$Path,[string]$Message){if(!(Test-Path -LiteralPath $Path -PathType Leaf)){throw $Message}}
function Remove-IfPresent([string]$Path){if(Test-Path -LiteralPath $Path){Remove-Item -LiteralPath $Path -Force -ErrorAction Stop}}
function Copy-Required([string]$From,[string]$To){New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To)|Out-Null;Copy-Item -LiteralPath $From -Destination $To -Force}
function Wait-Backend([bool]$Listening){
  $Until=(Get-Date).AddSeconds(30)
  do{$Open=!!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue);if($Open -eq $Listening){return};Start-Sleep -Milliseconds 500}while((Get-Date)-lt $Until)
  throw 'Backend did not reach the required state within 30 seconds.'
}
function Validate-Task {
  $Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction Stop
  if($Task.State -eq 'Disabled' -and !$RollbackBackup){throw 'FAM-Central is disabled; investigate and enable the installed task before applying.'}
  if(@($Task.Actions).Count -ne 1 -or $Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)){throw 'Unexpected FAM-Central task; no change permitted.'}
}
function Stop-FamTask {
  Validate-Task
  $script:Stopped=$true
  Disable-ScheduledTask -TaskName 'FAM-Central'|Out-Null
  $Daily=Get-ScheduledTask -TaskName 'FAM-Central-Backup' -ErrorAction SilentlyContinue
  if($Daily){
    $script:DailyExists=$true;$script:DailyEnabled=$Daily.State -ne 'Disabled'
    Disable-ScheduledTask -TaskName 'FAM-Central-Backup'|Out-Null
    if($Daily.State -eq 'Running'){Stop-ScheduledTask -TaskName 'FAM-Central-Backup'}
  }
  Stop-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $false
}
function Start-FamTask{Enable-ScheduledTask -TaskName 'FAM-Central'|Out-Null;Start-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $true}
function Resume-BackupTask{if($DailyExists -and $DailyEnabled){Enable-ScheduledTask -TaskName 'FAM-Central-Backup'|Out-Null}}
function Test-OpenSshClient {
  Assert-File $SshClient 'Windows OpenSSH client is missing. No download or change was performed.'
  $Ciphers=@(& $SshClient -Q cipher 2>$null)
  if($LASTEXITCODE -ne 0 -or 'aes128-cbc' -notin $Ciphers){throw 'OpenSSH must support aes128-cbc. No weak fallback is enabled.'}
  $Compilers=@('Framework64','Framework')|ForEach-Object{Join-Path $env:SystemRoot ('Microsoft.NET\'+$_+'\v4.0.30319\csc.exe')}|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}
  if(!@($Compilers).Count){throw '.NET Framework 4.x csc.exe is required for the secret-free ASKPASS helper.'}
}
function Protect-Backup([string]$Path) {
  $Acl=[Security.AccessControl.DirectorySecurity]::new();$Acl.SetAccessRuleProtection($true,$false)
  foreach($SidText in @('S-1-5-18','S-1-5-32-544')){$Sid=[Security.Principal.SecurityIdentifier]::new($SidText);$Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
  Set-Acl -LiteralPath $Path -AclObject $Acl
}
function Protect-PrivateUi {
  $Path=Join-Path $Server 'private_ui';$Acl=[Security.AccessControl.DirectorySecurity]::new();$Acl.SetAccessRuleProtection($true,$false)
  foreach($Pair in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-19','ReadAndExecute'))){$Sid=[Security.Principal.SecurityIdentifier]::new($Pair[0]);$Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Sid,$Pair[1],'ContainerInherit,ObjectInherit','None','Allow'))}
  Set-Acl -LiteralPath $Path -AclObject $Acl
}
function Validate-Backup([string]$Directory){
  $Full=[IO.Path]::GetFullPath($Directory);$Parent=[IO.Path]::GetFullPath($BackupDir).TrimEnd('\')+'\'
  if(!$Full.StartsWith($Parent,[StringComparison]::OrdinalIgnoreCase)){throw 'Rollback must use a private FAM backup directory.'}
  $Saved=Get-Content -LiteralPath (Join-Path $Full 'presence.json') -Raw|ConvertFrom-Json
  $Hashes=Get-Content -LiteralPath (Join-Path $Full 'code-hashes.json') -Raw|ConvertFrom-Json
  $Keys=@($ExpectedNames)+@('legacy-FAM.html')
  if((@($Saved.PSObject.Properties.Name|Sort-Object)-join '|') -ne (@($Keys|Sort-Object)-join '|')){throw 'Backup presence manifest does not match this repair version.'}
  foreach($Name in $Keys){
    if($Saved.$Name -isnot [bool]){throw 'Invalid presence value.'}
    if($Saved.$Name){
      Assert-File (Join-Path $Full $Name) 'Incomplete code backup.'
      if($Hashes.$Name -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath (Join-Path $Full $Name) -Algorithm SHA256).Hash -ine $Hashes.$Name){throw 'Backup code hash mismatch.'}
    }
  }
  return $Saved
}
function Restore-Backup([string]$Directory){
  $Saved=Validate-Backup $Directory
  foreach($Name in $ExpectedNames){if($Saved.$Name){Copy-Required (Join-Path $Directory $Name) $Target[$Name]}else{Remove-IfPresent $Target[$Name]}}
  if($Saved.'legacy-FAM.html'){Copy-Required (Join-Path $Directory 'legacy-FAM.html') $LegacyHtml}else{Remove-IfPresent $LegacyHtml}
}
try{
  Assert-File $FAMPython 'Installed FAM virtual environment is missing. This is an update, not a fresh installer.'
  Assert-File $Target['app.py'] 'Installed FAM app.py is missing.'
  Assert-File (Join-Path $Server 'windows\settings.json') 'Installed settings.json is missing.'
  $Config=Get-Content -LiteralPath (Join-Path $Server 'windows\settings.json') -Raw|ConvertFrom-Json
  $DB=[IO.Path]::GetFullPath($Config.DB)
  if(![IO.Path]::GetDirectoryName($DB).Equals([IO.Path]::GetFullPath($DataDir).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)){throw 'DataDir differs from installed settings. Supply the correct private DataDir.'}
  Assert-File $DB 'Existing FAM database is missing. No bootstrap/reset is allowed by this patch.'
  Validate-Task
  if($RollbackBackup){
    $null=Validate-Backup $RollbackBackup
    Stop-FamTask;Restore-Backup $RollbackBackup;Start-FamTask;Resume-BackupTask
    Write-Host 'CODE ROLLBACK COMPLETE. Current database and user data were NOT restored or overwritten.';exit 0
  }
  $Manifest=@{}
  foreach($Line in @(Get-Content -LiteralPath (Join-Path $Payload 'SHA256SUMS.txt')|Where-Object{$_.Trim()})){
    if($Line -notmatch '^([a-fA-F0-9]{64})  ([A-Za-z0-9._-]+)$' -or $Manifest.ContainsKey($matches[2])){throw 'Invalid or duplicate payload manifest entry.'}
    $Manifest[$matches[2]]=$matches[1]
  }
  if((@($Manifest.Keys|Sort-Object)-join '|') -ne (@($ExpectedNames|Sort-Object)-join '|')){throw 'Unexpected payload allowlist.'}
  foreach($Name in $ExpectedNames){Assert-File (Join-Path $Payload $Name) 'Missing payload file.';if((Get-FileHash -LiteralPath (Join-Path $Payload $Name) -Algorithm SHA256).Hash -ine $Manifest[$Name]){throw 'Payload hash mismatch. No installed file was changed.'}}
  Test-OpenSshClient
  New-Item -ItemType Directory -Force -Path $BackupDir|Out-Null
  $Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
  $Backup=Join-Path $BackupDir ('custom-access-'+$Stamp)
  New-Item -ItemType Directory -Force -Path $Backup|Out-Null
  Protect-Backup $Backup
  Stop-FamTask
  # Use the FIXED, dependency-free backup validator before replacing old code.
  & $FAMPython (Join-Path $Payload 'preflight_backup.py') $DB (Join-Path $Backup 'database.sqlite3')
  if($LASTEXITCODE -ne 0){throw 'Verified database backup failed. Installed code was not changed.'}
  $Hashes=@{}
  foreach($Name in $ExpectedNames){$Presence[$Name]=Test-Path -LiteralPath $Target[$Name] -PathType Leaf;if($Presence[$Name]){Copy-Required $Target[$Name] (Join-Path $Backup $Name);$Hashes[$Name]=(Get-FileHash -LiteralPath (Join-Path $Backup $Name) -Algorithm SHA256).Hash}}
  $Presence['legacy-FAM.html']=Test-Path -LiteralPath $LegacyHtml -PathType Leaf
  if($Presence['legacy-FAM.html']){Copy-Required $LegacyHtml (Join-Path $Backup 'legacy-FAM.html');$Hashes['legacy-FAM.html']=(Get-FileHash -LiteralPath (Join-Path $Backup 'legacy-FAM.html') -Algorithm SHA256).Hash}
  $Presence|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Backup 'presence.json') -Encoding UTF8
  $Hashes|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Backup 'code-hashes.json') -Encoding UTF8
  $Copied=$true
  foreach($Name in $ExpectedNames){Copy-Required (Join-Path $Payload $Name) $Target[$Name];if((Get-FileHash -LiteralPath $Target[$Name] -Algorithm SHA256).Hash -ine $Manifest[$Name]){throw 'Installed file hash mismatch.'}}
  # Idempotent: a second apply does not require a retired public FAM.html.
  Remove-IfPresent $LegacyHtml
  Protect-PrivateUi;Start-FamTask;Resume-BackupTask
  Write-Host 'SERVER SECURITY + RECOVERY FIX APPLIED.' -ForegroundColor Green
  Write-Host ('Private backup: '+$Backup)
  Write-Host ('Host keys: '+(Join-Path $EquipmentDir 'known_hosts')+'; strict by default. Provision verified keys before device checks.')
}catch{
  $Reason=$_.Exception.Message
  if($RollbackBackup){try{Resume-BackupTask}catch{};Write-Error 'Rollback failed; backend may be stopped. Inspect the private backup and service status.' -ErrorAction Continue;exit 1}
  if($Copied){
    try{Stop-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue;Wait-Backend $false;Restore-Backup $Backup;Start-FamTask;Resume-BackupTask;Write-Warning 'Previous code restored; database was not overwritten.'}catch{Write-Error 'Automatic code rollback failed; backend may be stopped. Use the private backup and guide.' -ErrorAction Continue}
  }elseif($Stopped){try{Start-FamTask;Resume-BackupTask}catch{Write-Error 'Could not restart the unchanged backend.' -ErrorAction Continue}}
  Write-Error $Reason -ErrorAction Continue;exit 1
}
