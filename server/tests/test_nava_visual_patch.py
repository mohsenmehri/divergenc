"""Safety checks for the reversible, presentation-only Nava visual test ZIP."""
from __future__ import annotations

import hashlib
from pathlib import Path
import unittest
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / "patches" / "fam-nava-ui-test"
RELEASE = ROOT / "releases" / "FAM-Nava-Visual-Test.zip"


class NavaVisualPatchChecks(unittest.TestCase):
    def test_patch_is_limited_to_a_verified_fam_html_replacement(self):
        payload = PATCH / "payload" / "FAM.html"
        manifest = (PATCH / "payload" / "SHA256SUMS.txt").read_text(encoding="ascii").strip()
        digest, name = manifest.split("  ", 1)
        self.assertEqual(name, "FAM.html")
        self.assertEqual(hashlib.sha256(payload.read_bytes()).hexdigest(), digest)

        html = payload.read_text(encoding="utf-8")
        self.assertIn('data-nava-visual-test="true"', html)
        self.assertIn('id="fam-nava-visual-test-css"', html)
        self.assertIn("FAM Nava visual test", html)
        # This must stay a test payload: the normal central client remains an
        # independent, unmodified release until a visual design is approved.
        self.assertNotIn('data-nava-visual-test="true"', (ROOT / "server" / "private_ui" / "FAM.html").read_text(encoding="utf-8"))

        apply_script = (PATCH / "APPLY-FAM-NAVA-VISUAL-TEST.ps1").read_text(encoding="utf-8")
        self.assertIn("Get-FileHash", apply_script)
        self.assertIn("nava-visual-test-backups", apply_script)
        self.assertIn("data-nava-visual-test", apply_script)
        self.assertNotIn("web.config", apply_script)
        self.assertNotIn("sqlite", apply_script.lower())
        self.assertNotIn("network_ops", apply_script)

    def test_release_is_complete_and_matches_the_verified_payload(self):
        expected = {
            "APPLY-FAM-NAVA-VISUAL-TEST.cmd",
            "APPLY-FAM-NAVA-VISUAL-TEST.ps1",
            "README_FA.txt",
            "ROLLBACK-LATEST-FAM-NAVA-VISUAL-TEST.cmd",
            "ROLLBACK-LATEST-FAM-NAVA-VISUAL-TEST.ps1",
            "payload/FAM.html",
            "payload/SHA256SUMS.txt",
        }
        with ZipFile(RELEASE) as archive:
            self.assertEqual(set(archive.namelist()), expected)
            manifest = archive.read("payload/SHA256SUMS.txt").decode("ascii").strip()
            digest, name = manifest.split("  ", 1)
            self.assertEqual(name, "FAM.html")
            self.assertEqual(hashlib.sha256(archive.read("payload/FAM.html")).hexdigest(), digest)
            self.assertNotIn("worker.json", "\n".join(archive.namelist()))
            self.assertNotIn(".dpapi", "\n".join(archive.namelist()))


if __name__ == "__main__":
    unittest.main()
