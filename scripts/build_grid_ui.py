"""Build an independent data-first Grid workspace; never write the earlier UIs."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
s=(root/'FAM.html').read_text()
for name,tag in [('fam-ui-theme-css','style'),('fam-ui-theme-js','script'),('fam-operations-js','script')]:
    s,n=re.subn(rf'<{tag} id="{name}"[^>]*>.*?</{tag}>\n?', '', s, flags=re.S)
    assert n==1,name
s=s.replace('<style id="fam-operations-css" media="not all">','<style id="fam-operations-css">',1)
s=s.replace('data-default-theme="original"','data-default-theme="light" data-fam-variant="grid"',1)
s=s.replace('<title>','<title>فضای دادهٔ فام — ',1)
s=s.replace('FAM UI-16</b>','FAM Grid · 04</b>',1)
needle='  permissionObserver.observe(document.getElementById("layout"), {childList:true,subtree:true});'
assert s.count(needle)==1
s=s.replace(needle,needle+'\n  document.dispatchEvent(new Event("fam:grid-ready"));',1)
s=s.replace('\n</head>','\n<style id="fam-grid-css">\n'+(root/'src/grid-ui.css').read_text()+'</style>\n<script>window.FamTheme={current:()=>"light"};</script>\n</head>',1)
s=s.replace('\n</body>','\n<script id="fam-grid-js">\n'+(root/'src/grid-ui.js').read_text()+'</script>\n</body>',1)
(root/'FAM-Grid.html').write_text(s)
print('Built FAM-Grid.html; previous versions untouched')
