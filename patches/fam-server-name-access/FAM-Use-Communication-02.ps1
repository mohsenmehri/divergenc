#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
Moves an already-verified central FAM installation from the temporary
single-label deployment name to the server's existing domain DNS name.
It changes no database data or FAM accounts.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$')]
    [string]$HostName='communication-02.toosbank.corp',
    [ValidatePattern('^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$')]
    [string]$ServerAddress='10.16.243.18',
    [string]$SiteName='FAM-Ertebatat',
    [string]$InstallRoot='C:\FAM',
    [string]$DataDir='C:\FAMData',
    [string]$PreviousHostName='ertebatat-fam'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$HostName=$HostName.ToLowerInvariant()
$PreviousHostName=$PreviousHostName.ToLowerInvariant()
$Origin='https://'+$HostName
$TargetServer=Join-Path $InstallRoot 'server'
$WindowsDir=Join-Path $TargetServer 'windows'
$SettingsPath=Join-Path $WindowsDir 'settings.json'
$CommonPath=Join-Path $WindowsDir 'setup-common.psm1'
$StartPath=Join-Path $WindowsDir 'start.ps1'
$VerifyPath=Join-Path $WindowsDir 'verify_deployment.py'
$Python=Join-Path $TargetServer '.venv\Scripts\python.exe'
$ClientDir=Join-Path $DataDir 'client-setup'
$CertificatePath=Join-Path $ClientDir 'ertebatat-fam.cer'
$LogDir=Join-Path $DataDir 'logs'
$BackupDir=Join-Path $DataDir 'backups'
$SettingsRaw=$null
$SettingsChanged=$false
$TaskStopped=$false
$NewBindingCreated=$false
$Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)

function Get-FamBindingParts($Binding) {
    $Parts=([string]$Binding.bindingInformation) -split ':'
    if ($Parts.Count -ne 3) { return $null }
    return [pscustomobject]@{IP=$Parts[0];Port=$Parts[1];HostName=$Parts[2].ToLowerInvariant()}
}
function Get-FamBindingThumbprint($Binding) {
    if ($Binding.certificateHash -is [byte[]]) { return [BitConverter]::ToString($Binding.certificateHash).Replace('-','') }
    return ([string]$Binding.certificateHash).Replace(' ','').ToUpperInvariant()
}
function Stop-FamBackend {
    $Task=Get-ScheduledTask -TaskName 'FAM-Central' -ErrorAction SilentlyContinue
    if (!$Task) { throw 'The FAM-Central scheduled task is missing. This patch only changes an installed central FAM server.' }
    if ($Task.Actions.Execute -notmatch 'powershell\.exe$' -or $Task.Actions.Arguments -notmatch [regex]::Escape($StartPath)) { throw 'FAM-Central is not the expected FAM backend task. No change was made.' }
    if ($Task.State -eq 'Running') { Stop-ScheduledTask -TaskName 'FAM-Central';$script:TaskStopped=$true }
    $Until=(Get-Date).AddSeconds(30)
    while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'The FAM backend did not stop within 30 seconds. No IIS or certificate setting was changed.' }
}
function Start-FamBackend {
    Start-ScheduledTask -TaskName 'FAM-Central'
}

