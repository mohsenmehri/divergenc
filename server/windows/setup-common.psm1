Set-StrictMode -Version Latest

function Assert-FamDirectory([string]$Path) {
    $Full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($Full -notmatch '^[A-Za-z]:\\[^\\]+' -or $Full -match '[\r\n"]') { throw 'Use a dedicated directory on a local drive.' }
    foreach ($Reserved in @($env:SystemRoot, $env:ProgramFiles, $env:ProgramData, ($env:SystemDrive+'\Users'))) {
        if ($Reserved -and $Full -ieq $Reserved.TrimEnd('\')) { throw "Do not use a shared system directory: $Full" }
    }
    foreach ($Reserved in @($env:SystemRoot, ($env:SystemDrive+'\Users'))) {
        if ($Reserved -and $Full.StartsWith($Reserved.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Do not install application/data beneath Windows or user profiles.' }
    }
    $Cursor=$Full
    while ($Cursor) {
        if ((Test-Path -LiteralPath $Cursor) -and ((Get-Item -LiteralPath $Cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse-point directory is not allowed: $Cursor" }
        $Cursor=Split-Path -Parent $Cursor
    }
    return $Full
}

function Assert-FamTask([string]$Name,[string]$Script) {
    $Task=Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (!$Task) { return }
    $Actions=@($Task.Actions)
    if ($Actions.Count -ne 1 -or [IO.Path]::GetFileName($Actions[0].Execute) -notin @('powershell.exe','pwsh.exe') -or $Actions[0].Arguments -notmatch '(?i)-File\s+(?:"(?<file>[^"]+)"|(?<file>\S+))' -or [IO.Path]::GetFullPath($Matches.file) -ine [IO.Path]::GetFullPath($Script)) {
        throw "Existing task $Name belongs to another installation. Use the original InstallRoot / manual migration; no task will be stopped or replaced."
    }
}

function Assert-FamNoLinks([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { return }
    $Pending=[Collections.Generic.Stack[string]]::new()
    $Pending.Push($Path)
    while ($Pending.Count) {
        $Current=$Pending.Pop()
        foreach ($Item in @(Get-ChildItem -LiteralPath $Current -Force)) {
            if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "No symlinks/junctions allowed in FAM code/data: $($Item.FullName)" }
            if ($Item.PSIsContainer) { $Pending.Push($Item.FullName) }
        }
    }
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
    # The hash is the non-network integrity anchor for this exact release. It
    # is checked before Authenticode, on every machine, before any execution.
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Spec.sha256) { throw "SHA256 mismatch: $File. Nothing from this file will be executed." }
    $Signature = Get-AuthenticodeSignature -LiteralPath $File
    $ExpectedPublisher=[regex]::Escape($Spec.publisher)
    if ($Signature.Status -eq 'Valid' -and $Signature.SignerCertificate -and $Signature.SignerCertificate.Subject -match $ExpectedPublisher) { return $File }

    # Isolated servers often cannot contact the Microsoft/public CA revocation
    # endpoints, so Windows reports UnknownError or NotTrusted despite an intact
    # embedded signature. Only this narrow chain-availability case may proceed
    # offline: an unsigned file, altered signature, wrong signer, or wrong hash
    # still always stops. Internet-connected preparation remains strictly Valid.
    if ($Offline -and (([string]$Signature.Status) -in @('UnknownError','NotTrusted')) -and $Signature.SignerCertificate -and $Signature.SignerCertificate.Subject -match $ExpectedPublisher) {
        Write-Warning "Offline certificate-chain validation unavailable for $File ($($Signature.Status)). The pinned SHA256 matched and the embedded signer is $($Signature.SignerCertificate.Subject); proceeding under the isolated-server policy."
        return $File
    }
    throw "Publisher signature verification failed for $File (status: $($Signature.Status); signer: $($Signature.SignerCertificate.Subject)). Exact SHA256 matching is required and the only offline exception is UnknownError/NotTrusted with the expected embedded publisher."
}

function Assert-FamWheels([string]$ManifestPath,[string]$Wheelhouse) {
    $Manifest=Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
    $Names=@($Manifest.files | ForEach-Object { $_.file })
    $Problems=@(foreach ($Spec in $Manifest.files) {
        if ([IO.Path]::GetFileName($Spec.file) -cne $Spec.file) { throw 'Invalid wheel manifest filename.' }
        $File=Join-Path $Wheelhouse $Spec.file
        if (!(Test-Path -LiteralPath $File -PathType Leaf)) { "Missing wheel: $($Spec.file)" }
        elseif ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Spec.sha256) { "Damaged/modified wheel: $($Spec.file)" }
    })
    if (Test-Path -LiteralPath $Wheelhouse) {
        $Problems+=@(Get-ChildItem -LiteralPath $Wheelhouse -Filter '*.whl' -File | Where-Object Name -notin $Names | ForEach-Object { "Unverified extra wheel: $($_.Name)" })
    }
    if ($Problems.Count) { throw ($Problems -join "`n") }
}

function Assert-FamOfflinePayload([string]$Directory) {
    $Payload=Join-Path $Directory 'payload'
    $Deps=Get-Content -Raw (Join-Path $Directory 'dependencies.json') | ConvertFrom-Json
    $Missing=@(foreach ($Name in @('python','rewrite','arr')) {
        if (!(Test-Path -LiteralPath (Join-Path $Payload $Deps.$Name.file) -PathType Leaf)) { $Deps.$Name.file }
    })
    if ($Missing.Count) { throw ('Offline files missing: '+($Missing -join ', ')+'. On the INTERNET PC run PREPARE-OFFLINE.cmd, or copy the three official installers into server\windows\payload. No server download will be attempted.') }
    Assert-FamWheels (Join-Path $Directory 'offline-wheels.json') (Join-Path $Payload 'wheels')
    foreach ($Name in @('python','rewrite','arr')) { Get-FamInstaller $Deps.$Name $Payload $Payload -Offline | Out-Null }
}

function Invoke-FamInstaller([string]$File, [string]$Arguments) {
    $Process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($Process.ExitCode -in @(3010,1641)) { throw 'Windows reports that a reboot is required. Restart in your maintenance window, then run this installer again. No automatic reboot is performed.' }
    if ($Process.ExitCode -ne 0) { throw "Installer failed (exit $($Process.ExitCode)): $File" }
}

function Get-FamCertificateNames($Certificate) {
    if (!@($Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }).Count) { return @() } # Modern browsers require SAN, not CN only.
    $Names = @()
    if ($Certificate.PSObject.Properties['DnsNameList']) {
        $Names = @($Certificate.DnsNameList | ForEach-Object { $_.Unicode.ToLowerInvariant() })
    }
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
