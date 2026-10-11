"""Build the independent Nexus command centre without writing earlier releases."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
s = (root/'FAM-Grid.html').read_text()
s = s.replace('data-fam-variant="grid"', 'data-fam-variant="nexus"', 1)
s = s.replace('<title>فضای دادهٔ فام — ', '<title>فام Nexus — ', 1)
s = s.replace('\n</head>', '\n<style id="fam-nexus-css">\n'+(root/'src/nexus-ui.css').read_text()+'\n</style>\n</head>', 1)
s = s.replace('\n</body>', '\n<script id="fam-nexus-js">\n'+(root/'src/nexus-ui.js').read_text()+'\n</script>\n</body>', 1)
(root/'FAM-Nexus.html').write_text(s)
print('Built FAM-Nexus.html; previous releases unchanged')
