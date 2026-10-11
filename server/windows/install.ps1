#Requires -Version 5.1
#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory=$true)][string]$PublicOrigin,
  [string]$DataDir='C:\FAMData'
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Uri=[Uri]$PublicOrigin
if (!$Uri.IsAbsoluteUri -or $Uri.Scheme -ne 'https' -or $Uri.AbsolutePath -ne '/' -or $Uri.Query -or $Uri.Fragment -or $Uri.UserInfo) { throw 'PublicOrigin must be the HTTPS origin only, e.g. https://fam.example.internal' }
$Origin=$Uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/').ToLowerInvariant()
$DataDir=[IO.Path]::GetFullPath($DataDir)
if ($DataDir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($DataDir).TrimEnd('\') -or $DataDir.StartsWith((Join-Path $Root 'www'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Use a dedicated private directory, not a drive root or www.' }
$Drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($DataDir))
if ($Drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'The database must be on a local fixed disk, not SMB/mapped network storage.' }
$Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
if ($Task) { Stop-ScheduledTask -TaskName 'FAM-Central' }
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8765 is still in use. Stop the previous FAM backend and rerun.' }
$BasePython=& py -3.12 -c "import sys;print(sys.base_prefix)"
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 x64 with the py launcher first.' }
if ($BasePython -match '\\Users\\') { throw 'Install Python for ALL users in a protected system-wide directory, not a private user profile, then rerun.' }
$Python=Join-Path $Root '.venv\Scripts\python.exe'
if (!(Test-Path $Python)) {
  & py -3.12 -m venv (Join-Path $Root '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 x64 with the py launcher first.' }
}
& $Python -m pip install -r (Join-Path $Root 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
# This must be a directory dedicated to FAM. No database is deleted or reseeded.
$Acl=New-Object System.Security.AccessControl.DirectorySecurity
$Acl.SetAccessRuleProtection($true,$false)
foreach ($Rule in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-19','Modify'))) {
  $Sid=[System.Security.Principal.SecurityIdentifier]::new($Rule[0])
  $Acl.AddAccessRule(([System.Security.AccessControl.FileSystemAccessRule]::new($Sid,$Rule[1],'ContainerInherit,ObjectInherit','None','Allow')))
}
Set-Acl -Path $DataDir -AclObject $Acl
& icacls $Root /grant '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to grant LOCAL SERVICE read access to application files.' }
@{PUBLIC_ORIGIN=$Origin;DB=(Join-Path $DataDir 'fam.sqlite3');LOG_DIR=(Join-Path $DataDir 'logs')} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'settings.json')
$Action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSScriptRoot\start.ps1`"" -WorkingDirectory $Root
$Principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$Settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'FAM-Central' -Action $Action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName 'FAM-Central'
Write-Host 'Backend task installed. Check task status and the private service log.'
Write-Host "Next: configure IIS HTTPS + ARR proxy. Physical path: $Root\www"
Write-Host 'Never give the IIS application pool write access to FAMData.'
