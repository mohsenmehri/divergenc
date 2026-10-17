"""Linux-executable helper tests. These are NOT Windows/IIS deployment tests."""
import json
import re
from pathlib import Path
import sqlite3
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest import mock
import xml.etree.ElementTree as ET
from werkzeug.serving import make_server, WSGIRequestHandler
from server.app import create_app
from server.windows.preflight_backup import backup
from server.windows.verify_deployment import probe

HOST='ertebatat-fam'
class QuietHandler(WSGIRequestHandler):
    def log_request(self,*args,**kwargs):pass

class BackupChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.db=self.root/'fam.sqlite3'
        bootstrap=mock.patch.dict(__import__('os').environ,{'FAM_INITIAL_PASSWORD':'Synthetic-bootstrap-password'});bootstrap.start();self.addCleanup(bootstrap.stop)
        create_app({'DB_PATH':str(self.db),'PUBLIC_ORIGIN':'https://'+HOST})
    def tearDown(self):self.temp.cleanup()
    def test_live_wal_and_accounts_preserved(self):
        with sqlite3.connect(self.db) as conn:
            conn.execute('PRAGMA journal_mode=WAL');conn.execute('PRAGMA wal_autocheckpoint=0')
            value=json.loads(conn.execute('SELECT payload FROM state').fetchone()[0])
            value['order']=['BackupCheck'];value['sheets']={'BackupCheck':{'rows':[['ID'],['LIVE WAL']],'merges':[]}}
            conn.execute('UPDATE state SET payload=?',(json.dumps(value),));conn.commit()
            self.assertTrue(Path(str(self.db)+'-wal').exists())
            users=conn.execute('SELECT * FROM users').fetchall()
            dest=self.root/'safe.sqlite3';backup(self.db,dest)
            with sqlite3.connect(dest) as restored:
                self.assertEqual(value,json.loads(restored.execute('SELECT payload FROM state').fetchone()[0]))
                self.assertEqual(users,restored.execute('SELECT * FROM users').fetchall())
            self.assertEqual(users,conn.execute('SELECT * FROM users').fetchall())
    def test_refuses_overwrite(self):
        dest=self.root/'backup.sqlite3';backup(self.db,dest);before=dest.read_bytes()
        with self.assertRaises(ValueError):backup(self.db,dest)
        self.assertEqual(before,dest.read_bytes())
    def test_rejects_non_fam_database(self):
        other=self.root/'other.sqlite3'
        with sqlite3.connect(other) as conn:conn.execute('CREATE TABLE state(id INTEGER)');conn.execute('INSERT INTO state VALUES(1)')
        dest=self.root/'rejected.sqlite3'
        with self.assertRaises(ValueError):backup(other,dest)
        self.assertFalse(dest.exists())

class HTTPSChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certs=tempfile.TemporaryDirectory();cls.certroot=Path(cls.certs.name)
        for name,san in [('correct',True),('unrelated',True),('cn-only',False)]:
            key=cls.certroot/(name+'.key');pem=cls.certroot/(name+'.pem')
            args=['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN='+HOST,'-keyout',str(key),'-out',str(pem),'-addext','basicConstraints=critical,CA:FALSE','-addext','extendedKeyUsage=serverAuth']
            if san:args+=['-addext','subjectAltName=DNS:'+HOST]
            subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            (cls.certroot/(name+'.cer')).write_bytes(ssl.PEM_cert_to_DER_cert(pem.read_text()))
    @classmethod
    def tearDownClass(cls):cls.certs.cleanup()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Path(self.temp.name)/'fam.sqlite3'
        bootstrap=mock.patch.dict(__import__('os').environ,{'FAM_INITIAL_PASSWORD':'Synthetic-bootstrap-password'});bootstrap.start();self.addCleanup(bootstrap.stop)
        self.app=create_app({'DB_PATH':str(self.db),'PUBLIC_ORIGIN':'https://'+HOST})
        self.start('correct')
    def start(self,name):
        self.server=make_server('127.0.0.1',0,self.app,ssl_context=(str(self.certroot/(name+'.pem')),str(self.certroot/(name+'.key'))),request_handler=QuietHandler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def stop(self):self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)
    def tearDown(self):self.stop();self.temp.cleanup()
    def test_valid_tls_and_real_api_without_account_changes(self):
        with sqlite3.connect(self.db) as db:
            before=db.execute('SELECT * FROM users').fetchall();state=db.execute('SELECT * FROM state').fetchall()
        result=probe(HOST,'127.0.0.1',self.certroot/'correct.cer',self.server.server_port)
        self.assertTrue(result['httpsApiVerified']);self.assertFalse(result['clientTrustVerified']);self.assertEqual(len(result['checks']),3)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(before,db.execute('SELECT * FROM users').fetchall());self.assertEqual(state,db.execute('SELECT * FROM state').fetchall())
            self.assertEqual(0,db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0])
    def test_wrong_hostname_rejected(self):
        with self.assertRaises(ssl.SSLCertVerificationError):probe('wrong-host','127.0.0.1',self.certroot/'correct.cer',self.server.server_port)
    def test_untrusted_certificate_rejected(self):
        with self.assertRaises(ssl.SSLCertVerificationError):probe(HOST,'127.0.0.1',self.certroot/'unrelated.cer',self.server.server_port)
    def test_common_name_without_san_rejected(self):
        self.stop();self.start('cn-only')
        with self.assertRaises(ssl.SSLCertVerificationError):probe(HOST,'127.0.0.1',self.certroot/'cn-only.cer',self.server.server_port)

