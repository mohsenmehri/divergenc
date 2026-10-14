"""Checks for the server-free local Nava visual preview delivery."""
from __future__ import annotations

from pathlib import Path
import unittest
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / "releases" / "FAM-Nava-Local-Preview.zip"


class NavaLocalPreviewChecks(unittest.TestCase):
    def test_preview_is_a_small_server_free_three_file_archive(self):
        with ZipFile(PREVIEW) as archive:
            self.assertEqual(set(archive.namelist()), {
                "FAM-Nava-Visual-Preview.html",
                "OPEN-FAM-NAVA-PREVIEW.cmd",
                "README_FA.txt",
            })
            html = archive.read("FAM-Nava-Visual-Preview.html").decode("utf-8")
        self.assertIn("پیش‌نمایش کامل ظاهری نوا", html)
        self.assertIn("بدون ارتباط با سرور", html)
        self.assertIn('id="sidebar-toggle"', html)
        self.assertIn("پنهان یا آشکار کردن منو", html)
        self.assertIn('class="nav-group open"', html)
        for view in ("dashboard", "search", "sections", "add", "history", "users", "settings"):
            self.assertIn(f'id="view-{view}"', html)
        self.assertNotIn("fetch(", html)
        self.assertNotIn("XMLHttpRequest", html)
        self.assertNotIn("WebSocket", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("http://", html)
        self.assertNotIn("/network-operations", html)


if __name__ == "__main__":
    unittest.main()
