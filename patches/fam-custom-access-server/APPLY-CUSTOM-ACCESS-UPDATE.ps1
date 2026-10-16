#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
  Applies the FAM central custom-access/Equipment Management update.  The update
  also moves the large interactive client out of IIS www: it is served by the
  loopback backend only after a FAM session is verified.  Existing data and the
  previous public FAM.html are preserved for rollback; no worksheet is changed.
#>
[CmdletBinding()]
param([string]$InstallRoot='C:\FAM',[string]$DataDir='C:\FAMData')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath;$Payload=Join-Path $PatchRoot 'payload';$Server=Join-Path $InstallRoot 'server'
$StartPath=Join-Path $Server 'windows\start.ps1';$FAMPython=Join-Path $Server '.venv\Scripts\python.exe';$WheelDir=Join-Path $PatchRoot 'wheels';$WheelManifest=Join-Path $PatchRoot 'WHEELS-SHA256SUMS.txt';$BackupDir=Join-Path $DataDir 'backups'
$Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
$ExpectedNames=@('app.py','equipment_ops.py','equipment_probe.py','start.ps1','FAM.html','login.html','login.css','login.js','web.config')
$Target=@{
  'app.py'=(Join-Path $Server 'app.py');'equipment_ops.py'=(Join-Path $Server 'equipment_ops.py');'equipment_probe.py'=(Join-Path $Server 'equipment_probe.py');'start.ps1'=$StartPath;
  'FAM.html'=(Join-Path $Server 'private_ui\FAM.html');'login.html'=(Join-Path $Server 'www\login.html');'login.css'=(Join-Path $Server 'www\login.css');
  'login.js'=(Join-Path $Server 'www\login.js');'web.config'=(Join-Path $Server 'www\web.config')
}
$LegacyHtml=Join-Path $Server 'www\FAM.html';$Backup=$null;$Copied=$false;$TaskWasRunning=$false;$Presence=@{}
function Assert-File([string]$Path,[string]$Message){if(!(Test-Path -LiteralPath $Path -PathType Leaf)){throw $Message}}
function Wait-Backend([bool]$Listening){$Until=(Get-Date).AddSeconds(30);do{$Open=!!(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue);if($Open -eq $Listening){return};Start-Sleep -Milliseconds 500}while((Get-Date)-lt $Until);if($Listening){throw 'The FAM backend did not listen within 30 seconds.'};throw 'The FAM backend did not stop within 30 seconds.'}
function Stop-FamTask {
  $Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
  if(!$Task){throw 'FAM-Central is missing. This patch only applies to the installed central FAM server.'}
  if($Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)){throw 'FAM-Central is not the expected FAM backend task. No file was changed.'}
  $script:TaskWasRunning=$Task.State -eq 'Running';if($script:TaskWasRunning){Stop-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $false}
}
function Start-FamTask{Start-ScheduledTask -TaskName 'FAM-Central';Wait-Backend $true}
function Copy-Required([string]$From,[string]$To){New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To)|Out-Null;Copy-Item -LiteralPath $From -Destination $To -Force}
function Install-EquipmentRuntime {
  Assert-File $FAMPython 'Installed FAM Python is missing.';Assert-File $WheelManifest 'Equipment runtime wheel manifest is missing.'
  $Wheels=@{};foreach($Line in @(Get-Content -LiteralPath $WheelManifest|Where-Object{$_.Trim()})){
    if($Line -notmatch '^([a-fA-F0-9]{64})  (wheels/[A-Za-z0-9._-]+\.whl)$'){throw 'WHEELS-SHA256SUMS.txt is malformed.'};if($Wheels.ContainsKey($matches[2])){throw 'WHEELS-SHA256SUMS.txt has a duplicate entry.'};$Wheels[$matches[2]]=$matches[1]
  }
  $Actual=@(Get-ChildItem -LiteralPath $WheelDir -File -Filter '*.whl' -ErrorAction SilentlyContinue|ForEach-Object{'wheels/'+$_.Name}|Sort-Object);if((@($Wheels.Keys|Sort-Object)-join '|') -ne ($Actual -join '|')){throw 'Equipment runtime wheels do not match their manifest.'}
  foreach($Relative in $Wheels.Keys){$Path=Join-Path $PatchRoot $Relative;Assert-File $Path ('Equipment runtime wheel '+$Relative+' is missing.');if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Wheels[$Relative]){throw ('Equipment runtime SHA256 mismatch for '+$Relative+'. No application file was changed.')}}
  & $FAMPython -m pip install --disable-pip-version-check --no-index --no-input --find-links $WheelDir 'netmiko==4.8.0';if($LASTEXITCODE -ne 0){throw 'Could not install the verified direct Equipment Management runtime.'}
  & $FAMPython -c 'from netmiko import ConnectHandler';if($LASTEXITCODE -ne 0){throw 'The direct Equipment Management runtime could not be verified.'}
}
function Protect-PrivateUi {
  $Path=Join-Path $Server 'private_ui';$Acl=[Security.AccessControl.DirectorySecurity]::new();$Acl.SetAccessRuleProtection($true,$false)
  foreach($Pair in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-19','ReadAndExecute'))){$Sid=[Security.Principal.SecurityIdentifier]::new($Pair[0]);$Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Sid,$Pair[1],'ContainerInherit,ObjectInherit','None','Allow'))}
  Set-Acl -LiteralPath $Path -AclObject $Acl
}
function Restore-Backup {
  if(!$Backup){return};Stop-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue;try{Wait-Backend $false}catch{}
  foreach($Name in @('app.py','start.ps1','web.config')){Copy-Required (Join-Path $Backup $Name) $Target[$Name]}
  Copy-Required (Join-Path $Backup 'legacy-FAM.html') $LegacyHtml
  foreach($Name in @('equipment_ops.py','equipment_probe.py','start.ps1','FAM.html','login.html','login.css','login.js')){
    if($Presence[$Name]){Copy-Required (Join-Path $Backup $Name) $Target[$Name]}else{Remove-Item -LiteralPath $Target[$Name] -Force -ErrorAction SilentlyContinue}
  }
}
try {
  $Manifest=@{};foreach($Line in @(Get-Content -LiteralPath (Join-Path $Payload 'SHA256SUMS.txt')|Where-Object{$_.Trim()})){
    if($Line -notmatch '^([a-fA-F0-9]{64})  ([A-Za-z0-9._-]+)$'){throw 'SHA256SUMS.txt is malformed.'};if($Manifest.ContainsKey($matches[2])){throw 'SHA256SUMS.txt has a duplicate entry.'};$Manifest[$matches[2]]=$matches[1]
  }
  $ManifestList=(@($Manifest.Keys|Sort-Object)-join '|');$ExpectedList=(@($ExpectedNames|Sort-Object)-join '|');if($ManifestList -ne $ExpectedList){throw 'SHA256SUMS.txt must contain exactly the expected central payload files.'}
  foreach($Name in $ExpectedNames){$Source=Join-Path $Payload $Name;Assert-File $Source ('Patch payload '+$Name+' is missing.');if((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ine $Manifest[$Name]){throw ('Payload SHA256 mismatch for '+$Name+'. No file was changed.')}}
  Assert-File $Target['app.py'] 'Installed FAM app.py is missing.';Assert-File $FAMPython 'Installed FAM Python is missing.';Assert-File $LegacyHtml 'Installed legacy FAM.html is missing.';Assert-File $Target['web.config'] 'Installed FAM web.config is missing.';Assert-File $StartPath 'Installed FAM start.ps1 is missing.'
  if(!(Test-Path -LiteralPath $DataDir -PathType Container)){throw 'C:\FAMData is missing. No file was changed.'};New-Item -ItemType Directory -Force -Path $BackupDir|Out-Null
  $Backup=Join-Path $BackupDir ('custom-access-'+$Stamp);New-Item -ItemType Directory -Force -Path $Backup|Out-Null
  Copy-Required $Target['app.py'] (Join-Path $Backup 'app.py');Copy-Required $Target['start.ps1'] (Join-Path $Backup 'start.ps1');Copy-Required $LegacyHtml (Join-Path $Backup 'legacy-FAM.html');Copy-Required $Target['web.config'] (Join-Path $Backup 'web.config')
  foreach($Name in @('equipment_ops.py','equipment_probe.py','start.ps1','FAM.html','login.html','login.css','login.js')){$Presence[$Name]=Test-Path -LiteralPath $Target[$Name] -PathType Leaf;if($Presence[$Name]){Copy-Required $Target[$Name] (Join-Path $Backup $Name)}}
  Stop-FamTask;Install-EquipmentRuntime;$Copied=$true
  $RetiredWorker=Get-ScheduledTask -TaskName 'FAM-NetworkWorker' -ErrorAction SilentlyContinue
  if($RetiredWorker){
    if($RetiredWorker.State -eq 'Running'){Stop-ScheduledTask -TaskName 'FAM-NetworkWorker' -ErrorAction SilentlyContinue}
    Disable-ScheduledTask -TaskName 'FAM-NetworkWorker' -ErrorAction SilentlyContinue | Out-Null
  }
  foreach($Name in $ExpectedNames){Copy-Required (Join-Path $Payload $Name) $Target[$Name]}
  Protect-PrivateUi;Start-FamTask
  Write-Host '';Write-Host 'CUSTOM ACCESS + PRIVATE FAM UI UPDATE APPLIED.' -ForegroundColor Green
  Write-Host ('Backup: '+$Backup);Write-Host 'Open the FAM root URL. Only login.html is IIS-static; the spreadsheet UI is released by the backend after session verification.';exit 0
}catch{
  $Message=$_.Exception.Message;if($Copied -and $Backup){try{Restore-Backup;Start-FamTask;Write-Warning 'The prior FAM application files were restored from the patch backup.'}catch{Write-Warning 'Automatic rollback failed; restore the files from the backup path shown above.'}}elseif($TaskWasRunning){try{Start-FamTask}catch{Write-Warning 'FAM-Central needs administrator review in Task Scheduler.'}}
  Write-Host ('PATCH NOT COMPLETE: '+$Message) -ForegroundColor Red;exit 1
}