class IISConfigurationCheck(unittest.TestCase):
    def test_api_errors_pass_through_instead_of_iis_html(self):
        root=ET.parse(Path(__file__).resolve().parents[1]/'www/web.config').getroot()
        self.assertEqual(root.find('./system.webServer/httpErrors').attrib['existingResponse'],'PassThrough')

    def test_fam_client_is_never_cached_or_exposed_as_an_iis_static_file(self):
        server_root=Path(__file__).resolve().parents[1]
        root=ET.parse(server_root/'www/web.config').getroot()
        server=root.find('./system.webServer')
        self.assertEqual(server.find('./defaultDocument/files/add').attrib['value'],'login.html')
        self.assertEqual(server.find('./staticContent/clientCache').attrib['cacheControlMode'],'DisableCache')
        headers={node.attrib['name']:node.attrib.get('value','') for node in server.findall('./httpProtocol/customHeaders/add')}
        self.assertEqual(headers['Cache-Control'],'no-store, no-cache, must-revalidate, max-age=0')
        self.assertEqual(headers['Pragma'],'no-cache')
        blocked={item.attrib['fileExtension'] for item in server.findall('./security/requestFiltering/fileExtensions/add')}
        self.assertTrue({'.py','.sqlite3','.xlsm','.xlsx','.ps1'}.issubset(blocked))
        rules=server.findall('./rewrite/rules/rule')
        protected=next(item for item in rules if item.attrib.get('name')=='Protected FAM application to loopback service')
        self.assertEqual(protected.find('match').attrib['url'],'^(?:app|FAM\.html)$')
        self.assertEqual(protected.find('action').attrib['url'],'http://127.0.0.1:8765/{R:0}')
        self.assertTrue((server_root/'private_ui'/'FAM.html').is_file())
        self.assertFalse((server_root/'www'/'FAM.html').exists())
        self.assertTrue((server_root/'www'/'login.html').is_file())
        self.assertEqual(headers['Expires'],'0')

    def test_equipment_management_is_a_private_main_fam_tab_not_a_standalone_iis_page(self):
        server_root=Path(__file__).resolve().parents[1]
        config=ET.parse(server_root/'www/web.config').getroot()
        rules=config.findall('./system.webServer/rewrite/rules/rule')
        self.assertFalse(any(item.attrib.get('name')=='Network Operations control page to loopback service' for item in rules))
        fam=(server_root/'private_ui'/'FAM.html').read_text(encoding='utf8')
        self.assertIn('data-view="equipment"',fam)
        self.assertIn('equipment/inspect',fam)
        self.assertIn('p.description',fam)
        self.assertNotIn('equipment-ack',fam)
        self.assertNotIn('network-operations',fam)

    def test_equipment_script_is_not_embedded_inside_the_sheetjs_script(self):
        """An inline <script> inside SheetJS becomes visible page text in browsers."""
        fam=(Path(__file__).resolve().parents[1]/'private_ui'/'FAM.html').read_text(encoding='utf8')
        tags=list(re.finditer(r'(?is)<script\b[^>]*>|</script\s*>',fam))
        inside=False;equipment_open=False
        for tag in tags:
            if tag.group(0).lower().startswith('</script'):
                self.assertTrue(inside, 'unexpected closing script tag')
                inside=False
            else:
                self.assertFalse(inside, 'a script tag is nested inside another script')
                inside=True
                equipment_open|='id="fam-equipment-management-js"' in tag.group(0)
        self.assertFalse(inside, 'unclosed script tag')
        self.assertTrue(equipment_open)

    def test_verified_iis_client_patch_targets_iis_physical_path_and_validates_payload(self):
        root=Path(__file__).resolve().parents[2]
        patch=root/'patches'/'fam-iis-verified-client-update'
        if not patch.is_dir(): self.skipTest('standalone verified IIS patch is not bundled inside the full offline archive')
        script=(patch/'APPLY-FAM-IIS-CLIENT-UPDATE.ps1').read_text(encoding='utf8')
        self.assertTrue((patch/'APPLY-FAM-IIS-CLIENT-UPDATE.cmd').is_file())
        self.assertIn('Get-Website',script)
        self.assertIn('Get-WebBinding',script)
        self.assertIn('bindingInformation',script)
        self.assertNotIn('.HostHeader',script)
        self.assertIn('physicalPath',script)
        self.assertIn('client-update-backups',script)
        self.assertIn('operation-primary-action',script)
        self.assertIn('manageCategorySections',script)
        self.assertIn('cacheControlMode="DisableCache"',script)
        self.assertIn('FAM-UI-17-IIS-20261013.1',script)
        entries={name:digest for digest,name in (line.split('  ',1) for line in (patch/'payload'/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines())}
        import hashlib
        for relative in ('FAM.html','web.config'):
            self.assertEqual(entries[relative],hashlib.sha256((patch/'payload'/relative).read_bytes()).hexdigest())


    def test_custom_access_server_patch_has_hashed_backend_and_client_payload(self):
        root=Path(__file__).resolve().parents[2]
        patch=root/'patches'/'fam-custom-access-server';payload=patch/'payload'
        self.assertTrue((patch/'APPLY-CUSTOM-ACCESS-UPDATE.cmd').is_file())
        script=(patch/'APPLY-CUSTOM-ACCESS-UPDATE.ps1').read_text(encoding='utf8')
        self.assertIn("'FAM-Central'",script)
        self.assertIn('SHA256SUMS.txt',script)
        self.assertIn('Restore-Backup',script)
        self.assertIn('Wait-Backend $true',script)
        self.assertIn("'private_ui\\FAM.html'",script)
        self.assertIn("'login.html'",script)
        self.assertIn("'equipment_ops.py'",script)
        self.assertIn("'equipment_probe.py'",script)
        self.assertIn("'start.ps1'",script)
        self.assertIn("No bootstrap/reset is allowed",script)
        self.assertIn('Test-OpenSshClient',script)
        self.assertIn("'System32\\OpenSSH\\ssh.exe'",script)
        self.assertIn('-Q cipher',script)
        self.assertIn("'aes128-cbc'",script)
        self.assertNotIn('pip install',script)
        self.assertNotIn('netmiko',script)
        self.assertLess(script.index('  Test-OpenSshClient\n'),script.index('foreach($Name in $ExpectedNames){Copy-Required'))
        self.assertFalse((patch/'WHEELS-SHA256SUMS.txt').exists())
        self.assertFalse((patch/'wheels').exists())
        self.assertIn("'web.config'",script)
        self.assertIn('Protect-PrivateUi',script)
        self.assertIn('Protect-Backup $Backup',script)
        self.assertIn('preflight_backup.py',script)
        self.assertIn('presence.json',script)
        self.assertIn('code-hashes.json',script)
        self.assertIn('if($RollbackBackup)',script)
        self.assertIn('Idempotent:',script)
        self.assertIn('Remove-IfPresent $LegacyHtml',script)
        self.assertIn('Installed file hash mismatch.',script)
        self.assertIn('categories TEXT', (payload/'app.py').read_text(encoding='utf8'))
        self.assertIn('const PERMISSION_GROUPS=',(payload/'FAM.html').read_text(encoding='utf8'))
        self.assertNotIn("id:'user-role'",(payload/'FAM.html').read_text(encoding='utf8'))
        self.assertIn('max-age=31536000',(payload/'web.config').read_text(encoding='utf8'))
        import hashlib
        entries={name:digest for digest,name in (line.split('  ',1) for line in (payload/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines())}
        self.assertEqual(set(entries),{'app.py','account_policy.py','equipment_guard.py','equipment_diagnostics.py','manage.py','bootstrap_admin.py','equipment_ops.py','equipment_inventory.py','equipment_probe.py','start.ps1','preflight_backup.py','install.ps1','setup-ertebatat.ps1','setup-common.psm1','backup-daily.ps1','verify_deployment.py','FAM.html','login.html','login.css','login.js','web.config'})
        for name,digest in entries.items():self.assertEqual(digest,hashlib.sha256((payload/name).read_bytes()).hexdigest())
        self.assertEqual((payload/'app.py').read_bytes(),(root/'server'/'app.py').read_bytes())
        self.assertEqual((payload/'equipment_ops.py').read_bytes(),(root/'server'/'equipment_ops.py').read_bytes())
        self.assertEqual((payload/'equipment_probe.py').read_bytes(),(root/'server'/'equipment_probe.py').read_bytes())
        self.assertEqual((payload/'start.ps1').read_bytes(),(root/'server'/'windows'/'start.ps1').read_bytes())
        self.assertIn("FAM_EQUIPMENT_OPS_ENABLED",(payload/'start.ps1').read_text(encoding='utf8'))
        self.assertIn("FAM_EQUIPMENT_PYTHON",(payload/'start.ps1').read_text(encoding='utf8'))
        self.assertIn("FAM_EQUIPMENT_CONNECTOR_ENABLED='0'",(payload/'start.ps1').read_text(encoding='utf8'))
        probe=(payload/'equipment_probe.py').read_text(encoding='utf8')
        self.assertIn('Ciphers=+aes128-cbc',probe);self.assertNotIn('netmiko',probe);self.assertNotIn('_preferred_ciphers',probe)
        release=root/'releases'/'FAM-Custom-Access-SERVER-Patch.zip'
        from zipfile import ZipFile
        with ZipFile(release) as archive:
            names=set(archive.namelist())
            self.assertEqual(names,{'APPLY-CUSTOM-ACCESS-UPDATE.cmd','APPLY-CUSTOM-ACCESS-UPDATE.ps1','README_FA.txt','CLIENT-MOVE-DIAGNOSIS-FA.txt','ROLLBACK-CUSTOM-ACCESS-UPDATE.ps1','ROLLBACK-CUSTOM-ACCESS-UPDATE.cmd','payload/SHA256SUMS.txt',*('payload/'+n for n in entries)})
            for name in entries:self.assertEqual(hashlib.sha256(archive.read('payload/'+name)).hexdigest(),entries[name])
            for name in names:
                self.assertFalse(name.endswith(('.whl','.pfx','.key','.pem','.sqlite3','.log')),name)
                self.assertNotIn('.venv',name);self.assertNotIn('private/',name)
        digest_line=(root/'releases'/'FAM-Custom-Access-SERVER-Patch.zip.sha256').read_text(encoding='utf8').strip()
        self.assertEqual(digest_line,hashlib.sha256(release.read_bytes()).hexdigest()+'  FAM-Custom-Access-SERVER-Patch.zip')
        self.assertEqual((payload/'FAM.html').read_bytes(),(root/'server'/'private_ui'/'FAM.html').read_bytes())
        for name in ('login.html','login.css','login.js','web.config'):
            self.assertEqual((payload/name).read_bytes(),(root/'server'/'www'/name).read_bytes())
        self.assertEqual((root/'patches'/'fam-custom-access-local'/'FAM.html').read_bytes(),(root/'FAM.html').read_bytes())

if __name__=='__main__':unittest.main()
