"""Compatibility preview: the same dual-theme app, defaulting to light on a new origin.
The main deliverable is now FAM.html with both themes. Run embed_ui_themes.py first.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
s = (root / 'FAM.html').read_text()
assert 'id="fam-ui-theme-js"' in s
assert s.count('data-default-theme="original"') == 1
s = s.replace('data-default-theme="original"', 'data-default-theme="light" data-fam-variant="operations"', 1)
s = s.replace('<title>', '<title>میزکار عملیاتی — ', 1)
(root / 'FAM-Operations.html').write_text(s)
print('Built compatibility light-default preview; both themes remain available')
