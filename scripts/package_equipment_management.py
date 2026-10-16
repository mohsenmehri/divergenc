"""Build the direct Equipment Management deployment ZIP (no Worker package)."""
from pathlib import Path
import hashlib
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
patch = ROOT / "releases" / "FAM-Custom-Access-SERVER-Patch.zip"
preview = ROOT / "releases" / "FAM-Equipment-Management-LOCAL-PREVIEW.html"
entries = {
    "FAM-Custom-Access-SERVER-Patch.zip": patch.read_bytes(),
    "FAM-Equipment-Management-LOCAL-PREVIEW.html": preview.read_bytes(),
    "START-HERE_FA.txt": """بستهٔ مدیریت تجهیزات FAM

این بسته صفحهٔ مستقل عملیات شبکه، Worker Token و Pairing را ندارد. Patch را روی سرور مرکزی اعمال کنید؛ سپس کاربر مجاز در تب «تجهیزات» داخل خود FAM، IP خصوصی تجهیز و credential موقت SSH/RADIUS را وارد می‌کند.

Patch، Netmiko و وابستگی‌های آن را از wheelهای همراه و hash-verified داخل venv خود FAM نصب می‌کند. Scheduled Task قدیمی FAM-NetworkWorker غیرفعال می‌شود؛ برای اجرای مستقیم هیچ venv یا سرویس Worker لازم نیست.

فایل HTML همراه صرفاً پیش‌نمایش محلی UI است و هیچ اتصال واقعی ایجاد نمی‌کند.
""".encode("utf-8"),
}
entries["SHA256SUMS.txt"] = "".join(
    f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(entries.items())
).encode("utf-8")
output = ROOT / "releases" / "FAM-Equipment-Management-Deployment.zip"
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(entries.items()):
        info = ZipInfo(name, (2026, 10, 16, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
print(output.relative_to(ROOT), output.stat().st_size, hashlib.sha256(output.read_bytes()).hexdigest())
