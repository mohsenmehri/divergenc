# FAM lab helper — تأیید SHA256 فایل ISO نسخهٔ Freemium 7.2.0-18
# این ابزار فقط برای آزمایشگاه است و هرگز در بستهٔ مشتری قرار نمی‌گیرد.
# اجرا در PowerShell ویندوز:
#   powershell -ExecutionPolicy Bypass -File .\verify_eve_iso.ps1 -Path "مسیر فایل.iso"
# اگر -Path ندهید، فایل‌های ISO پوشهٔ Downloads بررسی می‌شوند.

param(
    [string]$Path = ""
)

$expected = "47add8c261dfb5c3d53a01fb185fcd692f1132c66b79d267fe6d7f8452b52502"

if ($Path -eq "") {
    $candidates = @(Get-ChildItem -Path "$env:USERPROFILE\Downloads" -Filter *.iso -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($candidates.Count -eq 1) {
        $Path = $candidates[0].FullName
        Write-Host "فایل ISO در پوشهٔ Downloads پیدا شد:"
        Write-Host ("  " + $Path)
    }
    elseif ($candidates.Count -gt 1) {
        Write-Host "چند فایل ISO در Downloads است؛ مسیر دقیق را با -Path بدهید. فایل‌های موجود:"
        foreach ($item in $candidates) { Write-Host ("  " + $item.FullName) }
        exit 2
    }
    else {
        Write-Host "فایل ISO در Downloads پیدا نشد؛ مسیر فایل را با -Path بدهید."
        exit 2
    }
}

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host ("فایل وجود ندارد: " + $Path)
    exit 2
}

Write-Host "در حال محاسبهٔ SHA256 (چند لحظه صبر کنید) ..."
$actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
Write-Host ("SHA256 محاسبه‌شده : " + $actual)
Write-Host ("SHA256 مورد انتظار: " + $expected)

if ($actual -eq $expected) {
    Write-Host "تایید شد — فایل سالم است و همان نسخهٔ Freemium 7.2.0-18 است."
    exit 0
}
else {
    Write-Host "هشدار: فایل با هش مورد انتظار مطابقت ندارد! از آن استفاده نکنید و دوباره دانلود کنید."
    exit 1
}
