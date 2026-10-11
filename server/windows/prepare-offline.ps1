#Requires -Version 5.1
# INTERNET WINDOWS PC ONLY. Downloads files; installs NOTHING on this PC.
# Python and Administrator are NOT required for preparation.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'setup-common.psm1') -Force
$Payload=Join-Path $PSScriptRoot 'payload'
$Wheels=Join-Path $Payload 'wheels'
New-Item -ItemType Directory -Force -Path $Wheels | Out-Null
$Marker=Join-Path $Payload 'OFFLINE-READY.txt'
if (Test-Path $Marker) { Remove-Item -LiteralPath $Marker }
$Manifest=Get-Content -Raw (Join-Path $PSScriptRoot 'dependencies.json') | ConvertFrom-Json
foreach ($Name in @('python','rewrite','arr')) { Get-FamInstaller $Manifest.$Name $Payload $Payload | Out-Null }
$WheelManifest=Get-Content -Raw (Join-Path $PSScriptRoot 'offline-wheels.json') | ConvertFrom-Json
foreach ($Spec in $WheelManifest.files) {
    if ([IO.Path]::GetFileName($Spec.file) -cne $Spec.file) { throw 'Invalid wheel filename.' }
    $File=Join-Path $Wheels $Spec.file
    if (!(Test-Path -LiteralPath $File)) {
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $Spec.url -OutFile ($File+'.partial') -TimeoutSec 600
        if ((Get-FileHash -LiteralPath ($File+'.partial') -Algorithm SHA256).Hash -ine $Spec.sha256) { throw "Wheel SHA256 mismatch: $($Spec.file)" }
        Move-Item -LiteralPath ($File+'.partial') -Destination $File
    }
}
Assert-FamOfflinePayload $PSScriptRoot
'All three signed installers and pinned CPython 3.12/3.13/3.14 x64 wheels verified. Carry the COMPLETE folder to the server.' | Set-Content -Encoding ASCII $Marker
Write-Host 'OFFLINE KIT READY. Copy this COMPLETE extracted package to 10.16.243.18, then run INSTALL-FAM.cmd there as Administrator.' -ForegroundColor Green
Write-Host 'Also have matching Windows Server 2019 media available if IIS feature files were removed. Organisational trust/DNS policies are not changed.'
