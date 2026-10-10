"""Build the separate, standalone UI B from the unmodified UI-16 application.
Run after changing FAM.html, src/operations-ui.css, or src/operations-ui.js.
Business logic, account policy, storage keys and workbook formats are retained.
Only the B artifact skips startup of decorative FX; A is never written here.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
s = (root / 'FAM.html').read_text()
assert 'data-fam-ui="16"' in s
s = s.replace('data-fam-ui="16"', 'data-fam-ui="16" data-fam-variant="operations"', 1)
s = s.replace('<title>', '<title>میزکار عملیاتی — ', 1)
s = s.replace('FAM UI-16</b>', 'FAM UI-16 · B</b>', 1)
boot = '''  bindFxStrength();
  if (typeof bindFxTheme === "function") bindFxTheme();
  bindFloatingLayout();
  restoreSidebarState();
  startPhotonStage();'''
assert s.count(boot) == 1
s = s.replace(boot, '''  // UI B: no decorative Canvas loop is started. Operational behavior is shared.
  bindFloatingLayout();
  restoreSidebarState();''', 1)
css = (root / 'src/operations-ui.css').read_text()
js = (root / 'src/operations-ui.js').read_text()
assert s.count('\n</head>') == 1 and s.count('\n</body>') == 1
s = s.replace('\n</head>', '\n<style id="fam-operations-css">\n' + css + '</style>\n</head>', 1)
s = s.replace('\n</body>', '\n<script id="fam-operations-js">\n' + js + '</script>\n</body>', 1)
(root / 'FAM-Operations.html').write_text(s)
print('Built FAM-Operations.html; FAM.html unchanged')
