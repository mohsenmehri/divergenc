# FAM lab helper - verify the EVE-NG Freemium 7.2.0-18 ISO SHA256 before install.
# ASCII-only on purpose: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI
# and breaks on non-ASCII text. Keep this file plain ASCII. Lab-only tool;
# never shipped to customers.
#
# Run in Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\verify_eve_iso.ps1
#   powershell -ExecutionPolicy Bypass -File .\verify_eve_iso.ps1 -Path "C:\path\to\eve.iso"
# If -Path is omitted, the single .iso file in Downloads is checked.

param(
    [string]$Path = ""
)

$expected = "47add8c261dfb5c3d53a01fb185fcd692f1132c66b79d267fe6d7f8452b52502"

if ($Path -eq "") {
    $candidates = @(Get-ChildItem -Path "$env:USERPROFILE\Downloads" -Filter *.iso -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($candidates.Count -eq 1) {
        $Path = $candidates[0].FullName
        Write-Host "ISO file found in Downloads:"
        Write-Host ("  " + $Path)
    }
    elseif ($candidates.Count -gt 1) {
        Write-Host "More than one ISO in Downloads. Pass the exact file with -Path. Files found:"
        foreach ($item in $candidates) { Write-Host ("  " + $item.FullName) }
        exit 2
    }
    else {
        Write-Host "No ISO file found in Downloads. Pass the file path with -Path."
        exit 2
    }
}

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host ("File not found: " + $Path)
    exit 2
}

Write-Host "Computing SHA256 (please wait) ..."
$actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
Write-Host ("SHA256 computed : " + $actual)
Write-Host ("SHA256 expected : " + $expected)

if ($actual -eq $expected) {
    Write-Host "OK - the file is valid and it is Freemium 7.2.0-18."
    exit 0
}
else {
    Write-Host "WARNING: hash mismatch! Do not use this file. Download it again."
    exit 1
}
