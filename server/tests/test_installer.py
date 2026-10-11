"""Linux-executable helper tests. These are NOT Windows/IIS deployment tests."""
import json
from pathlib import Path
import sqlite3
import ssl
import subprocess
import tempfile
import threading
import unittest
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

if __name__=='__main__':unittest.main()
