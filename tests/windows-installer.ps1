# CI ONLY: disposable Windows runner, never a production server.
#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference='Stop'
foreach ($File in @(Get-ChildItem server\windows -File | Where-Object Extension -in @('.ps1','.psm1'))) {
    $Tokens=$null;$Errors=$null
    [Management.Automation.Language.Parser]::ParseFile($File.FullName,[ref]$Tokens,[ref]$Errors) | Out-Null
    if ($Errors.Count) { throw ($Errors | Out-String) }
}
Import-Module .\server\windows\setup-common.psm1 -Force
$Fake=[pscustomobject]@{Extensions=@([pscustomobject]@{Oid=[pscustomobject]@{Value='2.5.29.17'}});HasPrivateKey=$true;NotAfter=(Get-Date).AddDays(2);NotBefore=(Get-Date).AddDays(-1);DnsNameList=@([pscustomobject]@{Unicode='ertebatat-fam'})}
if (!(Test-FamCertificate $Fake 'ertebatat-fam') -or (Test-FamCertificate $Fake 'wrong-name')) { throw 'Certificate name policy failed' }
$Fake.HasPrivateKey=$false
if (Test-FamCertificate $Fake 'ertebatat-fam') { throw 'Certificate without a private key accepted' }
if (Read-FamYes 'Never prompt in unattended mode' -Unattended) { throw 'Unattended consent must fail closed' }

# Enable IIS solely inside this disposable runner, then add an unrelated site.
$Needed=@(Get-WindowsFeature -Name @('Web-Server','Web-Static-Content','Web-Default-Doc','Web-Http-Errors','Web-Mgmt-Console','Web-Scripting-Tools') | Where-Object { !$_.Installed } | Select-Object -ExpandProperty Name)
if ($Needed.Count) {
    $R=Install-WindowsFeature -Name $Needed -IncludeManagementTools
    if (!$R.Success -or [string]$R.RestartNeeded -eq 'Yes') { throw 'Runner cannot install IIS without a reboot' }
}
Import-Module WebAdministration
New-Item -ItemType Directory -Force C:\IIS-CI-Other | Out-Null
Set-Content C:\IIS-CI-Other\index.html 'Unrelated site must remain untouched'
New-Website -Name FAM-CI-Unrelated -PhysicalPath C:\IIS-CI-Other -Port 8099 -IPAddress 127.0.0.1 | Out-Null
$UnrelatedBefore=Get-Website -Name FAM-CI-Unrelated | Select-Object -Property @('name','physicalPath','applicationPool',@{n='bindings';e={$_.bindings.Collection.bindingInformation -join '|'}}) | ConvertTo-Json -Compress
# This is TEST-runner hosts setup, not part of the customer installer.
Add-Content "$env:SystemRoot\System32\drivers\etc\hosts" "`n127.0.0.1 ertebatat-fam"
$PSExe="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Setup=(Resolve-Path .\server\windows\setup-ertebatat.ps1).Path
$Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$Setup+'" -ServerAddress 127.0.0.1 -InstallRoot C:\FAM-CI -DataDir C:\FAM-CIData -CreateCertificate -Unattended'
$P=Start-Process $PSExe -ArgumentList $Arguments -Wait -PassThru -NoNewWindow
if ($P.ExitCode -ne 0) { throw "First installation failed: $($P.ExitCode)" }
$First=Get-Content -Raw C:\FAM-CI\deployment.json | ConvertFrom-Json
$Python='C:\FAM-CI\server\.venv\Scripts\python.exe'
$Seed=@'
import sqlite3,json,hashlib
from pathlib import Path
with sqlite3.connect(r'C:\FAM-CIData\fam.sqlite3') as db:
    p=json.loads(db.execute('SELECT payload FROM state WHERE id=1').fetchone()[0])
    p['order']=['InstallCheck'];p['sheets']={'InstallCheck':{'rows':[['ID'],['PRESERVE']],'merges':[]}}
    db.execute('UPDATE state SET payload=? WHERE id=1',(json.dumps(p),))
    users=db.execute('SELECT * FROM users ORDER BY id').fetchall()
Path(r'C:\FAM-CIData\logs\tests-baseline.json').write_text(hashlib.sha256(json.dumps(users).encode()).hexdigest())
'@
& $Python -c $Seed
if ($LASTEXITCODE -ne 0) { throw 'Failed to seed CI preservation fixture' }
$P=Start-Process $PSExe -ArgumentList $Arguments -Wait -PassThru -NoNewWindow
if ($P.ExitCode -ne 0) { throw "Repeat installation failed: $($P.ExitCode)" }
$Verify=@'
import sqlite3,json,hashlib
from pathlib import Path
with sqlite3.connect(r'C:\FAM-CIData\fam.sqlite3') as db:
    p=json.loads(db.execute('SELECT payload FROM state WHERE id=1').fetchone()[0])
    assert p['sheets']['InstallCheck']['rows'][1][0]=='PRESERVE'
    users=db.execute('SELECT * FROM users ORDER BY id').fetchall()
assert hashlib.sha256(json.dumps(users).encode()).hexdigest()==Path(r'C:\FAM-CIData\logs\tests-baseline.json').read_text()
print('Repeat install preserved data and all account/credential fields')
'@
& $Python -c $Verify
if ($LASTEXITCODE -ne 0) { throw 'Preservation test failed' }
$Second=Get-Content -Raw C:\FAM-CI\deployment.json | ConvertFrom-Json
if ($First.certificate -ne $Second.certificate) { throw 'Existing certificate was unexpectedly replaced' }
$UnrelatedAfter=Get-Website -Name FAM-CI-Unrelated | Select-Object -Property @('name','physicalPath','applicationPool',@{n='bindings';e={$_.bindings.Collection.bindingInformation -join '|'}}) | ConvertTo-Json -Compress
if ($UnrelatedBefore -ne $UnrelatedAfter) { throw 'Unrelated website changed' }
# User trust is exercised explicitly in this disposable runner only.
Import-Certificate -FilePath C:\FAM-CIData\client-setup\ertebatat-fam.cer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
& C:\FAM-CIData\client-setup\trust-client.ps1
if ((Get-ScheduledTask -TaskName FAM-Central).State -ne 'Running') { throw 'Backend is not running under Task Scheduler' }
if (!(Get-ScheduledTask -TaskName FAM-Central-Backup)) { throw 'Daily backup was not registered' }
if (@(Get-ChildItem C:\FAM-CIData\backups -Filter 'before-install-*.sqlite3').Count -lt 1) { throw 'Pre-upgrade backup missing' }
Write-Host 'WINDOWS IIS INSTALL / REINSTALL / TLS / API / ACCOUNT PRESERVATION CHECKS PASSED' -ForegroundColor Green
