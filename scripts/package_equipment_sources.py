"""Export current SSH source and a separate native-Ansible implementation."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib
ROOT=Path(__file__).resolve().parents[1]
STAMP=(2026,10,17,0,0,0)

def package(name,files):
    output=ROOT/'releases'/name
    with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as archive:
        for target,source in sorted(files.items()):
            assert not set(Path(target).parts)&{'__pycache__','.venv','node_modules','.cache'}
            assert not Path(target).suffix.lower() in {'.pyc','.pem','.key','.pfx','.sqlite3','.log'}
            info=ZipInfo(target,STAMP);info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            archive.writestr(info,source.read_bytes())
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {name}\n')
    print(name,output.stat().st_size,digest)

sources=['server/equipment_probe.py','server/equipment_ops.py','src/equipment-live-server.js']
package('FAM-Equipment-SSH-Python-Source.zip',{
    **{name:ROOT/name for name in sources},'README_FA.md':ROOT/'exports/equipment-python/README_FA.md'})
base=ROOT/'exports/equipment-ansible'
manifest=[
    'README_FA.md','ansible.cfg','inspect.yml','recover.yml','inventory.ini',
    'requirements.txt','requirements.yml','ssh_config','tasks/prepare.yml',
    'tasks/recover_port.yml','filter_plugins/fam_equipment.py',
    'callback_plugins/fam_safe.py','cliconf_plugins/fam_ios.py','terminal_plugins/fam_ios.py',
]
# Closed source-only manifest: never sweep controller runtime or local secrets.
files={name:base/name for name in manifest}
package('FAM-Equipment-SSH-Ansible-Source.zip',files)
