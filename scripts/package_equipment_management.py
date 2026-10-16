"""Build the direct Equipment Management deployment ZIP (no Worker package)."""
from pathlib import Path
import hashlib
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
patch = ROOT / "releases" / "FAM-Custom-Access-SERVER-Patch.zip"
connector = ROOT / "releases" / "FAM-Equipment-Connector-Portable.zip"
preview = ROOT / "releases" / "FAM-Equipment-Management-LOCAL-PREVIEW.html"
entries = {
    "FAM-Custom-Access-SERVER-Patch.zip": patch.read_bytes(),
    "FAM-Equipment-Connector-Portable.zip": connector.read_bytes(),
    "FAM-Equipment-Management-LOCAL-PREVIEW.html": preview.read_bytes(),
    "START-HERE_FA.txt": """بستهٔ مدیریت تجهیزات FAM

این بسته صفحهٔ مستقل عملیات شبکه، Worker Token و Pairing را ندارد. ابتدا Patch را روی سرور مرکزی اعمال کنید. سپس روی VDI دارای دسترسی SSH، ZIP به نام FAM-Equipment-Connector-Portable.zip را Extract و START-FAM-EQUIPMENT-CONNECTOR.cmd را بدون نیاز به Administrator اجرا کنید. کاربر مجاز در تب «تجهیزات» داخل FAM، IP خصوصی تجهیز و credential موقت SSH/RADIUS را وارد می‌کند.

Connector فقط از VDI به FAM اتصال HTTPS خروجی دارد؛ پورت ورودی، Windows Service، Token یا Pairing لازم نیست. Netmiko و وابستگی‌ها فقط در venv کاربر VDI نصب می‌شوند. Scheduled Task قدیمی FAM-NetworkWorker غیرفعال می‌شود.

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