try {
    foreach ($Path in @($SettingsPath,$CommonPath,$StartPath,$VerifyPath,$Python)) {
        if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required installed FAM file is missing: $Path" }
    }
    $InstallRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    $DataDir=[IO.Path]::GetFullPath($DataDir).TrimEnd('\')
    if ($DataDir -eq $InstallRoot -or $DataDir.StartsWith($InstallRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'FAM data directory is unsafe or invalid.' }
    $SettingsRaw=Get-Content -LiteralPath $SettingsPath -Raw
    $Settings=$SettingsRaw | ConvertFrom-Json
    if (!$Settings.DB -or !(Test-Path -LiteralPath $Settings.DB -PathType Leaf)) { throw 'The existing FAM database is missing; this patch will not create a replacement.' }
    if (!(Test-Path -LiteralPath $DataDir -PathType Container)) { throw 'FAMData is missing.' }

    # Confirm that the already-existing server name resolves before changing
    # the FAM origin. No DNS, hosts, firewall, or proxy configuration is edited.
    $Resolved=@([Net.Dns]::GetHostAddresses($HostName) | ForEach-Object { $_.IPAddressToString })
    if ($ServerAddress -notin $Resolved) { throw "$HostName does not resolve to $ServerAddress on this server. This patch will not guess or modify DNS." }
    if (!(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $ServerAddress)) { throw "$ServerAddress is not an address assigned to this server." }

    Import-Module WebAdministration
    Import-Module $CommonPath -Force
    $TargetSite=Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    if (!$TargetSite) { throw "The IIS site '$SiteName' is missing." }
    $WebRoot=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($TargetSite.physicalPath)).TrimEnd('\')
    if ($WebRoot -ine (Join-Path $TargetServer 'www')) { throw "The IIS site '$SiteName' does not use the installed FAM www folder." }
    $ExistingFqdnBindings=@(Get-WebBinding -Name $SiteName -Protocol https | Where-Object { $P=Get-FamBindingParts $_;$P -and $P.IP -eq $ServerAddress -and $P.Port -eq '443' -and $P.HostName -eq $HostName })
    if ($ExistingFqdnBindings.Count -gt 1) { throw "Several FAM bindings already use $HostName. Resolve this in IIS first." }
    $ForeignFqdnBindings=@(foreach ($Site in @(Get-Website)) {
        if ($Site.Name -eq $SiteName) { continue }
        foreach ($Binding in @(Get-WebBinding -Name $Site.Name -Protocol https)) {
            $P=Get-FamBindingParts $Binding
            if ($P -and $P.IP -in @('*','0.0.0.0',$ServerAddress) -and $P.Port -eq '443' -and $P.HostName -eq $HostName) { [pscustomobject]@{Site=$Site.Name;Binding=$Binding} }
        }
    })
    if ($ForeignFqdnBindings.Count) { throw "Another IIS site already owns $HostName on HTTPS. No binding was changed." }

    # Prefer the certificate that IIS already associated with this FQDN; then
    # use a single valid local-machine certificate. If none exists, make a
    # dedicated non-exportable self-signed certificate with a DNS SAN.
    $Candidates=@(foreach ($Store in @('My','WebHosting')) {
        foreach ($Cert in @(Get-ChildItem ('Cert:\LocalMachine\'+$Store) -ErrorAction SilentlyContinue)) {
            if (Test-FamCertificate $Cert $HostName) { [pscustomobject]@{Cert=$Cert;Store=$Store} }
        }
    })
    $Selected=$null
    if ($ExistingFqdnBindings.Count) {
        $BoundThumb=Get-FamBindingThumbprint $ExistingFqdnBindings[0]
        $Selected=@($Candidates | Where-Object { $_.Cert.Thumbprint -eq $BoundThumb } | Select-Object -First 1)
    }
    if (!$Selected -and $Candidates.Count -eq 1) { $Selected=$Candidates[0] }
    if (!$Selected -and $Candidates.Count -gt 1) { $Selected=@($Candidates | Sort-Object { $_.Cert.NotAfter } -Descending | Select-Object -First 1) }
    if (!$Selected) {
        $Certificate=New-SelfSignedCertificate -DnsName $HostName -CertStoreLocation 'Cert:\LocalMachine\My' -Type SSLServerAuthentication -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2) -FriendlyName ('FAM '+$HostName)
        if (!(Test-FamCertificate $Certificate $HostName)) { throw "The new certificate does not contain the required DNS SAN for $HostName." }
        $Selected=[pscustomobject]@{Cert=$Certificate;Store='My'}
    }
    $Certificate=$Selected.Cert
    if (!(Test-FamCertificate $Certificate $HostName)) { throw "The selected certificate does not cover $HostName." }

    New-Item -ItemType Directory -Force -Path $LogDir,$BackupDir,$ClientDir | Out-Null
    Copy-Item -LiteralPath $SettingsPath -Destination (Join-Path $BackupDir ('before-server-name-'+$Stamp+'-settings.json')) -Force
    Backup-WebConfiguration -Name ('FAM-before-server-name-'+$Stamp)
    Stop-FamBackend

    if (!$ExistingFqdnBindings.Count) {
        New-WebBinding -Name $SiteName -Protocol https -IPAddress $ServerAddress -Port 443 -HostHeader $HostName -SslFlags 1
        $NewBindingCreated=$true
    }
    Set-FamSniCertificate $SiteName $ServerAddress $HostName $Certificate $Selected.Store
    # Re-save the SNI flag once. This clears stale HTTP.SYS state left by an
    # older removed IIS binding without changing another site's binding.
    $FqdnBinding=@(Get-WebBinding -Name $SiteName -Protocol https | Where-Object { $P=Get-FamBindingParts $_;$P -and $P.IP -eq $ServerAddress -and $P.Port -eq '443' -and $P.HostName -eq $HostName } | Select-Object -First 1)
    if (!$FqdnBinding.Count) { throw "The HTTPS binding for $HostName was not created." }
    Set-WebBinding -Name $SiteName -BindingInformation $FqdnBinding[0].bindingInformation -PropertyName sslFlags -Value 0
    Set-WebBinding -Name $SiteName -BindingInformation $FqdnBinding[0].bindingInformation -PropertyName sslFlags -Value 1
    Set-FamSniCertificate $SiteName $ServerAddress $HostName $Certificate $Selected.Store

    $Settings.PUBLIC_ORIGIN=$Origin
    $Settings | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
    $SettingsChanged=$true
    Start-WebAppPool -Name $TargetSite.applicationPool -ErrorAction SilentlyContinue
    Start-Website -Name $SiteName
    Start-FamBackend

    Export-Certificate -Cert $Certificate -FilePath $CertificatePath -Force | Out-Null
    @('[InternetShortcut]',('URL='+$Origin)) | Set-Content -Encoding ASCII (Join-Path $ClientDir 'FAM.url')
    @{hostName=$HostName;address=$ServerAddress;thumbprint=$Certificate.Thumbprint;sha256=(Get-FileHash $CertificatePath -Algorithm SHA256).Hash;selfSigned=($Certificate.Subject -eq $Certificate.Issuer)} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $ClientDir 'certificate.json')
    $Verification=Join-Path $LogDir ('verification-server-name-'+$Stamp+'.json')
    & $Python $VerifyPath --host $HostName --address $ServerAddress --cert $CertificatePath --output $Verification
    if ($LASTEXITCODE -ne 0) { throw "HTTPS/API verification failed. The previous origin will be restored. See $Verification" }

    # The FQDN is now verified. The former temporary binding is removed only if
    # it belongs to this FAM site and exact address; no other IIS site is touched.
    $Former=@(Get-WebBinding -Name $SiteName -Protocol https | Where-Object { $P=Get-FamBindingParts $_;$P -and $P.IP -eq $ServerAddress -and $P.Port -eq '443' -and $P.HostName -eq $PreviousHostName })
    foreach ($Binding in $Former) { Remove-WebBinding -Name $SiteName -Protocol https -Port 443 -IPAddress $ServerAddress -HostHeader $PreviousHostName }
    & netsh http delete sslcert ('hostnameport='+$PreviousHostName+':443') | Out-Null

    @{url=$Origin;serverAddress=$ServerAddress;site=$SiteName;db=$Settings.DB;certificate=$Certificate.Thumbprint;dnsOnServer=$true;httpsApiVerified=$true;clientTrust='Run TRUST-FAM.cmd as each browser user when self-signed'} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $InstallRoot 'deployment.json')
    Write-Host ''
    Write-Host ('SERVER HTTPS + API VERIFIED: '+$Origin) -ForegroundColor Green
    Write-Host ('Client certificate folder: '+$ClientDir)
    Write-Host 'No FAM database or account was changed. Use FAM.url or the URL above on client PCs.'
    exit 0
} catch {
    $Message=$_.Exception.Message
    Write-Host ('SERVER NAME SWITCH NOT COMPLETE: '+$Message) -ForegroundColor Red
    if ($SettingsChanged -and $SettingsRaw) {
        try { Set-Content -LiteralPath $SettingsPath -Value $SettingsRaw -Encoding UTF8 } catch { Write-Warning 'Could not restore the previous FAM settings file.' }
    }
    if ($NewBindingCreated) {
        try { Remove-WebBinding -Name $SiteName -Protocol https -Port 443 -IPAddress $ServerAddress -HostHeader $HostName } catch { Write-Warning 'The new IIS binding needs administrator review.' }
    }
    if ($TaskStopped -or $SettingsChanged) {
        try { Start-FamBackend } catch { Write-Warning 'The FAM backend task needs administrator review.' }
    }
    exit 1
}
