"""Regression coverage for the production security-hardening release."""
import re
import sqlite3
import unittest
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

from server.app import CLIENT_TRANSIENT, EPHEMERAL, META, Problem, public_user, validate_state

ROOT=Path(__file__).resolve().parents[2]
SERVER=ROOT/'server'
WINDOWS=SERVER/'windows'
WWW=SERVER/'www'


class HSTSChecks(unittest.TestCase):
    def test_hsts_is_one_year_without_intranet_unsafe_directives(self):
        tree=ET.parse(WWW/'web.config')
        headers=tree.findall('./system.webServer/httpProtocol/customHeaders/add')
        hsts=next(header for header in headers if header.get('name')=='Strict-Transport-Security')
        value=hsts.get('value','').lower()
        self.assertEqual(value,'max-age=31536000')
        self.assertNotIn('includesubdomains',value)
        self.assertNotIn('preload',value)


class UserJsonChecks(unittest.TestCase):
    def make_row(self,regions='["1"]',sheets='[]',categories=None,permissions=None):
        connection=sqlite3.connect(':memory:');connection.row_factory=sqlite3.Row
        connection.execute('CREATE TABLE users(id,username,name,role,enabled,revision,regions,sheets,categories,permissions)')
        connection.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?)',
          (str(uuid.uuid4()),'operator','Operator',4,1,str(uuid.uuid4()),regions,sheets,categories,permissions))
        return connection.execute('SELECT * FROM users').fetchone()

    def test_valid_user_json_is_public_and_never_leaks_credentials(self):
        user=public_user(self.make_row(categories='["other"]',permissions='["view-sheets"]'))
        self.assertEqual(user['regions'],['1']);self.assertEqual(user['categories'],['other'])
        self.assertNotIn('salt',user);self.assertNotIn('hash',user)

    def test_malformed_or_non_list_user_json_fails_closed(self):
        for columns in ({'regions':'not-json'},{'sheets':'{}'},
                        {'categories':'not-json','permissions':'[]'},
                        {'categories':'[]','permissions':'"view-sheets"'}):
            with self.subTest(columns=columns):
                with self.assertLogs('server.app',level='ERROR'):
                    with self.assertRaises(Problem) as caught:
                        public_user(self.make_row(**columns))
                self.assertEqual(caught.exception.status,500)
                self.assertNotIn('not-json',caught.exception.message)


class StateSystemSheetChecks(unittest.TestCase):
    @staticmethod
    def state(name):
        return {'v':2,'order':[name],'sheets':{name:{'rows':[['header']],'merges':[]}},
          'lockedSheets':{},'categoryConfig':None,'regionConfig':None,'panelProtected':True}

    def test_every_unpublished_non_meta_system_name_is_rejected(self):
        for name in EPHEMERAL-CLIENT_TRANSIENT:
            with self.subTest(name=name):
                with self.assertRaises(Problem) as caught:validate_state(self.state(name))
                self.assertEqual(caught.exception.status,400)

    def test_persisted_meta_and_returned_display_log_remain_compatible(self):
        for name in META|CLIENT_TRANSIENT:
            with self.subTest(name=name):
                result=validate_state(self.state(name))
                self.assertEqual(result['order'],[] if name in CLIENT_TRANSIENT else [name])


class InstallerHardeningChecks(unittest.TestCase):
    def test_deployment_copy_uses_explicit_allowlist(self):
        setup=(WINDOWS/'setup-ertebatat.ps1').read_text(encoding='utf8')
        self.assertNotIn("Get-ChildItem $SourceServer -File -Filter '*.py'",setup)
        for name in ('app.py','manage.py','requirements.txt','install.ps1','start.ps1','backup-daily.ps1','setup-common.psm1','FAM.html','web.config'):
            self.assertIn("'"+name+"'",setup)

    def test_both_installers_prefer_same_supported_python_order(self):
        setup=(WINDOWS/'setup-ertebatat.ps1').read_text(encoding='utf8')
        install=(WINDOWS/'install.ps1').read_text(encoding='utf8')
        for source in (setup,install):
            positions=[source.find(version) for version in ('3.14','3.13','3.12')]
            self.assertTrue(all(position>=0 for position in positions))
            self.assertEqual(positions,sorted(positions))
        self.assertNotIn('& py -3.12 -c',install)

    def test_security_notes_record_the_deferred_proxy_and_kdf_work(self):
        notes=(ROOT/'docs'/'SECURITY_NOTES.md').read_text(encoding='utf8')
        self.assertIn('TRUSTED_PROXY',notes);self.assertIn('kdf_iter',notes)


if __name__=='__main__':unittest.main()
