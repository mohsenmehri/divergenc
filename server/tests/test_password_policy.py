"""New-password length policy: strict product default, lab-configurable minimum.

The product default stays 12 characters. A lab deployment may lower it through
FAM_PASSWORD_MIN_LENGTH (clamped to the hard 4-128 floor) until the owner
approves a final password policy. The reserved fixture password '1109' is
banned outside TESTING regardless of the configured minimum.
"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server.app import Problem, create_app, credentials, password_min_length

ORIGIN='https://lab.test'

class PasswordPolicyTests(unittest.TestCase):
    def build(self,env):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        settings={'DB_PATH':str(Path(tmp.name)/'fam.sqlite3'),'PUBLIC_ORIGIN':ORIGIN,'COOKIE_SECURE':False}
        with mock.patch.dict(os.environ,env):
            return create_app(settings)
    def test_default_minimum_is_twelve_and_rejects_short_new_passwords(self):
        app=self.build({'FAM_INITIAL_PASSWORD':'Synthetic-bootstrap-password'})
        self.assertEqual(app.config['PASSWORD_MIN_LENGTH'],12)
        with app.app_context():
            with self.assertRaises(Problem):credentials('short-pass')
            salt,digest=credentials('012345678901')
            self.assertEqual(len(salt),32);self.assertEqual(len(digest),64)
    def test_lab_minimum_accepts_short_new_passwords_but_keeps_the_floor(self):
        app=self.build({'FAM_INITIAL_PASSWORD':'1234','FAM_PASSWORD_MIN_LENGTH':'4'})
        self.assertEqual(app.config['PASSWORD_MIN_LENGTH'],4)
        with app.app_context():
            salt,digest=credentials('abcd')
            self.assertEqual(len(salt),32);self.assertEqual(len(digest),64)
            with self.assertRaises(Problem):credentials('abc')  # hard 4-character floor
            salt,_=credentials('abcd','0'*32)  # verification path is unaffected
            self.assertEqual(salt,'0'*32)
    def test_invalid_or_small_minimum_falls_back_safely(self):
        self.assertEqual(password_min_length('nonsense'),12)
        self.assertEqual(password_min_length('2'),4)   # clamped up to the floor
        self.assertEqual(password_min_length('999'),128)
        app=self.build({'FAM_INITIAL_PASSWORD':'Synthetic-bootstrap-password','FAM_PASSWORD_MIN_LENGTH':'nonsense'})
        self.assertEqual(app.config['PASSWORD_MIN_LENGTH'],12)
    def test_reserved_fixture_password_is_still_banned_outside_testing(self):
        with self.assertRaises(RuntimeError):
            self.build({'FAM_INITIAL_PASSWORD':'1109','FAM_PASSWORD_MIN_LENGTH':'4'})
    def test_change_password_endpoint_uses_the_configured_minimum(self):
        app=self.build({'FAM_INITIAL_PASSWORD':'Synthetic-bootstrap-password','FAM_PASSWORD_MIN_LENGTH':'4'})
        client=app.test_client()
        response=client.post('/api/login',json={'username':'admin','password':'Synthetic-bootstrap-password'},headers={'Origin':ORIGIN})
        self.assertEqual(response.status_code,200,response.json)
        csrf=response.json['csrf']
        rejected=client.post('/api/password',json={'currentPassword':'Synthetic-bootstrap-password','newPassword':'abc'},headers={'Origin':ORIGIN,'X-FAM-CSRF':csrf})
        self.assertEqual(rejected.status_code,400)
        accepted=client.post('/api/password',json={'currentPassword':'Synthetic-bootstrap-password','newPassword':'abcd'},headers={'Origin':ORIGIN,'X-FAM-CSRF':csrf})
        self.assertEqual(accepted.status_code,200,accepted.json)

if __name__=='__main__':
    unittest.main()
