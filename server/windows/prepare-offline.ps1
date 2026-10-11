#Requires -Version 5.1
# Run on an INTERNET-CONNECTED WINDOWS PC with Python 3 + pip (no admin needed).
# Then transfer the COMPLETE extracted package, including payload, to the server.
param([string]$PythonExecutable='')
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'setup-common.psm1') -Force
$Payload=Join-Path $PSScriptRoot 'payload'
$Wheels=Join-Path $Payload 'wheels'
New-Item -ItemType Directory -Force -Path $Wheels | Out-Null
$Marker=Join-Path $Payload 'OFFLINE-READY.txt'
if (Test-Path $Marker) { Remove-Item -LiteralPath $Marker }
$Manifest=Get-Content -Raw (Join-Path $PSScriptRoot 'dependencies.json') | ConvertFrom-Json
foreach ($Name in @('python','rewrite','arr')) { Get-FamInstaller $Manifest.$Name $Payload $Payload | Out-Null }
if (!$PythonExecutable) {
    $PythonExecutable=& py -3 -c 'import sys;print(sys.executable)'
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3 + pip on this preparation PC or pass -PythonExecutable.' }
}
# Cache all supported x64 CPython ABI wheels, not just the preparing PC's version.
foreach ($Version in @('3.12','3.13','3.14')) {
    $ABI='cp'+$Version.Replace('.','')
    & $PythonExecutable -m pip download --disable-pip-version-check '--only-binary=:all:' --platform win_amd64 --implementation cp --python-version $Version --abi $ABI --dest $Wheels -r (Join-Path (Split-Path -Parent $PSScriptRoot) 'requirements.txt') 'colorama==0.4.6'
    if ($LASTEXITCODE -ne 0) { throw "Wheel download failed for $Version. Use a current pip and rerun." }
}
'Signed prerequisite installers and CPython 3.12/3.13/3.14 x64 wheels prepared. Windows IIS feature payload/trust roots must be available on the server.' | Set-Content -Encoding ASCII $Marker
Write-Host 'Offline payload ready. Transfer the WHOLE package, then run INSTALL-FAM.cmd ON THE SERVER.' -ForegroundColor Green
Write-Host 'Windows feature source files, organizational certificate trust, DNS and firewall/GPO policy are not bundled.'
