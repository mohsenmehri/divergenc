#!/usr/bin/env python3
"""
Assemble the single-file deliverable Mohsen_FINAL_v5.html from the layered
sources in this directory. Pure Python stdlib — no dependencies.

Layers (see README.md):
  data.js    -> APP_SHELL + VBA module sources   (LAYER: DATA)
  core.js    -> workbook model + transactions    (LAYER: CORE)
  storage.js -> localStorage persistence         (LAYER: STORAGE)
  macros.js  -> VBA macro ports                  (LAYER: MACROS)
  ui.js      -> rendering + import/export + boot (LAYER: UI)
  vendor/xlsx.full.min.js -> SheetJS (embedded, offline)

Usage:  python3 src/build.py
Output: Mohsen_FINAL_v5.html  (repo root)
"""
import os

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(D)

def rd(*parts):
    with open(os.path.join(D, *parts), encoding="utf-8") as f:
        return f.read()

BLOCKS = [
    ("DATA",    "data.js"),
    ("XLSX",    "vendor", "xlsx.full.min.js"),
    ("CORE",    "core.js"),
    ("STORAGE", "storage.js"),
    ("MACROS",  "macros.js"),
    ("UI",      "ui.js"),
]

def main():
    head = rd("layout_head.html")
    body = rd("layout_body.html")
    scripts = "".join(
        "<script>\n/*__%s__*/\n%s\n</script>\n" % (key, rd(*parts))
        for key, *parts in [(b[0], *b[1:]) for b in BLOCKS]
    )
    idx = body.rfind("</body>")
    assert idx > 0, "layout_body.html must contain </body>"
    html = head + body[:idx].rstrip() + "\n" + scripts + body[idx:]
    out = os.path.join(ROOT, "Mohsen_FINAL_v5.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("WROTE %s  %.2f MB  %d blocks" % (out, len(html) / 1024 / 1024, len(BLOCKS)))

if __name__ == "__main__":
    main()
