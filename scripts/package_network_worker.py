"""Build the separately deployable, credential-free Network Worker ZIP."""
from pathlib import Path
import hashlib
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


root = Path(__file__).resolve().parents[1]
worker = root / "network_worker"
files = [
    *sorted(worker.glob("*.py")),
    worker / "requirements.txt",
    worker / "worker.example.json",
    worker / ".gitignore",
    worker / "README_FA.md",
    root / "docs" / "NETWORK_OPERATIONS_PHASE1_FA.md",
]
entries = {path.relative_to(root).as_posix(): path.read_bytes() for path in files}
# This archive must remain safe to share: no local worker.json, DPAPI blob,
# token, endpoint inventory, raw config, or environment export is allow-listed.
assert all(".dpapi" not in name and not name.endswith("worker.json") for name in entries)
entries["START_HERE.txt"] = (
    "FAM Network Worker — Phase 1\n\n"
    "This is a Cisco IOS Worker. It may be co-hosted with FAM only under a "
    "Windows service identity different from IIS/FAM and outside the IIS path. "
    "It supports browser-encrypted Err-disabled checks and one pre-checked, "
    "human-approved port recovery. Start with docs/NETWORK_OPERATIONS_PHASE1_FA.md. "
    "This ZIP contains no credential, token, device address, or raw device configuration.\n"
).encode("utf-8")
entries["SHA256SUMS.txt"] = "".join(
    hashlib.sha256(data).hexdigest() + "  " + name + "\n" for name, data in sorted(entries.items())
).encode("utf-8")
output = root / "releases" / "FAM-Network-Worker-Phase1.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(entries.items()):
        info = ZipInfo(name, (2026, 10, 14, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compresslevel=9)
print(output.relative_to(root), output.stat().st_size, "bytes", hashlib.sha256(output.read_bytes()).hexdigest())
