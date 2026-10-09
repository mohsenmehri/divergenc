"""Keep the standalone HTML's account module in sync with readable source files."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
p = root / 'FAM.html'
html = p.read_text()
for name, tag in [('css', 'style'), ('js', 'script')]:
    content = (root / f'src/local-access.{name}').read_text()
    block = f'<{tag} id="fam-local-access-{name}">\n{content}</{tag}>'
    pattern = rf'<{tag} id="fam-local-access-{name}">.*?</{tag}>'
    if re.search(pattern, html, re.S):
        html = re.sub(pattern, lambda m: block, html, flags=re.S)
    else:
        marker = '</head>' if name == 'css' else '</body>'
        html, count = re.subn('^' + marker + '$', lambda m: block + '\n' + marker, html, count=1, flags=re.M)
        assert count == 1
p.write_text(html)
