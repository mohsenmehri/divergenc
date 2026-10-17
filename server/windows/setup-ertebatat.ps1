#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidatePattern('^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$')][string]$HostName='communication-02.toosbank.corp',
    [string]$ServerAddress='10.16.243.18',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$')][string]$SiteName='FAM-Communication-02',
    [string]$InstallRoot='C:\FAM',
    [string]$DataDir='C:\FAMData',
    [string]$CertificateThumbprint='',
    [switch]$CreateCertificate,
    [switch]$UseExistingSite,
    [switch]$UseFamAuthentication,
    [switch]$AddFirewallRule,
    [switch]$Offline=$true,
    [switch]$Online,
    [string]$WindowsFeatureSource='',
    [switch]$Unattended,
    [switch]$PauseAtEnd
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'setup-common.psm1') -Force
$SourceServer=Split-Path -Parent $PSScriptRoot
$PackageRoot=Split-Path -Parent $SourceServer
$ExitCode=1
$Transcript=$false
$NewSite=$false
$OldSitePath=$null
$OldPool=$null
$Mutex=[Threading.Mutex]::new($false,'Global\FAM-Central-Installer')
$Locked=$Mutex.WaitOne(0)
try {
    if (!$Locked) { throw 'Another FAM installer is already running.' }
    if ($Online) {
        if ($PSBoundParameters.ContainsKey('Offline')) { throw 'Choose only one of Offline or Online.' }
        $Offline=$false
    }
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or ![Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Use 64-bit Windows PowerShell 5.1 on x64 Windows (INSTALL-FAM.cmd).' }
    if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'This automatic installer targets the Windows Server 2016 generation or later.' }
    $ParsedIP=[Net.IPAddress]::Parse($ServerAddress)
    if ($ParsedIP.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 is required.' }
    if (!(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $ServerAddress)) { throw "Run this ON the server $ServerAddress, not on a user workstation." }
    foreach ($Key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')) {
        if (Test-Path $Key) { throw 'Windows has a pending reboot. Restart in a maintenance window, then rerun setup.' }
    }
    # Fail BEFORE any ACL, feature, IIS, certificate or backend changes if the
    # carried kit is incomplete. No Python is needed to check its contents.
    if ($Offline) {
        Write-Host 'Checking the offline kit before changing this server...'
        Assert-FamOfflinePayload $PSScriptRoot
    }
    if (!$WindowsFeatureSource -and (Test-Path (Join-Path $PackageRoot 'WINDOWS-FEATURE-SOURCE.txt'))) {
        $WindowsFeatureSource=(Get-Content -Raw (Join-Path $PackageRoot 'WINDOWS-FEATURE-SOURCE.txt')).Trim()
    }
    $HostName=$HostName.ToLowerInvariant()
    $Origin='https://'+$HostName
    $InstallRoot=Assert-FamDirectory $InstallRoot
    $DataDir=Assert-FamDirectory $DataDir
    $TargetServer=Join-Path $InstallRoot 'server'
    $WebRoot=Join-Path $TargetServer 'www'
    Assert-FamTask 'FAM-Central' (Join-Path $TargetServer 'windows\start.ps1')
    Assert-FamTask 'FAM-Central-Backup' (Join-Path $TargetServer 'windows\backup-daily.ps1')
    $SettingsPath=Join-Path $TargetServer 'windows\settings.json'
    if (Test-Path -LiteralPath $SettingsPath) {
        $Existing=Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
        $ExistingDB=[IO.Path]::GetFullPath($Existing.DB)
        if ([IO.Path]::GetFileName($ExistingDB) -ine 'fam.sqlite3') { throw 'Existing database has a custom filename. Do not create a second database; use the manual upgrade instructions.' }
        if ($PSBoundParameters.ContainsKey('DataDir') -and $ExistingDB -ine (Join-Path $DataDir 'fam.sqlite3')) { throw 'DataDir disagrees with the existing database. Refusing to start an empty replacement.' }
        $DataDir=Assert-FamDirectory (Split-Path -Parent $ExistingDB)
        if (!(Test-Path -LiteralPath $ExistingDB -PathType Leaf)) { throw 'Existing settings refer to a missing database. Restore/locate it first; setup will not silently initialize an empty replacement.' }
    }
    if ($DataDir -ieq $InstallRoot -or $DataDir.StartsWith($InstallRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or $InstallRoot.StartsWith($DataDir+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Application and data must be separate dedicated directories.' }
    $Drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($DataDir))
    $CodeDrive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($InstallRoot))
    if ($CodeDrive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Application files must be on a local fixed disk.' }
    if ($Drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'SQLite requires a local fixed disk, not a mapped network drive.' }
    if (Test-Path -LiteralPath $InstallRoot) {
        $Contents=@(Get-ChildItem -LiteralPath $InstallRoot -Force)
        if ($Contents.Count -and !(Test-Path (Join-Path $InstallRoot 'server\app.py'))) { throw "Nonempty unrelated installation directory: $InstallRoot" }
    }
    # Dedicated data folder only. Preserve existing DB, backups, and settings.
    if (Test-Path -LiteralPath $DataDir) {
        $Unexpected=@(Get-ChildItem -LiteralPath $DataDir -Force | Where-Object { $_.Name -notin @('fam.sqlite3','fam.sqlite3-wal','fam.sqlite3-shm','logs','backups','setup-cache','client-setup') -and $_.Name -notlike 'fam.before-restore.*.sqlite3' })
        if ($Unexpected.Count) { throw "Unrecognised data directory: $DataDir. Choose a dedicated FAM directory." }
    }
    Assert-FamNoLinks $DataDir
    Assert-FamNoLinks $InstallRoot
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    Set-FamPrivateAcl $DataDir 'Modify'
    # Normalize existing descendants too: protected/explicit old file ACLs must
    # not leave private data readable by ordinary workstation/RDP users.
    foreach ($Child in @(Get-ChildItem -LiteralPath $DataDir -Force)) {
        & icacls $Child.FullName /reset /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot secure an existing FAM data file. Review its ACL before retrying.' }
    }
    $LogDir=Join-Path $DataDir 'logs';$BackupDir=Join-Path $DataDir 'backups';$Cache=Join-Path $DataDir 'setup-cache'
    New-Item -ItemType Directory -Force -Path $LogDir,$BackupDir,$Cache | Out-Null
    $Stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
    $Log=Join-Path $LogDir ('setup-'+$Stamp+'.log')
    Start-Transcript -Path $Log | Out-Null;$Transcript=$true
    Write-Host "FAM automatic installation: $Origin -> $ServerAddress"
    Write-Host 'No database, existing account, or other website is deleted. Shared IIS prerequisites may require a maintenance window.'

    if ($Offline) {
        # DISM /LimitAccess prohibits Windows Update fallback. 'Online' means
        # the running OS, NOT the Internet. Local WinSxS is tried first.
        $Names=@('IIS-WebServerRole','IIS-WebServer','IIS-CommonHttpFeatures','IIS-StaticContent','IIS-DefaultDocument','IIS-HttpErrors','IIS-ManagementConsole','IIS-ManagementScriptingTools')
        $Needed=@($Names | Where-Object { (Get-WindowsOptionalFeature -Online -FeatureName $_).State -ne 'Enabled' })
        if ($Needed.Count) {
            $FeatureArgs=@{Online=$true;FeatureName=$Needed;All=$true;NoRestart=$true;LimitAccess=$true;ErrorAction='Stop'}
            if ($WindowsFeatureSource) { $FeatureArgs.Source=@($WindowsFeatureSource) }
            try { $Result=Enable-WindowsOptionalFeature @FeatureArgs }
            catch { throw ('Offline IIS features need a matching Windows Server 2019 component source. Mount the matching ISO and set WINDOWS-FEATURE-SOURCE.txt; see OFFLINE_SERVER_2019_FA.md. Windows Update was not used. Details: '+$_.Exception.Message) }
            if (@($Result | Where-Object { $_.RestartNeeded -eq $true }).Count) { throw 'IIS requires a reboot. Restart in your maintenance window, then rerun.' }
        }
    } elseif (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue) {
        $Needed=@(Get-WindowsFeature -Name @('Web-Server','Web-Static-Content','Web-Default-Doc','Web-Http-Errors','Web-Mgmt-Console','Web-Scripting-Tools') | Where-Object { !$_.Installed } | Select-Object -ExpandProperty Name)
        if ($Needed.Count) {
            $Result=Install-WindowsFeature -Name $Needed -IncludeManagementTools
            if (!$Result.Success) { throw 'IIS Windows feature installation failed.' }
            if ([string]$Result.RestartNeeded -eq 'Yes') { throw 'IIS requires a reboot. Restart and rerun; no automatic reboot is performed.' }
        }
    } else {
        $Names=@('IIS-WebServerRole','IIS-WebServer','IIS-CommonHttpFeatures','IIS-StaticContent','IIS-DefaultDocument','IIS-HttpErrors','IIS-ManagementConsole','IIS-ManagementScriptingTools')
        $Needed=@($Names | Where-Object { (Get-WindowsOptionalFeature -Online -FeatureName $_).State -ne 'Enabled' })
        if ($Needed.Count) {
            $Result=Enable-WindowsOptionalFeature -Online -FeatureName $Needed -All -NoRestart
            if (@($Result | Where-Object { $_.RestartNeeded -eq $true }).Count) { throw 'IIS requires a reboot. Restart and rerun.' }
        }
    }
    Import-Module WebAdministration
    $IISBackup='FAM-before-'+$Stamp
    Backup-WebConfiguration -Name $IISBackup
    Write-Host "IIS configuration backup: $IISBackup"
    $Sites=@(Get-Website)
    $MatchingSites=@(foreach ($Site in $Sites) {
        foreach ($Binding in @(Get-WebBinding -Name $Site.Name -Protocol https)) {
            $Parts=Convert-FamBinding $Binding
            if ($Parts -and $Parts.Port -eq '443' -and $Parts.HostName -eq $HostName) { $Site }
        }
    })
    $MatchingSites=@($MatchingSites | Sort-Object Name -Unique)
    if ($MatchingSites.Count -gt 1) { throw "Several websites already own $HostName. Resolve the conflict before installation." }
    if ($MatchingSites.Count -eq 1) {
        $SiteName=$MatchingSites[0].Name
        foreach ($B in @(Get-WebBinding -Name $SiteName -Protocol https)) {
            $P=Convert-FamBinding $B
            if ($P -and $P.HostName -eq $HostName -and $P.IP -notin @('*','0.0.0.0',$ServerAddress)) { throw 'The existing hostname binding belongs to a different IP address.' }
        }
    }
    $TargetSite=Get-Website | Where-Object Name -eq $SiteName
    if ($TargetSite -and @(Get-WebApplication -Site $SiteName).Count) { throw 'The target site contains child applications; automatic replacement is not permitted.' }
    if ($TargetSite) {
        $AlreadyOurs=([IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($TargetSite.physicalPath)).TrimEnd('\') -ieq $WebRoot)
        if (!$AlreadyOurs) {
            $Bindings=@(Get-WebBinding -Name $SiteName)
            $Applications=@(Get-WebApplication -Site $SiteName)
            $VirtualDirectories=@(Get-WebVirtualDirectory -Site $SiteName | Where-Object path -ne '/')
            if (!$Bindings.Count -or $Applications.Count -or $VirtualDirectories.Count -or @($Bindings | Where-Object { $P=Convert-FamBinding $_; !$P -or $P.HostName -ne $HostName -or $P.IP -notin @('*','0.0.0.0',$ServerAddress) -or !(($_.protocol -eq 'https' -and $P.Port -eq '443') -or ($_.protocol -eq 'http' -and $P.Port -eq '80')) }).Count) { throw "Existing site '$SiteName' has other bindings/apps/directories. Refusing to repoint a shared site automatically." }
            if (!$UseExistingSite -and !(Read-FamYes "Repoint ONLY existing dedicated site '$SiteName' from '$($TargetSite.physicalPath)' to FAM?" -Unattended:$Unattended)) { throw 'Existing site was not changed. Rerun with explicit approval if it is dedicated to FAM.' }
        }
        $OldSitePath=$TargetSite.physicalPath;$OldPool=$TargetSite.applicationPool
    }

    # Never silently remove an organisation's IIS authentication gate. A new
    # site can inherit one too. Network permissions were arranged separately.
    $AuthModules=@(Get-WebGlobalModule | Select-Object -ExpandProperty Name)
    $AuthParams=@{PSPath='MACHINE/WEBROOT/APPHOST';Name='enabled'}
    if ($TargetSite) { $AuthParams.Location=$SiteName }
    $ExistingGate=!(Get-WebConfigurationProperty @AuthParams -Filter 'system.webServer/security/authentication/anonymousAuthentication').Value
    foreach ($Auth in @(@('WindowsAuthenticationModule','windowsAuthentication'),@('BasicAuthenticationModule','basicAuthentication'))) {
        if ($Auth[0] -in $AuthModules) {
            if ((Get-WebConfigurationProperty @AuthParams -Filter ('system.webServer/security/authentication/'+$Auth[1])).Value) { $ExistingGate=$true }
        }
    }
    if ($ExistingGate -and !$UseFamAuthentication -and !(Read-FamYes 'This site has/inherits an IIS authentication gate. Replace it ONLY for FAM with anonymous IIS access + FAM application login? Confirm with your network administrator first.' -Unattended:$Unattended)) {
        throw 'Existing IIS authentication policy preserved. Obtain approval or configure integrated authentication manually.'
    }

    # Reuse an existing hostname-valid certificate; private keys are never exported.
    $ForeignSSL=@(Get-ChildItem IIS:\SslBindings | Where-Object { $_.PSObject.Properties['Host'] -and $_.Host -ieq $HostName -and $_.Port -eq 443 })
    if (!$MatchingSites.Count -and $ForeignSSL.Count) { throw 'An HTTPS hostname binding already exists outside the selected IIS site. It will not be overwritten.' }
    $Candidates=@(foreach ($Store in @('My','WebHosting')) {
        foreach ($Cert in @(Get-ChildItem ('Cert:\LocalMachine\'+$Store) -ErrorAction SilentlyContinue)) {
            if (Test-FamCertificate $Cert $HostName) { [pscustomobject]@{ Cert=$Cert; Store=$Store } }
        }
    })
    $Chosen=$null
    if ($CertificateThumbprint) {
        $Thumb=($CertificateThumbprint -replace '\s','').ToUpperInvariant()
        $Chosen=$Candidates | Where-Object { $_.Cert.Thumbprint -eq $Thumb } | Select-Object -First 1
        if (!$Chosen) { throw 'Requested certificate is absent, expired, has no private key, or does not cover the hostname.' }
    } else {
        $Bound=@(Get-WebBinding -Protocol https | ForEach-Object {
            if ($_.certificateHash -is [byte[]]) { [BitConverter]::ToString($_.certificateHash).Replace('-','') } else { [string]$_.certificateHash }
        })
        $Preferred=@($Candidates | Where-Object { $_.Cert.Thumbprint -in $Bound })
        if ($Preferred.Count -eq 1) { $Chosen=$Preferred[0] }
        elseif ($Candidates.Count -eq 1) { $Chosen=$Candidates[0] }
        elseif ($Candidates.Count -gt 1) {
            for ($i=0;$i -lt $Candidates.Count;$i++) { Write-Host "$($i+1): $($Candidates[$i].Cert.Subject) / $($Candidates[$i].Cert.Thumbprint) / expires $($Candidates[$i].Cert.NotAfter)" }
            if ($Unattended) { throw 'Several valid certificates: supply -CertificateThumbprint.' }
            $Number=0
            if (![int]::TryParse((Read-Host 'Certificate number'),[ref]$Number) -or $Number -lt 1 -or $Number -gt $Candidates.Count) { throw 'Invalid certificate selection.' }
            $Chosen=$Candidates[$Number-1]
        }
    }
    if (!$Chosen) {
        if (!$CreateCertificate -and !(Read-FamYes "No usable certificate covers '$HostName'. Create a NEW self-signed certificate for FAM only, leaving other certificates unchanged?" -Unattended:$Unattended)) { throw 'A hostname-valid certificate is required. Existing IP-only certificates do not cover the requested hostname.' }
        $Cert=New-SelfSignedCertificate -DnsName $HostName -CertStoreLocation Cert:\LocalMachine\My -Type SSLServerAuthentication -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2) -FriendlyName ('FAM '+$HostName)
        if (!(Test-FamCertificate $Cert $HostName)) { throw "The generated certificate does not contain DNS SAN $HostName; it will not be bound." }
        $Chosen=[pscustomobject]@{ Cert=$Cert; Store='My' }
    }
    $Certificate=$Chosen.Cert
    if (!(Test-FamCertificate $Certificate $HostName)) { throw "Selected certificate has no usable DNS SAN for $HostName." }
    $Dependencies=Get-Content -Raw (Join-Path $PSScriptRoot 'dependencies.json') | ConvertFrom-Json
    $Payload=Join-Path $PSScriptRoot 'payload'
    if ($Offline) { Write-Host 'OFFLINE MODE: runtime installers and Python wheels must be pre-staged.' }
    $IISModules=@(Get-WebGlobalModule | Select-Object -ExpandProperty Name)
    if ('RewriteModule' -notin $IISModules) {
        $File=Get-FamInstaller $Dependencies.rewrite $Payload $Cache -Offline:$Offline
        Invoke-FamInstaller "$env:SystemRoot\System32\msiexec.exe" ('/i "'+$File+'" /qn /norestart /L*v "'+(Join-Path $LogDir ('rewrite-'+$Stamp+'.log'))+'"')
    }
    if ('ApplicationRequestRouting' -notin $IISModules) {
        $File=Get-FamInstaller $Dependencies.arr $Payload $Cache -Offline:$Offline
        Invoke-FamInstaller "$env:SystemRoot\System32\msiexec.exe" ('/i "'+$File+'" /qn /norestart /L*v "'+(Join-Path $LogDir ('arr-'+$Stamp+'.log'))+'"')
    }
    # No explicit iisreset. Shared IIS MSI prerequisites can still affect service availability.
    Remove-Module WebAdministration;Import-Module WebAdministration
    $Modules=@(Get-WebGlobalModule | Select-Object -ExpandProperty Name)
    if ('RewriteModule' -notin $Modules -or 'ApplicationRequestRouting' -notin $Modules) { throw 'IIS Rewrite/ARR modules did not register successfully.' }
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value $true

    $Python=$null
    foreach ($Version in @('3.14','3.13','3.12')) {
        $Key='HKLM:\SOFTWARE\Python\PythonCore\'+$Version+'\InstallPath'
        if (Test-Path $Key) {
            $Base=(Get-Item -LiteralPath $Key).GetValue('')
            $Candidate=Join-Path $Base 'python.exe'
            if (Test-Path $Candidate) { $Python=$Candidate;break }
        }
    }
    if (!$Python) {
        $File=Get-FamInstaller $Dependencies.python $Payload $Cache -Offline:$Offline
        $PythonDir=Join-Path $env:ProgramFiles 'FAM-Python314'
        Invoke-FamInstaller $File ('/quiet /norestart InstallAllUsers=1 TargetDir="'+$PythonDir+'" PrependPath=0 Include_launcher=0 Include_test=0 Include_pip=1 /log "'+(Join-Path $LogDir ('python-'+$Stamp+'.log'))+'"')
        $Python=Join-Path $PythonDir 'python.exe'
    }
    & $Python -c "import struct,sys; assert struct.calcsize('P')==8 and sys.version_info>=(3,12)"
    if ($LASTEXITCODE -ne 0) { throw 'Compatible machine-wide x64 Python was not found.' }
    $DB=Join-Path $DataDir 'fam.sqlite3'
    if (Test-Path -LiteralPath $DB) {
        & $Python (Join-Path $PSScriptRoot 'preflight_backup.py') $DB (Join-Path $BackupDir ('before-install-'+$Stamp+'.sqlite3'))
        if ($LASTEXITCODE -ne 0) { throw 'Pre-install database backup failed. Existing data will not be overwritten.' }
    }
    # Stop only this FAM task, not IIS or unrelated services, before copying code.
    Assert-FamTask 'FAM-Central' (Join-Path $TargetServer 'windows\start.ps1')
    if (Get-ScheduledTask -TaskName FAM-Central -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName FAM-Central }
    $Until=(Get-Date).AddSeconds(30)
    while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $Until) { Start-Sleep -Milliseconds 500 }
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8765 is occupied. No unknown process will be killed.' }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Set-FamPrivateAcl $InstallRoot
    foreach ($Child in @(Get-ChildItem -LiteralPath $InstallRoot -Force)) {
        & icacls $Child.FullName /reset /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect application files from non-administrator modification.' }
    }
    # Explicit deployment allowlist: never copy/delete settings.json, .venv,
    # live data, or an accidental extra executable/source file in the kit.
    $ServerFiles=@('app.py','manage.py','account_policy.py','equipment_guard.py','bootstrap_admin.py','equipment_inventory.py','equipment_ops.py','equipment_probe.py','requirements.txt')
    $WindowsFiles=@('install.ps1','start.ps1','backup-daily.ps1','trust-client.ps1',
        'preflight_backup.py','verify_deployment.py','prepare-offline.ps1',
        'setup-common.psm1','setup-ertebatat.ps1','dependencies.json','offline-wheels.json')
    # The large interactive client is deliberately private: Flask sends it
    # only after the FAM session check. IIS receives just the small login shell.
    $PrivateUiFiles=@('FAM.html')
    $WwwFiles=@('login.html','login.css','login.js','web.config')
    $Files=@(
        @($ServerFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $SourceServer $_) })
        @($PrivateUiFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $SourceServer "private_ui\$_") })
        @($WindowsFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $PSScriptRoot $_) })
        @($WwwFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $SourceServer "www\$_") })
    )
    foreach ($File in $Files) {
        $Relative=$File.FullName.Substring($SourceServer.Length).TrimStart('\')
        $Destination=Join-Path $TargetServer $Relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
        if ($File.FullName -ine $Destination) { Copy-Item -LiteralPath $File.FullName -Destination $Destination -Force }
        if ($Relative.StartsWith('www\',[StringComparison]::OrdinalIgnoreCase)) { [IO.File]::SetLastWriteTimeUtc($Destination,[DateTime]::UtcNow) }
    }
    $Wheelhouse=Join-Path $Payload 'wheels'
    $BackendArgs=@{ PublicOrigin=$Origin; DataDir=$DataDir; PythonExecutable=$Python }
    if ($Offline) { $BackendArgs.Wheelhouse=$Wheelhouse }
    & (Join-Path $TargetServer 'windows\install.ps1') @BackendArgs
    Wait-FamBackend

    $Pool='FAM-Communication-02-Pool'
    if (!(Test-Path ('IIS:\AppPools\'+$Pool))) { New-WebAppPool -Name $Pool | Out-Null }
    $OtherPoolUsers=@(foreach ($S in @(Get-Website)) {
        if ($S.Name -ne $SiteName -and $S.applicationPool -eq $Pool) { $S }
        foreach ($A in @(Get-WebApplication -Site $S.Name)) { if ($A.applicationPool -eq $Pool) { $A } }
    })
    if ($OtherPoolUsers.Count) { throw 'The FAM pool is used by another site. Refusing to change a shared pool.' }
    Set-ItemProperty ('IIS:\AppPools\'+$Pool) -Name managedRuntimeVersion -Value ''
    Set-ItemProperty ('IIS:\AppPools\'+$Pool) -Name processModel.identityType -Value 4
    if (!$TargetSite) {
        New-Website -Name $SiteName -PhysicalPath $WebRoot -ApplicationPool $Pool -IPAddress $ServerAddress -Port 443 -HostHeader $HostName -Ssl | Out-Null
        $NewSite=$true
    } else {
        Set-ItemProperty ('IIS:\Sites\'+$SiteName) -Name physicalPath -Value $WebRoot
        Set-ItemProperty ('IIS:\Sites\'+$SiteName) -Name applicationPool -Value $Pool
    }
    Set-FamSniCertificate $SiteName $ServerAddress $HostName $Certificate $Chosen.Store
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter 'system.webServer/security/authentication/anonymousAuthentication' -Name enabled -Value $true
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter 'system.webServer/security/authentication/anonymousAuthentication' -Name userName -Value ''
    foreach ($Auth in @(@('WindowsAuthenticationModule','windowsAuthentication'),@('BasicAuthenticationModule','basicAuthentication'))) {
        if ($Auth[0] -in $Modules) { Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter ('system.webServer/security/authentication/'+$Auth[1]) -Name enabled -Value $false }
    }
    & icacls $WebRoot /grant ('IIS AppPool\'+$Pool+':(OI)(CI)RX') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to grant the FAM pool read-only access to www.' }
    # No IIS identity is given access to the database directory.
    $Rule='FAM-Communication-02-HTTPS'
    $ExistingRule=Get-NetFirewallRule -Name $Rule -ErrorAction SilentlyContinue
    if ($ExistingRule) { Write-Host 'Existing FAM firewall rule retained without changing administrator-defined scopes.' }
    elseif ($AddFirewallRule) { New-NetFirewallRule -Name $Rule -DisplayName ('FAM HTTPS ('+$HostName+')') -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -LocalAddress $ServerAddress -Profile @('Domain','Private') -RemoteAddress LocalSubnet | Out-Null }
    else { Write-Host 'Firewall/GPO access left unchanged as arranged by the network administrator.' }
    Start-WebAppPool -Name $Pool -ErrorAction SilentlyContinue
    Start-Website -Name $SiteName

    $ClientDir=Join-Path $DataDir 'client-setup'
    New-Item -ItemType Directory -Force -Path $ClientDir | Out-Null
    $CerPath=Join-Path $ClientDir 'fam-server.cer'
    Export-Certificate -Cert $Certificate -FilePath $CerPath -Force | Out-Null
    Copy-Item (Join-Path $TargetServer 'windows\trust-client.ps1') (Join-Path $ClientDir 'trust-client.ps1') -Force
    @('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0trust-client.ps1"','pause') | Set-Content -Encoding ASCII (Join-Path $ClientDir 'TRUST-FAM.cmd')
    @('[InternetShortcut]',('URL='+$Origin)) | Set-Content -Encoding ASCII (Join-Path $ClientDir 'FAM.url')
    @{hostName=$HostName;address=$ServerAddress;thumbprint=$Certificate.Thumbprint;sha256=(Get-FileHash $CerPath -Algorithm SHA256).Hash;selfSigned=($Certificate.Subject -eq $Certificate.Issuer)} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $ClientDir 'certificate.json')
    $StatusPath=Join-Path $LogDir ('verification-'+$Stamp+'.json')
    & (Join-Path $TargetServer '.venv\Scripts\python.exe') (Join-Path $TargetServer 'windows\verify_deployment.py') --host $HostName --address $ServerAddress --cert $CerPath --output $StatusPath
    if ($LASTEXITCODE -ne 0) { throw "HTTPS/API verification failed. See $StatusPath" }
    $DNSGood=$false
    try { $DNSGood=$ServerAddress -in @([Net.Dns]::GetHostAddresses($HostName) | ForEach-Object { $_.IPAddressToString }) } catch { Write-Warning 'This server cannot resolve the desired hostname.' }
    # A daily full database backup, using the same restricted service identity.
    $BackupAction=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $TargetServer 'windows\backup-daily.ps1')+'"') -WorkingDirectory $TargetServer
    $Principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
    Register-ScheduledTask -TaskName FAM-Central-Backup -Action $BackupAction -Trigger (New-ScheduledTaskTrigger -Daily -At '23:00') -Principal $Principal -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)) -Force | Out-Null
    & (Join-Path $TargetServer 'windows\backup-daily.ps1')
    @{url=$Origin;serverAddress=$ServerAddress;site=$SiteName;db=$DB;certificate=$Certificate.Thumbprint;iisBackup=$IISBackup;dnsOnServer=$DNSGood;httpsApiVerified=$true;clientTrust='Check on each workstation';log=$Log} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $InstallRoot 'deployment.json')
    Write-Host "SERVER HTTPS + API VERIFIED: $Origin" -ForegroundColor Green
    Write-Host "Initial administrator: admin (existing credentials are NEVER reset). Create individual users inside FAM."
    Write-Host "Client setup/public certificate: $ClientDir"
    Write-Host "Certificate SHA256: $((Get-FileHash $CerPath -Algorithm SHA256).Hash)"
    Write-Host 'Daily backup: 23:00 server local time. Every backup has a new date/time name; old copies are retained. Keep an additional protected copy on another disk/server; monitor free space.'
    if (!$DNSGood) {
        Write-Warning "DNS still needs verification: $HostName must resolve to $ServerAddress on user PCs. Organisation DNS was NOT modified. Server-side installation succeeded, but client readiness is not confirmed."
        $ExitCode=2
    } else { $ExitCode=0 }
    Write-Host 'Client trust, routing, GPO firewall policy, and access from another PC still require the included client check.'
} catch {
    Write-Host ('SETUP NOT COMPLETE: '+$_.Exception.Message) -ForegroundColor Red
    if ($NewSite) { Stop-Website -Name $SiteName -ErrorAction SilentlyContinue }
    elseif ($OldSitePath) {
        # Undo only our target root/pool change. Do not restore global IIS config automatically.
        try { Set-ItemProperty ('IIS:\Sites\'+$SiteName) -Name physicalPath -Value $OldSitePath;Set-ItemProperty ('IIS:\Sites\'+$SiteName) -Name applicationPool -Value $OldPool } catch { Write-Warning 'Target-site rollback needs administrator inspection.' }
    }
    Write-Warning 'Existing databases are preserved. Shared prerequisites may have been installed; no global IIS rollback, reboot, or unrelated process termination was attempted. Review the setup log before retrying.'
    $ExitCode=1
} finally {
    if ($Transcript) { Stop-Transcript | Out-Null }
    if ($Locked) { $Mutex.ReleaseMutex() }
    $Mutex.Dispose()
    if ($PauseAtEnd) { Read-Host 'Press Enter to close this setup window' | Out-Null }
}
exit $ExitCode
