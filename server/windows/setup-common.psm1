Set-StrictMode -Version Latest

function Assert-FamDirectory([string]$Path) {
    $Full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($Full -notmatch '^[A-Za-z]:\\[^\\]+' -or $Full -match '[\r\n"]') { throw 'Use a dedicated directory on a local drive.' }
    foreach ($Reserved in @($env:SystemRoot, $env:ProgramFiles, $env:ProgramData, ($env:SystemDrive+'\Users'))) {
        if ($Reserved -and $Full -ieq $Reserved.TrimEnd('\')) { throw "Do not use a shared system directory: $Full" }
    }
    return $Full
}

function Set-FamPrivateAcl([string]$Path, [string]$ServiceRights='ReadAndExecute') {
    $Acl = [Security.AccessControl.DirectorySecurity]::new()
    $Acl.SetAccessRuleProtection($true, $false)
    foreach ($Pair in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @('S-1-5-19',$ServiceRights))) {
        $Sid = [Security.Principal.SecurityIdentifier]::new($Pair[0])
        $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Sid,$Pair[1],'ContainerInherit,ObjectInherit','None','Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $Acl
}

function Get-FamInstaller($Spec, [string]$Payload, [string]$Cache, [switch]$Offline) {
    $File = Join-Path $Payload $Spec.file
    if (!(Test-Path -LiteralPath $File)) {
        $File = Join-Path $Cache $Spec.file
        if (!(Test-Path -LiteralPath $File)) {
            if ($Offline) { throw "Offline prerequisite missing: $($Spec.file). See the offline instructions." }
            Write-Host "Downloading $($Spec.file) from its publisher..."
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri $Spec.url -OutFile ($File+'.partial') -TimeoutSec 600
            Move-Item -LiteralPath ($File+'.partial') -Destination $File -Force
        }
    }
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Spec.sha256) { throw "SHA256 mismatch: $File. Nothing from this file will be executed." }
    $Signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch [regex]::Escape($Spec.publisher)) {
        throw "Publisher signature verification failed for $File. Fix the Windows trust chain; verification is not bypassed."
    }
    return $File
}

function Invoke-FamInstaller([string]$File, [string]$Arguments) {
    $Process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($Process.ExitCode -in @(3010,1641)) { throw 'Windows reports that a reboot is required. Restart in your maintenance window, then run this installer again. No automatic reboot is performed.' }
    if ($Process.ExitCode -ne 0) { throw "Installer failed (exit $($Process.ExitCode)): $File" }
}

function Get-FamCertificateNames($Certificate) {
    $Names = @()
    if ($Certificate.PSObject.Properties['DnsNameList']) {
        $Names = @($Certificate.DnsNameList | ForEach-Object { $_.Unicode.ToLowerInvariant() })
    }
    if (!$Names.Count) { $Names = @($Certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::DnsName,$false).ToLowerInvariant()) }
    return $Names
}

function Test-FamCertificate($Certificate, [string]$HostName) {
    if (!$Certificate.HasPrivateKey -or $Certificate.NotAfter -le (Get-Date) -or $Certificate.NotBefore -gt (Get-Date)) { return $false }
    # This deployment deliberately uses a single-label intranet name. No wildcard matching.
    return (Get-FamCertificateNames $Certificate) -contains $HostName.ToLowerInvariant()
}

function Convert-FamBinding($Binding) {
    $Parts = ([string]$Binding.bindingInformation) -split ':'
    if ($Parts.Count -ne 3) { return $null } # This installer is IPv4-only.
    return [pscustomobject]@{ IP=$Parts[0]; Port=$Parts[1]; HostName=$Parts[2].ToLowerInvariant() }
}

function Read-FamYes([string]$Message, [switch]$Unattended) {
    if ($Unattended) { return $false }
    return ((Read-Host ($Message+' Type YES to continue')) -ceq 'YES')
}

function Wait-FamBackend([int]$Seconds=60) {
    $Until = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $Request = [Net.HttpWebRequest]::Create('http://127.0.0.1:8765/api/session')
            $Request.Timeout = 2000
            $Request.Proxy = $null
            $Response = $Request.GetResponse()
            $Response.Close()
        } catch [Net.WebException] {
            if ($_.Exception.Response) {
                $Response = $_.Exception.Response
                try {
                    if ([int]$Response.StatusCode -eq 401 -and $Response.ContentType -like 'application/json*') { return }
                } finally { $Response.Close() }
            }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $Until)
    throw 'Backend readiness failed. Inspect the private logs and FAM-Central task. A login form alone is NOT a successful installation.'
}

Export-ModuleMember -Function *-Fam*
