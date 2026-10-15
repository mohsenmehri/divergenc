"""Independent Studio UI: new navigation/workspace, unchanged data/access engine.
Keeps FAM.html and its two themes untouched. Output remains standalone.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
s=(root/'FAM.html').read_text()
for block,tag in [('fam-ui-theme-css','style'),('fam-ui-theme-js','script'),('fam-operations-js','script')]:
    s,n=re.subn(rf'<{tag} id="{block}"[^>]*>.*?</{tag}>\n?', '', s, flags=re.S)
    assert n==1,block
# Shared light widget styles remain for data tables/dialogs; the shell is redesigned.
s=s.replace('<style id="fam-operations-css" media="not all">','<style id="fam-operations-css">',1)
s=s.replace('data-default-theme="original"','data-default-theme="light" data-fam-variant="studio"',1)
s=s.replace('<title>','<title>استودیو شبکه — ',1)
s=s.replace('FAM UI-16</b>','FAM Studio · 03</b>',1)
head='<style id="fam-studio-css">\n'+(root/'src/studio-ui.css').read_text()+'</style>\n'
head+='<script>/* This workspace has no decorative Canvas animation. */\nwindow.FamTheme={current:()=>"light"};</script>\n'
s=s.replace('\n</head>','\n'+head+'</head>',1)
s=s.replace('\n</body>','\n<script id="fam-studio-js">\n'+(root/'src/studio-ui.js').read_text()+'</script>\n</body>',1)
(root/'FAM-Studio.html').write_text(s)
print('Built FAM-Studio.html; original dual-theme app unchanged')
