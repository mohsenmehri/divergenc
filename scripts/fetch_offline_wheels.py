"""Fetch only hash-pinned Windows wheels for rebuilding the offline kit.
The Windows PREPARE-OFFLINE.cmd needs no Python; this is a repository build helper.
"""
from pathlib import Path
import hashlib
import json
import urllib.request
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'server/windows/offline-wheels.json').read_text())
directory=root/'server/windows/payload/wheels'
directory.mkdir(parents=True,exist_ok=True)
for spec in manifest['files']:
    assert Path(spec['file']).name==spec['file'] and '/' not in spec['file'] and '\\' not in spec['file']
    path=directory/spec['file']
    if not path.exists():
        assert spec['url'].startswith('https://files.pythonhosted.org/')
        data=urllib.request.urlopen(spec['url'],timeout=60).read()
        assert hashlib.sha256(data).hexdigest()==spec['sha256'],spec['file']
        path.write_bytes(data)
    assert hashlib.sha256(path.read_bytes()).hexdigest()==spec['sha256'],spec['file']
    print('Verified',spec['file'])
