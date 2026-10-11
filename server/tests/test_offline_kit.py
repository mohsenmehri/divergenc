"""Offline asset/static guards. Windows cmdlets are NOT executed by these tests."""
from pathlib import Path
import hashlib
import json
import unittest

ROOT=Path(__file__).resolve().parents[2]
WINDOWS=ROOT/'server/windows'
class OfflineKitChecks(unittest.TestCase):
    def setUp(self):self.manifest=json.loads((WINDOWS/'offline-wheels.json').read_text())
    def test_pinned_files_and_origins(self):
        files=self.manifest['files'];self.assertEqual(len(files),11)
        self.assertEqual(len({s['file'] for s in files}),11)
        for s in files:
            self.assertEqual(Path(s['file']).name,s['file']);self.assertNotIn('\\',s['file'])
            self.assertTrue(s['url'].startswith('https://files.pythonhosted.org/'))
            self.assertRegex(s['sha256'],r'^[a-f0-9]{64}$')
    def test_three_supported_windows_abis(self):
        names={s['file'] for s in self.manifest['files']}
        for abi in ('cp312','cp313','cp314'):
            self.assertIn(f'markupsafe-3.0.4-{abi}-{abi}-win_amd64.whl',names)
        self.assertIn('colorama-0.4.6-py2.py3-none-any.whl',names)
    def test_carried_wheel_hashes(self):
        if not (WINDOWS/'payload/wheels').exists():self.skipTest('Run scripts/fetch_offline_wheels.py to test carried wheel bytes')
        for s in self.manifest['files']:
            self.assertEqual(hashlib.sha256((WINDOWS/'payload/wheels'/s['file']).read_bytes()).hexdigest(),s['sha256'])
    def test_offline_default_and_launcher(self):
        self.assertIn('[switch]$Offline=$true',(WINDOWS/'setup-ertebatat.ps1').read_text())
        self.assertIn('-Offline -PauseAtEnd',(ROOT/'INSTALL-FAM.cmd').read_text())
    def test_preflight_before_changes(self):
        s=(WINDOWS/'setup-ertebatat.ps1').read_text()
        self.assertLess(s.index('Assert-FamOfflinePayload $PSScriptRoot'),s.index('Set-FamPrivateAcl'))
        self.assertLess(s.index('Assert-FamOfflinePayload $PSScriptRoot'),s.index('Enable-WindowsOptionalFeature'))
    def test_no_windows_update_fallback(self):
        s=(WINDOWS/'setup-ertebatat.ps1').read_text()
        branch=s.split('# DISM /LimitAccess',1)[1].split('} elseif',1)[0]
        self.assertIn('LimitAccess=$true',branch);self.assertIn('NoRestart=$true',branch)
        self.assertNotIn('Install-WindowsFeature',branch)
    def test_pip_no_index_and_no_source_distributions(self):
        s=(WINDOWS/'install.ps1').read_text()
        self.assertIn("'--no-index','--only-binary=:all:'",s)
        self.assertIn('Assert-FamWheels',s)
        self.assertIn('Unverified extra wheel:',(WINDOWS/'setup-common.psm1').read_text())
    def test_preparation_needs_no_python(self):
        s=(WINDOWS/'prepare-offline.ps1').read_text()
        self.assertNotIn('pip download',s);self.assertNotIn('py -3',s)
        self.assertIn('offline-wheels.json',s);self.assertIn('Assert-FamOfflinePayload',s)
        self.assertTrue((ROOT/'PREPARE-OFFLINE.cmd').is_file())

if __name__=='__main__':unittest.main()
