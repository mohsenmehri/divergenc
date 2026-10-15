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
function Invoke-FamDirect([string]$Uri) {
    # A corporate proxy may return its own 502 page for an internal single-label
    # hostname. The health check must test the actual intranet server instead.
    $Request=[Net.HttpWebRequest]::Create($Uri)
    $Request.Proxy=$null
    $Request.Timeout=20000
    return $Request.GetResponse()
}
$Page=Invoke-FamDirect ($URL+'/FAM.html')
try {
    $Reader=[IO.StreamReader]::new($Page.GetResponseStream())
    try { $Content=$Reader.ReadToEnd() } finally { $Reader.Dispose() }
    if ([int]$Page.StatusCode -ne 200 -or $Content -notmatch 'fam-shared-js') { throw 'The central FAM page was not served.' }
} finally { $Page.Close() }
try {
    $Response=Invoke-FamDirect ($URL+'/api/session')
    try { throw 'API did not return the expected authentication gate.' } finally { $Response.Close() }
} catch [Net.WebException] {
    if (!$_.Exception.Response) { throw }
    $Response=$_.Exception.Response
    try {
        if ([int]$Response.StatusCode -ne 401 -or $Response.ContentType -notlike 'application/json*') { throw 'API is not reachable through IIS.' }
    } finally { $Response.Close() }
}
Write-Host 'HTTPS trust, name resolution and central API checked directly for THIS Windows user.' -ForegroundColor Green
Write-Host ('For normal browser use, the organisation proxy/PAC must bypass this internal hostname: '+$Config.hostName)
Start-Process $URL
