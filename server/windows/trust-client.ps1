#Requires -Version 5.1
# Run as the ACTUAL browser user. No Administrator/RDP needed for CurrentUser trust.
$ErrorActionPreference='Stop'
$Config=Get-Content -Raw (Join-Path $PSScriptRoot 'certificate.json') | ConvertFrom-Json
$Path=Join-Path $PSScriptRoot 'ertebatat-fam.cer'
if ((Get-FileHash $Path -Algorithm SHA256).Hash -ine $Config.sha256) { throw 'Certificate file was modified. Obtain this folder again from the server administrator.' }
$Cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($Path)
if ($Cert.Thumbprint -ine $Config.thumbprint -or $Cert.NotAfter -le (Get-Date)) { throw 'Certificate mismatch or expiry.' }
if ($Config.selfSigned -and !(Test-Path ('Cert:\CurrentUser\Root\'+$Cert.Thumbprint))) {
    Write-Host ('Server: https://'+$Config.hostName+' / '+$Config.address)
    Write-Host ('Certificate SHA256: '+$Config.sha256)
    Write-Host 'Only trust a certificate folder received through your administrator. Compare this SHA256 with the SERVER setup output through a trusted channel.'
    if ((Read-Host 'Trust this self-signed certificate for your Windows user? Type YES') -cne 'YES') { throw 'Trust installation cancelled.' }
    Import-Certificate -FilePath $Path -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
}
# A CA-signed leaf is not silently promoted to a root. Its issuing CA must be
# trusted through the organisation's normal certificate/GPO policy.
$Addresses=@([Net.Dns]::GetHostAddresses($Config.hostName) | ForEach-Object { $_.IPAddressToString })
if ($Config.address -notin $Addresses) { throw "DNS/hosts must map $($Config.hostName) to $($Config.address). Ask the network administrator; this script does not modify DNS or hosts." }
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$URL='https://'+$Config.hostName
$Page=Invoke-WebRequest -UseBasicParsing -Uri ($URL+'/FAM.html') -TimeoutSec 20
if ($Page.StatusCode -ne 200 -or $Page.Content -notmatch 'fam-shared-js') { throw 'The central FAM page was not served.' }
try {
    Invoke-WebRequest -UseBasicParsing -Uri ($URL+'/api/session') -TimeoutSec 20 | Out-Null
    throw 'API did not return the expected authentication gate.'
} catch [Net.WebException] {
    if (!$_.Exception.Response) { throw }
    $Response=$_.Exception.Response
    try {
        if ([int]$Response.StatusCode -ne 401 -or $Response.ContentType -notlike 'application/json*') { throw 'API is not reachable through IIS.' }
    } finally { $Response.Close() }
}
Write-Host 'HTTPS trust, name resolution and central API checked for THIS Windows user.' -ForegroundColor Green
Start-Process $URL
