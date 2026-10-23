"""Build the reproducible offline FAM-Linux-Lab ZIP for the Ubuntu lab VM.

The kit carries the reviewed server source, the Linux deployment files and
the pinned Python wheels needed for an offline install.  It must never carry
runtime secrets, databases, certificates, keys, logs, a virtual environment,
an ssh binary bundle, or any known_hosts file.  Those are created on the lab
VM itself by setup.sh.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
STAMP = (2026, 10, 19, 0, 0, 0)

FORBIDDEN_SUFFIXES = {
    ".pfx", ".p12", ".pem", ".key", ".crt", ".csr",
    ".sqlite3", ".sqlite3-wal", ".sqlite3-shm",
    ".log", ".pyc", ".env",
}
FORBIDDEN_PARTS = {
    ".venv", "venv", "private", "__pycache__", "node_modules",
    "settings.json", "known_hosts", "ssh-bundle", "certs", "data",
}
SECRET_MARKERS = (
    re.compile(r"BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY"),
    re.compile(r"Transport\._preferred_ciphers"),
    re.compile(r"StrictHostKeyChecking=no\b"),
    re.compile(r"Ciphers=[^\s\"']*(3des-cbc|aes192-cbc|aes256-cbc)"),
    re.compile(r"FAM_INITIAL_PASSWORD\s*=\s*['\"][^'\"]+['\"]"),
)

# The reviewed server runtime (same source family as the Windows SERVER patch).
SERVER_FILES = (
    "app.py",
    "account_policy.py",
    "equipment_guard.py",
    "equipment_diagnostics.py",
    "equipment_replacement.py",
    "equipment_group.py",
    "equipment_ops.py",
    "equipment_inventory.py",
    "equipment_probe.py",
    "manage.py",
    "bootstrap_admin.py",
    "requirements.txt",
    "private_ui/FAM.html",
    "www/login.html",
    "www/login.css",
    "www/login.js",
)
DEPLOY_FILES = (
    "Dockerfile",
    "docker-compose.yml",
    "nginx.conf",
    "gen_cert.py",
    "collect-ssh.sh",
    "setup.sh",
)


def guard(name: str, data: bytes) -> None:
    path = Path(name)
    if path.suffix.lower() in FORBIDDEN_SUFFIXES or set(path.parts) & FORBIDDEN_PARTS:
        raise SystemExit(f"Refusing to package {name}: forbidden artifact type")
    if path.suffix.lower() in {".py", ".sh", ".yml", ".conf", ".md", ".txt"}:
        text = data.decode("utf8", errors="ignore")
        for marker in SECRET_MARKERS:
            if marker.search(text):
                raise SystemExit(f"Refusing to package {name}: matches {marker.pattern!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT / "releases" / "FAM-Linux-Lab.zip"))
    args = parser.parse_args()

    entries: list[tuple[str, Path]] = []
    for name in SERVER_FILES:
        entries.append((f"FAM-Linux-Lab/server/{name}", ROOT / "server" / name))
    for name in DEPLOY_FILES:
        entries.append((f"FAM-Linux-Lab/{name}", ROOT / "deploy" / "linux" / name))
    entries.append((f"FAM-Linux-Lab/README-FA.md", ROOT / "docs" / "LINUX_LAB_FA.md"))

    wheels_dir = ROOT / "deploy" / "linux" / "wheels"
    wheels = sorted(wheels_dir.glob("*.whl"))
    if not wheels:
        raise SystemExit(f"No wheels found in {wheels_dir}; run the wheel download first.")
    for wheel in wheels:
        entries.append((f"FAM-Linux-Lab/wheels/{wheel.name}", wheel))

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest: list[str] = []
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in entries:
            if not source.is_file():
                raise SystemExit(f"Missing source file: {source}")
            data = source.read_bytes()
            guard(name, data)
            info = ZipInfo(name, STAMP)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
            manifest.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
        listing = "\n".join(sorted(manifest)) + "\n"
        info = ZipInfo("FAM-Linux-Lab/MANIFEST.sha256", STAMP)
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, listing.encode("utf8"))

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + ".sha256").write_text(f"{digest}  {output.name}\n", encoding="utf8")
    print(output.relative_to(ROOT), output.stat().st_size, "bytes", digest)


if __name__ == "__main__":
    main()
