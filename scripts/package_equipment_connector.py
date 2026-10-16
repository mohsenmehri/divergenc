"""Build the user-mode, no-Administrator VDI Equipment Connector ZIP."""
from pathlib import Path
import hashlib
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "equipment_connector"
WHEELS = ROOT / "patches" / "fam-custom-access-server" / "wheels"
OUTPUT = ROOT / "releases" / "FAM-Equipment-Connector-Portable.zip"
STAMP = (2026, 10, 16, 0, 0, 0)

entries = {
    "START-FAM-EQUIPMENT-CONNECTOR.cmd": (SOURCE / "START-FAM-EQUIPMENT-CONNECTOR.cmd").read_bytes(),
    "connector.py": (SOURCE / "connector.py").read_bytes(),
    "equipment_probe.py": (ROOT / "server" / "equipment_probe.py").read_bytes(),
    "README_FA.txt": (SOURCE / "README_FA.txt").read_bytes(),
}
for wheel in sorted(WHEELS.glob("*.whl")):
    entries["wheels/" + wheel.name] = wheel.read_bytes()
entries["SHA256SUMS.txt"] = "".join(
    f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(entries.items())
).encode("utf-8")
OUTPUT.parent.mkdir(exist_ok=True)
with ZipFile(OUTPUT, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(entries.items()):
        info = ZipInfo(name, STAMP)
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
print(OUTPUT.relative_to(ROOT), OUTPUT.stat().st_size, hashlib.sha256(OUTPUT.read_bytes()).hexdigest())
