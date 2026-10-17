"""Acceptance contracts for the SERVER review fixes; all SSH is mocked."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import unittest
from unittest import mock
import uuid
from zipfile import ZipFile

from server import app as application, equipment_ops as ops, equipment_probe as probe, manage
from server.equipment_inventory import DEFAULT_INVENTORY
from server.windows import preflight_backup

ORIGIN = 'https://synthetic-review.invalid'
BOOT = 'Synthetic-review-bootstrap-only'
JOB = {'host': '100.100.1.22', 'username': 'synthetic.user', 'password': 'synthetic-only'}
HEADER = 'Port Name Status Vlan Duplex Speed Type\n'
ERROR = HEADER + 'Gi0/7 Fixture err-disabled 1 auto auto 10/100\n'
DISABLED = HEADER + 'Gi0/7 Fixture disabled 1 auto auto 10/100\n'


class SecurityFixes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='fam-review-repro-')
        self.addCleanup(self.tmp.cleanup)
        self.env = mock.patch.dict(os.environ, {'FAM_INITIAL_PASSWORD': BOOT})
        self.env.start(); self.addCleanup(self.env.stop)
        # Fail hard if an accidentally unmocked path attempts device SSH.
        self.ssh_guard = mock.patch.object(probe, 'run_ssh', side_effect=AssertionError('Real SSH forbidden in review diagnostics'))
        self.ssh_guard.start(); self.addCleanup(self.ssh_guard.stop)
        self.calls = []
        self.config = {'TESTING': True, 'PUBLIC_ORIGIN': ORIGIN, 'COOKIE_SECURE': False,
                       'DB_PATH': str(Path(self.tmp.name) / 'fixture.sqlite3'),
                       'EQUIPMENT_OPS_ENABLED': True, 'EQUIPMENT_EXECUTOR': self.executor}
        self.app = application.create_app(self.config)
        self.client = self.login()

    def executor(self, job):
        self.calls.append(job['operation'])
        if job['operation'] == 'recover': return {'ok': True, 'recovery': 'recovered'}
        return {'ok': True, 'ports': [{'interface': 'Gi0/7', 'description': 'Fixture'}]}

    def login(self, name='admin', password=BOOT):
        client = self.app.test_client()
        response = client.post('/api/login', json={'username': name, 'password': password}, headers={'Origin': ORIGIN})
        self.assertEqual(response.status_code, 200)
        client.review_csrf = response.json['csrf']
        return client

    def post(self, path, body, client=None):
        client = client or self.client
        return client.post('/api/' + path, json=body, headers={'Origin': ORIGIN, 'X-FAM-CSRF': client.review_csrf})

    def ticket(self):
        response = self.post('equipment/check', JOB)
        self.assertEqual(response.status_code, 200)
        return response.json['recoveryTickets']['Gi0/7']

    def test_nonce_and_one_use(self):
        now=int(ops.time.time())
        with mock.patch.object(ops.time,'time',return_value=now):
            first,second=self.ticket(),self.ticket()
        self.assertNotEqual(first,second)
        body={**JOB,'interface':'Gi0/7','ticket':first}
        self.assertEqual(self.post('equipment/recover',body).status_code,200)
        self.assertEqual(self.post('equipment/recover',body).status_code,409)
        self.assertEqual(self.calls.count('recover'),1)
        self.assertEqual(self.post('equipment/recover',{**body,'ticket':second}).status_code,200)

    def test_concurrent_recovery_is_denied_without_consuming_waiting_ticket(self):
        first,second=self.ticket(),self.ticket();other=self.login()
        entered,release=threading.Event(),threading.Event()
        def executor(job):
            entered.set();self.assertTrue(release.wait(5))
            return {'ok':True,'recovery':'recovered'}
        self.app.config['EQUIPMENT_EXECUTOR']=executor
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(self.post,'equipment/recover',{**JOB,'interface':'Gi0/7','ticket':first})
            try:
                self.assertTrue(entered.wait(5))
                blocked=self.post('equipment/recover',{**JOB,'interface':'Gi0/7','ticket':second},other)
                self.assertEqual(blocked.status_code,429)
            finally:release.set()
            self.assertEqual(pending.result(timeout=6).status_code,200)
        self.app.config['EQUIPMENT_EXECUTOR']=self.executor
        self.assertEqual(self.post('equipment/recover',{**JOB,'interface':'Gi0/7','ticket':second},other).status_code,200)

    def test_guard_coordinates_independent_instances_and_retains_no_secrets(self):
        from server.equipment_guard import EquipmentGuard,AdmissionError
        one=self.app.extensions['equipment_guard'];two=EquipmentGuard(self.config['DB_PATH'])
        with one.admit(JOB['host'],'synthetic-confirmation-token'):
            with self.assertRaises(AdmissionError):
                with two.admit(JOB['host']):pass
            with two.admit('100.108.1.22'):
                with self.assertRaises(AdmissionError):
                    with one.admit('100.107.1.22'):pass
        with self.assertRaises(AdmissionError):
            with two.admit(JOB['host'],'synthetic-confirmation-token'):pass
        with sqlite3.connect(self.config['DB_PATH']) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM equipment_leases').fetchone()[0],0)
            rows=str(db.execute('SELECT * FROM equipment_used_tickets').fetchall())
        for secret in [JOB['host'],JOB['username'],JOB['password'],'synthetic-confirmation-token']:
            self.assertNotIn(secret,rows)

    def test_guard_excludes_a_separate_python_process(self):
        code = """import sys
