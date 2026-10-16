"""Build Workspace without rewriting any earlier standalone release.
Grid supplies the tested record editor and original FAM engine; Workspace
reorganizes its real controls rather than supplying a disconnected mockup.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
s = (root / 'FAM-Grid.html').read_text()
s = s.replace('data-fam-variant="grid"', 'data-fam-variant="workspace"', 1)
s = s.replace('<title>فضای دادهٔ فام — ', '<title>فام Workspace — ', 1)
s = s.replace('\n</head>', '\n<style id="fam-workspace-css">\n' + (root / 'src/workspace-ui.css').read_text() + '\n</style>\n</head>', 1)
s = s.replace('\n</body>', '\n<script id="fam-workspace-js">\n' + (root / 'src/workspace-ui.js').read_text() + '\n</script>\n</body>', 1)
(root / 'FAM-Workspace.html').write_text(s)
print('Built FAM-Workspace.html; earlier releases preserved')
