# FAM Equipment Connector -- user-mode VDI process, no Administrator or Python.
# The FAM session and every device credential remain only in this process memory.
# HTTPS certificate validation is intentionally the Windows/.NET default; do not
# add a certificate-validation callback or an insecure TLS option here.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$DefaultOrigin = 'https://communication-02.toosbank.corp'
$script:WebSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$script:Base = $null
$script:Csrf = ''

function Stop-Connector([string]$Message) {
    Write-Host ("Connector متوقف شد: " + $Message) -ForegroundColor Red
    exit 1
}

function Get-FamOrigin([string]$Value) {
    try { $uri = [System.Uri]$Value.Trim() } catch { Stop-Connector 'آدرس FAM معتبر نیست.' }
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        $uri.AbsolutePath -ne '/' -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
        Stop-Connector 'آدرس FAM باید یک HTTPS origin باشد؛ مانند https://communication-02.toosbank.corp'
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

function Get-ErrorMessage($Exception) {
    try {
        $response = $Exception.Response
        if ($null -ne $response) {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $body = $reader.ReadToEnd(); $reader.Dispose()
            $parsed = $body | ConvertFrom-Json
            if ($parsed.error) { return [string]$parsed.error }
        }
    } catch { }
    return 'پاسخ معتبر از FAM دریافت نشد.'
}

function Invoke-Fam([string]$Path, $Body, [int]$Timeout = 115) {
    $headers = @{ 'Accept' = 'application/json'; 'Origin' = $script:Base; 'User-Agent' = 'FAM-Equipment-Connector/2' }
    if ($script:Csrf) { $headers['X-FAM-CSRF'] = $script:Csrf }
    try {
        # This uses the Windows trusted-root store and hostname checks by default.
        $response = Invoke-WebRequest -Uri ($script:Base + $Path) -Method Post -Headers $headers -ContentType 'application/json' `
            -Body ($Body | ConvertTo-Json -Compress -Depth 6) -WebSession $script:WebSession -TimeoutSec $Timeout -UseBasicParsing
        return ($response.Content | ConvertFrom-Json)
    } catch {
        throw (Get-ErrorMessage $_.Exception)
    }
}

function ConvertTo-PlainText([Security.SecureString]$Secret) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-PrivateIPv4([string]$TargetHost) {
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($TargetHost, [ref]$address) -or $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $octets = $address.GetAddressBytes()
    return $octets[0] -eq 10 -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or ($octets[0] -eq 192 -and $octets[1] -eq 168)
}

function Get-ErrDisabledPorts([string]$Output) {
    $found = @{}
    foreach ($line in ($Output -split "`r?`n")) {
        $fields = @($line.Trim() -split '\s+' | Where-Object { $_ })
        if ($fields.Count -lt 2 -or $fields[0] -notmatch '^[A-Za-z][A-Za-z0-9/.-]{0,63}$') { continue }
        $statusIndex = -1
        for ($index = 1; $index -lt $fields.Count; $index++) {
            if ($fields[$index] -ieq 'err-disabled') { $statusIndex = $index; break }
        }
        if ($statusIndex -lt 0) { continue }
        $description = if ($statusIndex -gt 1) { ($fields[1..($statusIndex - 1)] -join ' ').Trim() } else { '' }
        if ($description -in @('--', '-', 'N/A')) { $description = '' }
        if ($description.Length -gt 128) { $description = $description.Substring(0, 128) }
        if (-not $found.ContainsKey($fields[0])) { $found[$fields[0]] = $description }
    }
    return @($found.Keys | Sort-Object | ForEach-Object { [pscustomobject]@{ interface = $_; description = $found[$_] } })
}

function Invoke-CiscoSsh([string]$TargetHost, [string]$Username, [string]$Password, [string[]]$Commands) {
    if (-not (Test-PrivateIPv4 $TargetHost) -or $Username -notmatch '^[A-Za-z0-9_.@\\-]{1,128}$') {
        return @{ ok = $false; error = 'invalid_request' }
    }
    try { $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source }
    catch { return @{ ok = $false; error = 'ssh_client_unavailable' } }

    $askPass = Join-Path ([System.IO.Path]::GetTempPath()) ('fam-equipment-askpass-' + [guid]::NewGuid().ToString('N') + '.cmd')
    try {
        # The temporary script contains no secret. The password is process-memory
        # only in an environment variable for the short-lived ssh.exe child.
        [System.IO.File]::WriteAllText($askPass, "@echo off`r`npowershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"[Console]::Out.Write(`$env:FAM_EQUIPMENT_ASKPASS_PASSWORD)`"`r`n", [Text.Encoding]::ASCII)
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $ssh
        $info.Arguments = '-o BatchMode=no -o NumberOfPasswordPrompts=1 -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -l ' + $Username + ' ' + $TargetHost
        $info.UseShellExecute = $false
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.CreateNoWindow = $true
        $info.EnvironmentVariables['SSH_ASKPASS'] = $askPass
        $info.EnvironmentVariables['SSH_ASKPASS_REQUIRE'] = 'force'
        $info.EnvironmentVariables['DISPLAY'] = 'FAM-Connector'
        $info.EnvironmentVariables['FAM_EQUIPMENT_ASKPASS_PASSWORD'] = $Password
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $info
        [void]$process.Start()
        foreach ($command in $Commands) { $process.StandardInput.WriteLine($command) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(50000)) {
            $process.Kill()
            return @{ ok = $false; error = 'connection_timeout' }
        }
        $output = $process.StandardOutput.ReadToEnd()
        $errorOutput = $process.StandardError.ReadToEnd()
        if ($process.ExitCode -ne 0) {
            $combined = $output + "`n" + $errorOutput
            if ($combined -match '(?i)permission denied|authentication failed') { return @{ ok = $false; error = 'authentication_failed' } }
            if ($combined -match '(?i)timed out|timeout') { return @{ ok = $false; error = 'connection_timeout' } }
            return @{ ok = $false; error = 'connection_failed' }
        }
        return @{ ok = $true; output = $output }
    } catch { return @{ ok = $false; error = 'connection_failed' } }
    finally {
        if ($info) { $info.EnvironmentVariables.Remove('FAM_EQUIPMENT_ASKPASS_PASSWORD') }
        Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-EquipmentJob($Job) {
    $operation = [string]$Job.operation
    $targetHost = [string]$Job.host
    $username = [string]$Job.username
    $password = [string]$Job.password
    if ($operation -notin @('status', 'recover') -or -not $password) { return @{ ok = $false; error = 'invalid_request' } }
    $status = Invoke-CiscoSsh $targetHost $username $password @('terminal length 0', 'show interfaces status', 'exit')
    if (-not $status.ok) { return $status }
    $ports = Get-ErrDisabledPorts ([string]$status.output)
    if ($operation -eq 'status') { return @{ ok = $true; ports = @($ports) } }

    $interface = [string]$Job.interface
    if ($interface -notmatch '^[A-Za-z][A-Za-z0-9/.-]{0,63}$') { return @{ ok = $false; error = 'invalid_request' } }
    if ($ports.interface -notcontains $interface) { return @{ ok = $true; recovery = 'not_errdisabled' } }
    $recovery = Invoke-CiscoSsh $targetHost $username $password @('terminal length 0', 'configure terminal', ('interface ' + $interface), 'shutdown', 'no shutdown', 'end', 'exit')
    if (-not $recovery.ok) { return $recovery }
    $after = Invoke-CiscoSsh $targetHost $username $password @('terminal length 0', 'show interfaces status', 'exit')
    if (-not $after.ok) { return $after }
    $afterPorts = Get-ErrDisabledPorts ([string]$after.output)
    return @{ ok = $true; recovery = $(if ($afterPorts.interface -contains $interface) { 'still_errdisabled' } else { 'recovered' }) }
}

try {
    Write-Host 'FAM Equipment Connector — بدون نصب Python و بدون Administrator' -ForegroundColor Cyan
    $entered = Read-Host ("آدرس FAM [{0}]" -f $DefaultOrigin)
    if (-not $entered) { $entered = $DefaultOrigin }
    $script:Base = Get-FamOrigin $entered
    $username = Read-Host 'نام کاربری FAM'
    $secret = Read-Host 'رمز FAM' -AsSecureString
    if (-not $username -or $secret.Length -eq 0) { Stop-Connector 'نام کاربری و رمز FAM لازم است.' }
    $loginPassword = ConvertTo-PlainText $secret
    try { $login = Invoke-Fam '/api/login' @{ username = $username; password = $loginPassword } 40 }
    finally { $loginPassword = $null }
    $script:Csrf = [string]$login.csrf
    if (-not $script:Csrf) { Stop-Connector 'ورود Connector به FAM تأیید نشد.' }
    $label = if ($login.user.name) { [string]$login.user.name } else { $username }
    Write-Host ("Connector برای «{0}» متصل شد. این پنجره را باز نگه دارید." -f $label) -ForegroundColor Green
    Write-Host 'برای توقف امن Ctrl+C را بزنید. هیچ رمز تجهیزی ذخیره نمی‌شود.'
    while ($true) {
        $claim = Invoke-Fam '/api/equipment/connector/claim' @{} 45
        if ($null -eq $claim.job) { continue }
        $job = $claim.job
        if (-not $job.jobId) { Stop-Connector 'درخواست Connector معتبر نیست.' }
        $jobId = [string]$job.jobId
        $result = Invoke-EquipmentJob $job
        [void](Invoke-Fam '/api/equipment/connector/complete' @{ jobId = $jobId; result = $result } 45)
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host "`nConnector متوقف شد."
} catch {
    Stop-Connector ([string]$_.Exception.Message)
}
