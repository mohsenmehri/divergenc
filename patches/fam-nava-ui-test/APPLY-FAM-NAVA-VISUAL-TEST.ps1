#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
Applies the reversible Nava-inspired visual test to the public FAM client
only. It discovers the correct IIS site by HTTPS binding and never touches
FAM's database, API, users, worker, certificate, DNS or IIS configuration.
#>
[CmdletBinding()]
param(
    [string]$HostName='ertebatat-fam',
    [string]$SiteName=''
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$PatchRoot=Split-Path -Parent $PSCommandPath
$Payload=Join-Path $PatchRoot 'payload'
$SourceHtml=Join-Path $Payload 'FAM.html'
$Manifest=Join-Path $Payload 'SHA256SUMS.txt'
$Backup=$null
$TargetHtml=$null
$Site=$null
$Copied=$false
$WasStarted=$false

function Assert-File([string]$Path,[string]$Message) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw $Message }
}
function Get-PayloadHash([string]$RelativePath) {
    $line=@(Get-Content -LiteralPath $Manifest | Where-Object { $_ -match ('\s'+[regex]::Escape($RelativePath)+'$') })
    if ($line.Count -ne 1) { throw "Payload manifest has no unique checksum for $RelativePath." }
    return (($line[0] -split '\s+')[0]).ToLowerInvariant()
}
function Assert-Payload([string]$Path,[string]$RelativePath) {
    Assert-File $Path "Required visual-test payload is missing: $RelativePath"
    $actual=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne (Get-PayloadHash $RelativePath)) { throw "Visual-test payload checksum failed: $RelativePath. Extract the ZIP again and do not continue." }
}
function Get-IISBindingHost([object]$Binding) {
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
        if (@($bindings | Where-Object { (Get-IISBindingHost $_).ToLowerInvariant() -eq $HostName.Trim().ToLowerInvariant() }).Count) { $matches+=$candidate }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    if ($matches.Count -gt 1) { throw "More than one IIS site has the HTTPS host binding '$HostName'. No file was changed." }
    $fallback=Get-Website -Name 'FAM-Ertebatat' -ErrorAction SilentlyContinue
    if ($fallback -and (Test-Path -LiteralPath (Join-Path $fallback.physicalPath 'FAM.html') -PathType Leaf)) { return $fallback }
    throw "No IIS site with HTTPS host '$HostName' was found, and FAM-Ertebatat fallback is unavailable. No file was changed."
}
function Restart-TargetSite {
    if (!$script:WasStarted) { return }
    Stop-Website -Name $script:Site.Name
    Start-Website -Name $script:Site.Name
}
function Verify-Deployment {
    $actual=(Get-FileHash -LiteralPath $TargetHtml -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne (Get-PayloadHash 'FAM.html')) { throw 'The deployed FAM.html checksum does not match the verified visual-test payload.' }
    foreach ($marker in @('data-nava-visual-test="true"','id="fam-nava-visual-test-css"','FAM Nava visual test')) {
        if (!(Select-String -LiteralPath $TargetHtml -SimpleMatch -Quiet -Pattern $marker)) { throw "Visual-test verification failed: missing '$marker'." }
    }
}

try {
    Import-Module WebAdministration -ErrorAction Stop
    Assert-File $Manifest 'Visual-test checksum manifest is missing.'
    Assert-Payload $SourceHtml 'FAM.html'
    $Site=Get-ConfiguredSite
    $WebRoot=[Environment]::ExpandEnvironmentVariables([string]$Site.physicalPath).TrimEnd([char]'\')
    $TargetHtml=Join-Path $WebRoot 'FAM.html'
    Assert-File $TargetHtml "The IIS physical path '$WebRoot' does not contain FAM.html. No file was changed."

    $BackupRoot=Join-Path (Join-Path $env:ProgramData 'FAM') 'nava-visual-test-backups'
    $Backup=Join-Path $BackupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Copy-Item -LiteralPath $TargetHtml -Destination (Join-Path $Backup 'FAM.html') -Force

    $WasStarted=($Site.State -eq 'Started')
    $Copied=$true
    Copy-Item -LiteralPath $SourceHtml -Destination $TargetHtml -Force
    Restart-TargetSite
    Verify-Deployment

    $result=@(
        'FAM NAVA VISUAL TEST: SUCCESS',
        'This is a presentation-only test. FAM functions, data, accounts and APIs were not changed.',
        'IIS site: '+$Site.Name,
        'HTTPS host: '+$HostName,
        'Actual IIS physical path: '+$WebRoot,
        'FAM.html SHA-256: '+(Get-FileHash -LiteralPath $TargetHtml -Algorithm SHA256).Hash,
        'Rollback copy: '+(Join-Path $Backup 'FAM.html')
    )
    $result | Set-Content -LiteralPath (Join-Path $Backup 'RESULT.txt') -Encoding UTF8
    $result | ForEach-Object { Write-Host $_ -ForegroundColor Green }
    exit 0
} catch {
    $message=$_.Exception.Message
    if ($Copied -and $Backup -and $TargetHtml) {
        try {
            Copy-Item -LiteralPath (Join-Path $Backup 'FAM.html') -Destination $TargetHtml -Force
            Restart-TargetSite
            Write-Warning 'The prior FAM.html was restored automatically from the backup.'
        } catch { Write-Warning 'Automatic rollback failed. Restore FAM.html from: '+$Backup }
    }
    Write-Host ('NAVA VISUAL TEST NOT COMPLETE: '+$message) -ForegroundColor Red
    exit 1
}
