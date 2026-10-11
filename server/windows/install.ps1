#Requires -Version 5.1
#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory=$true)][string]$PublicOrigin,
  [string]$DataDir='C:\FAMData',
  [string]$PythonExecutable='',
  [string]$Wheelhouse=''
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
Import-Module (Join-Path $PSScriptRoot 'setup-common.psm1') -Force
Assert-FamTask 'FAM-Central' (Join-Path $PSScriptRoot 'start.ps1')
$Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
if ($Task) { Stop-ScheduledTask -TaskName 'FAM-Central' }
$Until=(Get-Date).AddSeconds(30)
while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8765 is still in use. Stop the previous FAM backend and rerun.' }
if (!$PythonExecutable) {
  $PythonExecutable=& py -3.12 -c "import sys;print(sys.executable)"
  if ($LASTEXITCODE -ne 0) { throw 'Install machine-wide Python or supply -PythonExecutable.' }
}
$BasePython=& $PythonExecutable -c "import sys;print(sys.base_prefix)"
if ($LASTEXITCODE -ne 0 -or $BasePython -match '\\Users\\') { throw 'Use machine-wide Python accessible by LOCAL SERVICE, not a private user installation.' }
$Python=Join-Path $Root '.venv\Scripts\python.exe'
if (!(Test-Path $Python)) {
  & $PythonExecutable -m venv (Join-Path $Root '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
}
$VenvBase=& $Python -c "import sys;print(sys.base_prefix)"
if ($LASTEXITCODE -ne 0 -or $VenvBase -match '\\Users\\') { throw 'Existing virtual environment is broken or uses a private Python. Preserve the DB/settings and repair only .venv before retrying.' }
$PipArgs=@('-I','-m','pip','install','--disable-pip-version-check','--no-input','-r',(Join-Path $Root 'requirements.txt'))
if ($Wheelhouse) {
  if (!(Test-Path -LiteralPath $Wheelhouse -PathType Container)) { throw 'Offline wheelhouse directory is missing.' }
  Assert-FamWheels (Join-Path $PSScriptRoot 'offline-wheels.json') $Wheelhouse
  $PipArgs+=@('--no-index','--only-binary=:all:','--find-links',$Wheelhouse)
}
$SavedPip=@{}
try {
  if ($Wheelhouse) {
    # A machine/user pip config or PIP_FIND_LINKS must not add an Internet URL.
    foreach ($Entry in @(Get-ChildItem Env: | Where-Object Name -like 'PIP_*')) {
      $SavedPip[$Entry.Name]=$Entry.Value;Remove-Item ('Env:'+ $Entry.Name)
    }
    $env:PIP_CONFIG_FILE='NUL'
    $PipArgs+=@('--no-cache-dir')
  }
  & $Python @PipArgs
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed; inspect the verified offline wheelhouse or explicit online configuration.' }
} finally {
  if ($Wheelhouse) {
    foreach ($Entry in @(Get-ChildItem Env: | Where-Object Name -like 'PIP_*')) { Remove-Item ('Env:'+ $Entry.Name) }
    foreach ($Name in $SavedPip.Keys) { Set-Item ('Env:'+ $Name) $SavedPip[$Name] }
  }
}
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
