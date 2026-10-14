#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$HostName='ertebatat-fam',
    [string]$SiteName=''
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Get-IISBindingHost([object]$Binding) {
    $info=[string]$Binding.bindingInformation
    $separator=$info.LastIndexOf(':')
    if ($separator -lt 0) { return '' }
    return $info.Substring($separator+1).Trim()
}
function Get-ConfiguredSite {
    if ($SiteName) {
        $selected=Get-Website -Name $SiteName -ErrorAction SilentlyContinue
        if (!$selected) { throw "IIS site '$SiteName' was not found." }
        return $selected
    }
    $matches=@()
    foreach ($candidate in @(Get-Website)) {
        $bindings=@(Get-WebBinding -Name $candidate.Name -Protocol https -ErrorAction SilentlyContinue)
        if (@($bindings | Where-Object { (Get-IISBindingHost $_).ToLowerInvariant() -eq $HostName.Trim().ToLowerInvariant() }).Count) { $matches+=$candidate }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    $fallback=Get-Website -Name 'FAM-Ertebatat' -ErrorAction SilentlyContinue
    if ($fallback -and (Test-Path -LiteralPath (Join-Path $fallback.physicalPath 'FAM.html') -PathType Leaf)) { return $fallback }
    throw "No unambiguous IIS site for HTTPS host '$HostName' was found."
}

try {
    Import-Module WebAdministration -ErrorAction Stop
    $Site=Get-ConfiguredSite
    $WebRoot=[Environment]::ExpandEnvironmentVariables([string]$Site.physicalPath).TrimEnd([char]'\')
    $Target=Join-Path $WebRoot 'FAM.html'
    if (!(Test-Path -LiteralPath $Target -PathType Leaf)) { throw "The IIS physical path '$WebRoot' does not contain FAM.html." }
    $BackupRoot=Join-Path (Join-Path $env:ProgramData 'FAM') 'nava-visual-test-backups'
    $Latest=@(Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction Stop | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
    if ($Latest.Count -ne 1) { throw "No Nava visual-test backup was found in '$BackupRoot'." }
    $Source=Join-Path $Latest[0].FullName 'FAM.html'
    if (!(Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Latest backup is missing FAM.html: $($Latest[0].FullName)" }
    $WasStarted=($Site.State -eq 'Started')
    Copy-Item -LiteralPath $Source -Destination $Target -Force
    if ($WasStarted) { Stop-Website -Name $Site.Name; Start-Website -Name $Site.Name }
    $sourceHash=(Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    $targetHash=(Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash
    if ($sourceHash -ne $targetHash) { throw 'Rollback hash verification failed.' }
    Write-Host 'FAM NAVA VISUAL TEST: ROLLED BACK' -ForegroundColor Green
    Write-Host ('Restored from: '+$Latest[0].FullName) -ForegroundColor Green
    exit 0
} catch {
    Write-Host ('NAVA VISUAL ROLLBACK NOT COMPLETE: '+$_.Exception.Message) -ForegroundColor Red
    exit 1
}
