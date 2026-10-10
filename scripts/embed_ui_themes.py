"""Embed both themes in the main standalone FAM.html. Safe to run repeatedly."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
p = root / 'FAM.html'
s = p.read_text()
for name, ext, tag, marker, attrs in [
    ('operations-ui', 'css', 'style', '</head>', ' media="not all"'),
    ('ui-theme', 'css', 'style', '</head>', ''),
    ('ui-theme', 'js', 'script', '</head>', ''),
    ('operations-ui', 'js', 'script', '</body>', ''),
]:
    block_id = 'fam-operations-' + ext if name == 'operations-ui' else 'fam-ui-theme-' + ext
    content = (root / f'src/{name}.{ext}').read_text()
    block = f'<{tag} id="{block_id}"{attrs}>\n{content}</{tag}>'
    pattern = rf'<{tag} id="{block_id}"[^>]*>.*?</{tag}>'
    if re.search(pattern, s, re.S):
        s = re.sub(pattern, lambda _: block, s, flags=re.S)
    else:
        assert s.count('\n' + marker) == 1
        s = s.replace('\n' + marker, '\n' + block + '\n' + marker, 1)
p.write_text(s)
print('Embedded original + light theme in FAM.html')
