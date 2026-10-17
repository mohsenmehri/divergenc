"""Reproduce review claims against the UNFIXED 59d7a4f SERVER snapshot.

PASS here means the stated current behavior was reproduced, NOT that it is safe.
No production fixes are applied. All DBs are temporary and all SSH is mocked.
Run: .venv/bin/python scripts/audit_equipment_review_findings.py -v
After fixes, replace these snapshot assertions with the corrected contracts.
"""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import hashlib
import json
import os
import sqlite3
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


class ReviewSnapshot(unittest.TestCase):
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

    def test_ticket_replay_is_currently_accepted(self):
        ticket = self.ticket()
        body = {**JOB, 'interface': 'Gi0/7', 'ticket': ticket}
        self.assertEqual(self.post('equipment/recover', body).status_code, 200)
        self.assertEqual(self.post('equipment/recover', body).status_code, 200)
        self.assertEqual(self.calls.count('recover'), 2)  # API admission, not proof of two physical writes.

    def test_same_second_ticket_issuance_has_no_unique_nonce(self):
        now = int(ops.time.time())
        with mock.patch.object(ops.time, 'time', return_value=now):
            self.assertEqual(self.ticket(), self.ticket())

    def test_concurrent_recoveries_enter_executor_for_same_host_and_interface(self):
        ticket = self.ticket()
        second_client = self.login()
        barrier = threading.Barrier(2)
        lock = threading.Lock()
        active = 0
        max_active = 0
        def executor(job):
            nonlocal active, max_active
            self.assertEqual(job['operation'], 'recover')
            with lock:
                active += 1; max_active = max(max_active, active)
            try:
                barrier.wait(timeout=5)
                return {'ok': True, 'recovery': 'recovered'}
            finally:
                with lock: active -= 1
        self.app.config['EQUIPMENT_EXECUTOR'] = executor
        body = {**JOB, 'interface': 'Gi0/7', 'ticket': ticket}
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(self.post, 'equipment/recover', body, client) for client in [self.client, second_client]]
            responses = [job.result(timeout=10) for job in jobs]
        self.assertEqual([r.status_code for r in responses], [200, 200])
        self.assertEqual(max_active, 2)

    def test_router_in_scope_is_accepted_but_region_scope_still_denies(self):
        envelope = self.client.get('/api/equipment/state').json
        envelope['inventory']['nodes'] = [
            {'id': 'router-a', 'name': 'Synthetic router', 'host': '100.100.1.22', 'typeId': 'type-router', 'modelId': 'model-1841', 'regionId': 'region-1', 'siteKindId': 'kind-building', 'siteId': 'building-0'},
            {'id': 'router-b', 'name': 'Synthetic out of scope', 'host': '100.108.1.22', 'typeId': 'type-router', 'modelId': 'model-1841', 'regionId': 'region-2', 'siteKindId': 'kind-building', 'siteId': 'building-0'}]
        response = self.post('equipment/state', {'revision': envelope['revision'], 'requestId': str(uuid.uuid4()), 'kind': 'inventory', 'value': envelope['inventory']})
        self.assertEqual(response.status_code, 200)
        users = self.client.get('/api/users').json
        scope = {k: ['*'] for k in DEFAULT_INVENTORY['catalog']}; scope['regions'] = ['region-1']
        users['users'].append({'id': str(uuid.uuid4()), 'username': 'audit-scan', 'name': 'Synthetic scanner', 'enabled': True, 'categories': [], 'permissions': ['equipment-operations', 'equipment-scan'], 'regions': [], 'sheets': [], 'password': BOOT, 'equipmentScope': scope})
        self.assertEqual(self.post('users', users).status_code, 200)
        worker = self.login('audit-scan')
        self.calls.clear()
        self.assertEqual(self.post('equipment/check', JOB, worker).status_code, 200)
        self.assertEqual(self.calls, ['status'])
        self.calls.clear()
        self.assertEqual(self.post('equipment/check', {**JOB, 'host': '100.108.1.22'}, worker).status_code, 403)
        self.assertEqual(self.calls, [])

    def test_custom_manager_runs_app_but_both_backup_validators_reject_it(self):
        path = self.config['DB_PATH']
        users = self.client.get('/api/users').json
        users['users'] = [{'id': str(uuid.uuid4()), 'username': 'custom-manager',
                           'name': 'Synthetic custom manager', 'enabled': True,
                           'categories': sorted(application.BUILTIN_CATEGORIES),
                           'permissions': sorted(application.PERMISSIONS),
                           'regions': [], 'sheets': [], 'password': BOOT,
                           'equipmentScope': {k: ['*'] for k in DEFAULT_INVENTORY['catalog']}}]
        # Real supported users API: transfer administration to a new custom user,
        # without direct SQL mutations or deleting/resetting a production DB.
        self.assertEqual(self.post('users', users).status_code, 200)
        self.client = self.login('custom-manager')
        with sqlite3.connect(path) as db:
            db.row_factory = sqlite3.Row
            row = db.execute('SELECT * FROM users').fetchone()
            self.assertEqual(row['role'], 4)
            self.assertTrue(application.may_manage_users(application.public_user(row)))
        application.create_app(self.config)  # Runtime accepts this manager.
        with sqlite3.connect(path) as db:
            with self.assertRaisesRegex(ValueError, 'No active administrator'): manage.check(db)
        with self.assertRaisesRegex(ValueError, 'No active administrator'):
            manage.backup(path, Path(self.tmp.name) / 'ordinary-backup.sqlite3')
        with self.assertRaisesRegex(ValueError, 'No active administrator'):
            preflight_backup.backup(path, Path(self.tmp.name) / 'preflight-backup.sqlite3')

    def test_missing_bootstrap_secret_uses_known_default_even_outside_testing(self):
        with mock.patch.dict(os.environ):
            os.environ.pop('FAM_INITIAL_PASSWORD', None)
            app = application.create_app({'DB_PATH': str(Path(self.tmp.name) / 'fresh.sqlite3'), 'PUBLIC_ORIGIN': ORIGIN, 'TESTING': False})
            response = app.test_client().post('/api/login', json={'username': 'admin', 'password': '1109'}, headers={'Origin': ORIGIN})
        self.assertEqual(response.status_code, 200)

    def test_restart_rotates_ticket_key_and_invalidates_approval(self):
        ticket = self.ticket()
        with sqlite3.connect(self.config['DB_PATH']) as db: user_id = db.execute("SELECT id FROM users WHERE username='admin'").fetchone()[0]
        kwargs = {'user_id': user_id, 'host': JOB['host'], 'username': JOB['username'], 'interface': 'Gi0/7'}
        self.assertTrue(ops._verify_ticket(self.app, ticket, **kwargs))
        with mock.patch.dict(os.environ):
            os.environ.pop('FAM_EQUIPMENT_TICKET_KEY', None)
            another_app = application.create_app(self.config)
        self.assertFalse(ops._verify_ticket(another_app, ticket, **kwargs))

    def test_config_interruption_is_generic_error_then_disabled_retry_does_not_enable(self):
        ticket = self.ticket()
        commands_seen = []
        def session(job, commands, deadline):
            commands_seen.append(commands)
            if commands == probe.STATUS_COMMANDS: return ERROR
            self.assertIn('shutdown', commands); self.assertIn('no shutdown', commands)
            # Models an indeterminate config-session failure. It cannot prove
            # how many bytes/commands real IOS received or executed.
            raise probe.ProbeError('connection_timeout')
        def recover_without_compiler(job): return probe._recover(job, probe.Deadline(85))
        self.app.config['EQUIPMENT_EXECUTOR'] = lambda job: probe.execute(job)
        body = {**JOB, 'interface': 'Gi0/7', 'ticket': ticket}
        with mock.patch.object(probe, 'recover', side_effect=recover_without_compiler), mock.patch.object(probe, 'session_output', side_effect=session):
            response = self.post('equipment/recover', body)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(len(commands_seen), 2)  # precheck + failed config, no postcheck
        with mock.patch.object(probe, 'recover', side_effect=recover_without_compiler), mock.patch.object(probe, 'session_output', return_value=DISABLED) as output:
            retry = self.post('equipment/recover', body)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json['recovery'], 'not_errdisabled')
        self.assertEqual(output.call_count, 1)  # Correctly refuses to enable an arbitrary disabled port.

    def test_short_rows_are_unknown_not_clean(self):
        short = HEADER + 'Gi0/7 err-disabled 1 auto auto\n'
        self.assertEqual(list(probe._table_rows(short)), [])
        with self.assertRaises(probe.ProbeError): probe.validate_status_output(short)

    def test_status_masks_exact_secret_but_not_case_variant(self):
        output = HEADER + 'Gi0/7 PaSs123 err-disabled 1 auto auto 10/100\n'
        probe.validate_status_output(output)
        self.assertEqual(probe.safe_status_ports(output, {**JOB, 'password': 'PaSs123'})['ports'][0]['description'], '')
        self.assertEqual(probe.safe_status_ports(output, {**JOB, 'password': 'pass123'})['ports'][0]['description'], 'PaSs123')

    def test_status_truncation_can_expose_a_prefix_of_the_exact_secret(self):
        secret = 'SyntheticCredential' * 10
        output = HEADER + 'Gi0/7 ' + secret + ' err-disabled 1 auto auto 10/100\n'
        probe.validate_status_output(output)
        description = probe.safe_status_ports(output, {**JOB, 'password': secret})['ports'][0]['description']
        self.assertEqual(description, secret[:128])

    def test_status_has_no_secret_keyword_masking_but_description_read_does(self):
        output = HEADER + 'Gi0/7 community FixtureCommunity err-disabled 1 auto auto 10/100\n'
        probe.validate_status_output(output)
        self.assertEqual(probe.safe_status_ports(output, JOB)['ports'][0]['description'], 'community FixtureCommunity')
        table = 'Interface Status Protocol Description\nGi0/7 up up community FixtureCommunity\n'
        clean, redacted = probe.descriptions_table(table, JOB['username'], JOB['password'])
        self.assertTrue(redacted); self.assertNotIn('FixtureCommunity', clean)

    def test_missing_description_boundary_rejects_inspect_without_reconnecting(self):
        with mock.patch.object(probe, 'session_output', return_value=ERROR) as output:
            with self.assertRaises(probe.ProbeError) as error: probe.inspect_device(dict(JOB))
        self.assertEqual(error.exception.code, 'descriptions_unreadable')
        self.assertEqual(output.call_count, 1)

    def test_closing_exception_is_chained_not_entirely_lost(self):
        class FaultyClose(application.ClosingConnection):
            def close(self):
                sqlite3.Connection.close(self)
                raise RuntimeError('synthetic close error')
        db = sqlite3.connect(':memory:', factory=FaultyClose)
        with self.assertRaises(RuntimeError) as error:
            with db: raise ValueError('synthetic primary error')
        self.assertIsInstance(error.exception.__context__, ValueError)

    def test_host_key_default_is_tofu_not_preprovisioned_strict(self):
        with mock.patch.dict(os.environ):
            os.environ.pop('FAM_EQUIPMENT_HOST_KEY_POLICY', None)
            self.assertEqual(probe.host_key_policy(), 'accept-new')
        with mock.patch.dict(os.environ, {'FAM_EQUIPMENT_HOST_KEY_POLICY': 'strict'}):
            self.assertEqual(probe.host_key_policy(), 'yes')

    def test_delivered_archive_prompt_and_server_sources_are_not_empty(self):
        path = ROOT / 'releases/FAM-SERVER-Current-Python-Review.zip'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), '4bb0e234dcf3db64e92eba7d9a8dff5438085cbe5f5f35ded060b286f62ebaa9')
        with ZipFile(path) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.read('REVIEW_PROMPT_FA.md')), 9566)
            self.assertEqual(archive.read('REVIEW_PROMPT_FA.md'), archive.read('docs/CURRENT_SERVER_PYTHON_REVIEW_PROMPT_FA.md'))
            with ZipFile(BytesIO(archive.read('releases/FAM-Custom-Access-SERVER-Patch.zip'))) as patch:
                for name in ['app.py', 'equipment_probe.py', 'equipment_ops.py', 'equipment_inventory.py']:
                    current = (ROOT / 'server' / name).read_bytes()
                    self.assertGreater(len(current), 0)
                    self.assertEqual(archive.read('server/' + name), current)
                    self.assertEqual(patch.read('payload/' + name), current)


if __name__ == '__main__':
    print('DIAGNOSTICS ONLY: PASS means reproduction of current behavior, NOT security approval. No actual device connection.', flush=True)
    unittest.main()
