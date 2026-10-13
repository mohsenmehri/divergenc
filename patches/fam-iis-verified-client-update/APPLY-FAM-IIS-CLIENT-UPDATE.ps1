#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
Updates only the public central FAM client. It discovers the IIS site by its
HTTPS host binding, so FAM.html is never copied to an assumed/wrong directory.
No database, account, backend Python, certificate, DNS, or IIS binding changes.
#>
[CmdletBinding()]
param(
    [string]$HostName='communication-02.toosbank.corp',
    [string]$SiteName=''
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath
$Payload=Join-Path $PatchRoot 'payload'
$SourceHtml=Join-Path $Payload 'FAM.html'
$SourceConfig=Join-Path $Payload 'web.config'
$Manifest=Join-Path $Payload 'SHA256SUMS.txt'
$Release='FAM-UI-17-IIS-20261013.1'
$Backup=$null
$TargetHtml=$null
$TargetConfig=$null
$Copied=$false
$WasStarted=$false
$Site=$null

function Assert-File([string]$Path,[string]$Message) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw $Message }
}
function Get-PayloadHash([string]$RelativePath) {
    $line=@(Get-Content -LiteralPath $Manifest | Where-Object { $_ -match ('\s'+[regex]::Escape($RelativePath)+'$') })
    if ($line.Count -ne 1) { throw "Payload manifest has no unique checksum for $RelativePath." }
    return (($line[0] -split '\s+')[0]).ToLowerInvariant()
}
function Assert-Payload([string]$Path,[string]$RelativePath) {
    Assert-File $Path "Required patch payload is missing: $RelativePath"
    $actual=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne (Get-PayloadHash $RelativePath)) { throw "Patch payload checksum failed: $RelativePath. Extract the ZIP again and do not continue." }
}
function Get-IISBindingHost([object]$Binding) {
    # WebAdministration binding objects on Server 2019 do not consistently
    # expose HostHeader. bindingInformation is stable: IP:port:host-header.
    $info=[string]$Binding.bindingInformation
    $separator=$info.LastIndexOf(':')
    if ($separator -lt 0) { return '' }
    return $info.Substring($separator+1).Trim()
}
function Get-ConfiguredSite {
    if ($SiteName) {
        $selected=Get-Website -Name $SiteName -ErrorAction SilentlyContinue
        if (!$selected) { throw "IIS site '$SiteName' was not found. No file was changed." }
        return $selected
    }
    $matches=@()
    foreach ($candidate in @(Get-Website)) {
        $bindings=@(Get-WebBinding -Name $candidate.Name -Protocol https -ErrorAction SilentlyContinue)
        if (@($bindings | Where-Object { $bindingHost=Get-IISBindingHost $_; $bindingHost -and $bindingHost.ToLowerInvariant() -eq $HostName.Trim().ToLowerInvariant() }).Count) { $matches+=$candidate }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    if ($matches.Count -gt 1) { throw "More than one IIS site has the HTTPS host binding '$HostName'. No file was changed." }

    # The supported installer uses this dedicated site name. It is only a
    # fallback when the binding is a wildcard or legacy binding with no host.
    $fallback=Get-Website -Name 'FAM-Ertebatat' -ErrorAction SilentlyContinue
    if ($fallback -and (Test-Path -LiteralPath (Join-Path $fallback.physicalPath 'FAM.html') -PathType Leaf)) { return $fallback }
    throw "No IIS site with HTTPS host '$HostName' was found, and the supported FAM-Ertebatat fallback is unavailable. No file was changed."
}
function Restart-TargetSite {
    if (!$script:WasStarted) { return }
    Stop-Website -Name $script:Site.Name
    Start-Website -Name $script:Site.Name
}
function Verify-Deployment {
    $htmlHash=(Get-FileHash -LiteralPath $TargetHtml -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($htmlHash -ne (Get-PayloadHash 'FAM.html')) { throw 'The deployed FAM.html checksum does not match the verified payload.' }
    foreach ($check in @(
        @($TargetHtml,'name="fam-release" content="'+$Release+'"'),
        @($TargetHtml,'operation-primary-action'),
        @($TargetHtml,'manageCategorySections'),
        @($TargetConfig,'cacheControlMode="DisableCache"'),
        @($TargetConfig,'no-store, no-cache, must-revalidate, max-age=0')
    )) {
        if (!(Select-String -LiteralPath $check[0] -SimpleMatch -Quiet -Pattern $check[1])) { throw "Deployment verification failed: missing '$($check[1])' in $($check[0])." }
    }
}

try {
    Import-Module WebAdministration -ErrorAction Stop
    Assert-File $Manifest 'Patch checksum manifest is missing.'
    Assert-Payload $SourceHtml 'FAM.html'
    Assert-Payload $SourceConfig 'web.config'

    $Site=Get-ConfiguredSite
    $WebRoot=[Environment]::ExpandEnvironmentVariables([string]$Site.physicalPath).TrimEnd('\')
    $TargetHtml=Join-Path $WebRoot 'FAM.html'
    $TargetConfig=Join-Path $WebRoot 'web.config'
    Assert-File $TargetHtml "The IIS physical path '$WebRoot' does not contain FAM.html. No file was changed."
    Assert-File $TargetConfig "The IIS physical path '$WebRoot' does not contain web.config. No file was changed."

    $Backup=Join-Path $env:ProgramData ('FAM\\client-update-backups\\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Copy-Item -LiteralPath $TargetHtml -Destination (Join-Path $Backup 'FAM.html') -Force
    Copy-Item -LiteralPath $TargetConfig -Destination (Join-Path $Backup 'web.config') -Force

    $WasStarted=($Site.State -eq 'Started')
    # Mark the transaction before the first replacement so even a partial copy
    # enters the automatic rollback path.
    $Copied=$true
    Copy-Item -LiteralPath $SourceHtml -Destination $TargetHtml -Force
    Copy-Item -LiteralPath $SourceConfig -Destination $TargetConfig -Force
    Restart-TargetSite
    Verify-Deployment

    $result=@(
        'FAM IIS CLIENT UPDATE: SUCCESS',
        'Release: '+$Release,
        'IIS site: '+$Site.Name,
        'HTTPS host: '+$HostName,
        'Actual IIS physical path: '+$WebRoot,
        'FAM.html SHA-256: '+(Get-FileHash -LiteralPath $TargetHtml -Algorithm SHA256).Hash,
        'Backup: '+$Backup,
        'The deployed web.config now forces no-store/no-cache responses for every FAM.html request.'
    )
    $result | Set-Content -LiteralPath (Join-Path $Backup 'UPDATE-RESULT.txt') -Encoding UTF8
    $result | ForEach-Object { Write-Host $_ -ForegroundColor Green }
    exit 0
} catch {
    $message=$_.Exception.Message
    if ($Copied -and $Backup -and $TargetHtml -and $TargetConfig) {
        try {
            Copy-Item -LiteralPath (Join-Path $Backup 'FAM.html') -Destination $TargetHtml -Force
            Copy-Item -LiteralPath (Join-Path $Backup 'web.config') -Destination $TargetConfig -Force
            Restart-TargetSite
            Write-Warning 'The prior FAM.html and web.config were restored automatically from the backup.'
        } catch { Write-Warning 'Automatic rollback failed. Restore FAM.html and web.config from: '+$Backup }
    }
    Write-Host ('UPDATE NOT COMPLETE: '+$message) -ForegroundColor Red
    exit 1
}