from server.equipment_guard import EquipmentGuard, AdmissionError
g=EquipmentGuard(sys.argv[1])
try:
    with g.admit('100.100.1.22'): print('admitted')
except AdmissionError as e: print(e.code)
"""
        guard=self.app.extensions['equipment_guard']
        def child():
            return subprocess.run([sys.executable,'-c',code,self.config['DB_PATH']],
                                  cwd=ROOT,capture_output=True,text=True,timeout=10,check=True).stdout.strip()
        with guard.admit(JOB['host']):self.assertEqual(child(),'equipment_busy')
        self.assertEqual(child(),'admitted')

    def test_bootstrap_never_falls_back_to_echoed_stdin(self):
        from server import bootstrap_admin
        with mock.patch.dict(os.environ,{},clear=True), mock.patch.object(sys,'argv',['bootstrap','--db',str(Path(self.tmp.name)/'fresh.sqlite3'),'--origin',ORIGIN]), mock.patch.object(sys.stdin,'isatty',return_value=False), mock.patch.object(bootstrap_admin.getpass,'getpass') as prompt:
            with self.assertRaisesRegex(SystemExit,'Secure interactive console'):
                bootstrap_admin.main()
            prompt.assert_not_called()

    def test_lease_released_even_after_exception(self):
        guard=self.app.extensions['equipment_guard']
        with self.assertRaises(ValueError):
            with guard.admit(JOB['host']):raise ValueError('synthetic')
        with guard.admit(JOB['host']):pass

    def test_bad_ticket_does_not_consume_real_approval(self):
        ticket=self.ticket();body={**JOB,'interface':'Gi0/7','ticket':ticket}
        self.assertEqual(self.post('equipment/recover',{**body,'ticket':ticket[:-2]+'!!'}).status_code,409)
        self.assertEqual(self.post('equipment/recover',body).status_code,200)

    def test_recovery_uncertain_is_structured_and_ticket_is_consumed(self):
        ticket=self.ticket();self.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':False,'error':'recovery_uncertain','raw':'PRIVATE DIAGNOSTIC'}
        body={**JOB,'interface':'Gi0/7','ticket':ticket}
        response=self.post('equipment/recover',body)
        self.assertEqual(response.status_code,502)
        self.assertEqual(response.json['code'],'recovery_uncertain')
        self.assertTrue(response.json['requiresRecheck'])
        self.assertNotIn('PRIVATE DIAGNOSTIC',response.get_data(as_text=True))
        self.assertEqual(self.post('equipment/recover',body).status_code,409)

    def test_bootstrap_fails_before_creating_database_then_secure_retry_works(self):
        path=Path(self.tmp.name)/'fresh.sqlite3'
        with mock.patch.dict(os.environ):
            os.environ.pop('FAM_INITIAL_PASSWORD',None)
            with self.assertRaises(RuntimeError):application.create_app({'DB_PATH':str(path),'PUBLIC_ORIGIN':ORIGIN})
            self.assertFalse(path.exists())
            os.environ['FAM_INITIAL_PASSWORD']=BOOT
            app=application.create_app({'DB_PATH':str(path),'PUBLIC_ORIGIN':ORIGIN})
            response=app.test_client().post('/api/login',json={'username':'admin','password':BOOT},headers={'Origin':ORIGIN})
            self.assertEqual(response.status_code,200)
            os.environ.pop('FAM_INITIAL_PASSWORD')
            application.create_app({'DB_PATH':str(path),'PUBLIC_ORIGIN':ORIGIN})

    def test_new_password_policy_does_not_break_legacy_login(self):
        self.app.config['TESTING']=False
        self.assertEqual(self.post('password',{'currentPassword':BOOT,'newPassword':'tiny'}).status_code,400)
        self.assertEqual(self.post('password',{'currentPassword':BOOT,'newPassword':'New-synthetic-long-password'}).status_code,200)

    def test_backup_accepts_real_custom_manager_and_keeps_integrity(self):
        users=self.client.get('/api/users').json
        users['users']=[{'id':str(uuid.uuid4()),'username':'custom-manager','name':'Synthetic manager','enabled':True,'categories':sorted(application.BUILTIN_CATEGORIES),'permissions':sorted(application.PERMISSIONS),'regions':[],'sheets':[],'password':BOOT,'equipmentScope':{k:['*'] for k in DEFAULT_INVENTORY['catalog']}}]
        self.assertEqual(self.post('users',users).status_code,200)
        self.client=self.login('custom-manager')
        with sqlite3.connect(self.config['DB_PATH']) as db:manage.check(db)
        for kind,fn in [('normal',manage.backup),('preflight',preflight_backup.backup)]:
            destination=Path(self.tmp.name)/(kind+'.sqlite3')
            fn(self.config['DB_PATH'],destination)
            with sqlite3.connect(destination) as db:self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(self.post('backups',{}).status_code,200)

    def test_manager_policy_denies_disabled_and_malformed_custom_rows(self):
        from server.account_policy import has_active_manager
        with sqlite3.connect(self.config['DB_PATH']) as db:
            db.execute('UPDATE users SET enabled=0');self.assertFalse(has_active_manager(db))
            db.execute("UPDATE users SET enabled=1,permissions='not-json'");self.assertFalse(has_active_manager(db))

    def test_router_is_rejected_even_with_wildcard_scope(self):
        data=self.client.get('/api/equipment/state').json
        data['inventory']['nodes']=[{'id':'audit-router','name':'Router fixture','host':JOB['host'],'typeId':'type-router','modelId':'model-1841','regionId':'region-1','siteKindId':'kind-building','siteId':'building-0'}]
        self.assertEqual(self.post('equipment/state',{'revision':data['revision'],'requestId':str(uuid.uuid4()),'kind':'inventory','value':data['inventory']}).status_code,200)
        for path in ['check','inspect','descriptions']:
            self.assertEqual(self.post('equipment/'+path,JOB).status_code,403)
        self.assertEqual(self.calls,[])

    def test_raw_status_masking_precedes_truncation_and_covers_case_and_keywords(self):
        for label,password in [('PaSs123','pass123'),('SyntheticCredential'*10,'SyntheticCredential'*10),('community SyntheticValue','other-password')]:
            output=HEADER+'Gi0/7 '+label+' err-disabled 1 auto auto 10/100\n'
            probe.validate_status_output(output)
            self.assertEqual(probe.safe_status_ports(output,{**JOB,'password':password})['ports'][0]['description'],'')

    def test_helper_environment_excludes_server_secrets(self):
        with mock.patch.dict(os.environ,{'FAM_INITIAL_PASSWORD':'synthetic-bootstrap','FAM_EQUIPMENT_TICKET_KEY':'synthetic-key','UNRELATED_SECRET':'synthetic-other'}):
            env=ops._helper_environment(self.app)
        for name in ['FAM_INITIAL_PASSWORD','FAM_EQUIPMENT_TICKET_KEY','UNRELATED_SECRET']:self.assertNotIn(name,env)

    def test_default_host_policy_requires_preverified_key(self):
        with mock.patch.dict(os.environ):
            os.environ.pop('FAM_EQUIPMENT_HOST_KEY_POLICY',None)
            self.assertEqual(probe.host_key_policy(),'yes')

    def test_windows_job_contract_retains_noninherited_handle_until_process_exit(self):
        import ctypes
        kernel=mock.MagicMock()
        kernel.CreateJobObjectW.return_value=123
        kernel.SetInformationJobObject.return_value=1
        kernel.AssignProcessToJobObject.return_value=1
        with mock.patch.object(probe.os,'name','nt'),mock.patch.object(probe,'_PROCESS_JOB',None),mock.patch.object(ctypes,'WinDLL',return_value=kernel,create=True):
            probe.protect_process_tree()
            self.assertEqual(probe._PROCESS_JOB,123)
            self.assertEqual(kernel.SetInformationJobObject.call_args.args[2]._obj.basic.flags,0x2000)
            kernel.CloseHandle.assert_not_called()

    def test_job_assignment_failure_fails_closed(self):
        import ctypes
        kernel=mock.MagicMock();kernel.CreateJobObjectW.return_value=123
        kernel.SetInformationJobObject.return_value=1;kernel.AssignProcessToJobObject.return_value=0
        with mock.patch.object(probe.os,'name','nt'),mock.patch.object(probe,'_PROCESS_JOB',None),mock.patch.object(ctypes,'WinDLL',return_value=kernel,create=True):
            with self.assertRaises(probe.ProbeError):probe.protect_process_tree()
            kernel.CloseHandle.assert_called_once_with(123)

    def test_main_never_executes_device_job_when_tree_guard_fails(self):
        fake_input=mock.Mock();fake_input.buffer=BytesIO(json.dumps({'operation':'status',**JOB}).encode())
        with mock.patch.object(probe.sys,'stdin',fake_input),mock.patch.object(probe,'protect_process_tree',side_effect=probe.ProbeError('connection_failed')),mock.patch.object(probe,'execute') as execute,mock.patch.object(probe,'respond') as respond:
            probe.main();execute.assert_not_called();respond.assert_called_once_with({'ok':False,'error':'connection_failed'})
