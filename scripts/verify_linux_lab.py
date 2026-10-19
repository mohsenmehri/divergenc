"""Verify the FAM-Linux-Lab ZIP: hash, manifest parity, guards and smoke tests."""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
ZIP = ROOT / "releases" / "FAM-Linux-Lab.zip"


def main() -> None:
    expected = (ZIP.with_suffix(ZIP.suffix + ".sha256")).read_text(encoding="utf8").split()[0]
    actual = hashlib.sha256(ZIP.read_bytes()).hexdigest()
    assert expected == actual, (expected, actual)
    print("zip sha256 ok", actual)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        with ZipFile(ZIP) as archive:
            names = sorted(archive.namelist())
            assert "FAM-Linux-Lab/MANIFEST.sha256" in names
            manifest = dict(
                (line.split("  ", 1)[1], line.split("  ", 1)[0])
                for line in archive.read("FAM-Linux-Lab/MANIFEST.sha256").decode().splitlines()
                if line.strip()
            )
            assert set(names) == {"FAM-Linux-Lab/MANIFEST.sha256", *manifest}, "manifest/file mismatch"
            for name, digest in manifest.items():
                assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
            # Forbidden artifacts must never ship.
            for name in names:
                low = name.lower()
                assert not low.endswith((".key", ".pem", ".crt", ".sqlite3", ".env", ".log")), name
                assert "/ssh-bundle/" not in low and "/certs/" not in low and "/data/" not in low, name
            archive.extractall(tmp_path)

        kit = tmp_path / "FAM-Linux-Lab"
        server = kit / "server"
        assert (server / "app.py").is_file() and (server / "equipment_probe.py").is_file()
        assert (kit / "Dockerfile").is_file() and (kit / "docker-compose.yml").is_file()
        assert (kit / "setup.sh").is_file() and (kit / "collect-ssh.sh").is_file()
        assert (kit / "README-FA.md").is_file()
        wheels = list((kit / "wheels").glob("*.whl"))
        assert len(wheels) >= 8, f"only {len(wheels)} wheels"

        for py in sorted(server.rglob("*.py")):
            compiled = subprocess.run(
                [sys.executable, "-m", "py_compile", str(py)],
                capture_output=True, text=True, timeout=60,
            )
            assert compiled.returncode == 0, (py, compiled.stderr)

        smoke = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, sys.argv[1]); import equipment_probe as p;"
             "assert p.ASKPASS_SOURCE and p.ASKPASS_SH_SOURCE;"
             "assert p.LEGACY_CIPHER_OPTION == 'Ciphers=+aes128-cbc';"
             "assert '3des-cbc' in p.FORBIDDEN_CIPHERS;"
             "print('probe import ok')", str(server)],
            capture_output=True, text=True, timeout=60, env=os.environ.copy(),
        )
        assert smoke.returncode == 0 and "probe import ok" in smoke.stdout, smoke.stderr

    print(f"PASS: {len(manifest)} shipped files, hashes, guards and extracted probe smoke.")


if __name__ == "__main__":
    main()
