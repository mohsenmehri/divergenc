"""Embed account and provincial-record modules into the standalone HTML."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
p = root / 'FAM.html'
html = p.read_text()
html=re.sub(r'<(?:script|style) id="fam-equipment-local-preview-(?:js|css)">.*?</(?:script|style)>', '', html, flags=re.S)
for module, name, tag in [('local-access','css','style'), ('local-access','js','script'), ('province-records','js','script'), ('equipment-workspace','css','style'), ('equipment-inventory','js','script'), ('equipment-configuration','js','script'), ('equipment-tools-model','js','script'), ('equipment-excel','js','script'), ('equipment-tools','js','script'), ('equipment-tools','css','style'), ('equipment-workspace','js','script'), ('workspace-launcher','css','style'), ('workspace-launcher','js','script')]:
    content = (root / f'src/{module}.{name}').read_text()
    block = f'<{tag} id="fam-{module}-{name}">\n{content}</{tag}>'
    pattern = rf'<{tag} id="fam-{module}-{name}">.*?</{tag}>'
    if re.search(pattern, html, re.S):
        html = re.sub(pattern, lambda m: block, html, flags=re.S)
    else:
        marker = '</head>' if name == 'css' else '</body>'
        html, count = re.subn('^' + marker + '$', lambda m: block + '\n' + marker, html, count=1, flags=re.M)
        assert count == 1
p.write_text(html)
