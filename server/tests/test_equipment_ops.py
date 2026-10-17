"""Equipment Management API: direct FAM-server SSH mode (helper is mocked)."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

from server.app import create_app
from server.equipment_probe import errdisabled_interfaces, errdisabled_ports

ORIGIN = "https://fam.test"


class EquipmentOpsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []

        def executor(value):
            self.calls.append(value)
            if value["operation"] == "status":
                return {"ok": True, "ports": [
                    {"interface": "Gi0/2", "description": "Uplink core"},
                    {"interface": "Gi0/1", "description": "ATM 17"},
                ]}
            return {"ok": True, "recovery": "recovered"}

        self.app = create_app({
            "TESTING": True,
            "DB_PATH": str(Path(self.temp.name) / "fam.sqlite3"),
            "PUBLIC_ORIGIN": ORIGIN,
            "COOKIE_SECURE": False,
            "EQUIPMENT_OPS_ENABLED": True,
            "EQUIPMENT_EXECUTOR": executor,
        })
        self.client = self.app.test_client()
        response = self.client.post("/api/login", json={"username": "admin", "password": "1109"}, headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 200)
        self.csrf = response.json["csrf"]

    def tearDown(self):
        self.temp.cleanup()

    def post(self, path, body, *, csrf=True):
        headers = {"Origin": ORIGIN}
        if csrf:
            headers["X-FAM-CSRF"] = self.csrf
        return self.client.post(path, json=body, headers=headers)

    def test_direct_check_uses_transient_request_only_and_returns_structured_ports(self):
        password = "temporary-test-password"
        result = self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "radius.user", "password": password})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["host"], "10.2.52.2")
        self.assertEqual(result.json["source"],"server-ssh")
        self.assertIsInstance(result.json["checkedAt"],int)
        self.assertEqual(result.json["errDisabledPorts"], [
            {"interface": "Gi0/1", "description": "ATM 17"},
            {"interface": "Gi0/2", "description": "Uplink core"},
        ])
        self.assertEqual(set(result.json["recoveryTickets"]), {"Gi0/1", "Gi0/2"})
        self.assertNotIn(password, str(result.json))
        self.assertNotIn("radius.user", str(result.json["recoveryTickets"]))
        self.assertEqual(self.calls[0], {"operation": "status", "host": "10.2.52.2", "username": "radius.user", "password": password})
        # FAM's SQLite schema deliberately has no equipment credential table or
        # saved job for this direct request.
        with self.app.app_context():
            import sqlite3
            with sqlite3.connect(Path(self.temp.name) / "fam.sqlite3") as db:
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse(any("credential" in name.lower() for name in tables))
                dumped = "\n".join(str(row) for row in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
                self.assertNotIn("temporary-test-password", dumped)

    def test_recovery_requires_check_ticket_same_user_target_and_fresh_password(self):
        checked = self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "radius.user", "password": "first"})
        ticket = checked.json["recoveryTickets"]["Gi0/1"]
        denied = self.post("/api/equipment/recover", {"host": "10.2.52.3", "username": "radius.user", "password": "second", "interface": "Gi0/1", "ticket": ticket})
        self.assertEqual(denied.status_code, 409)
        recovered = self.post("/api/equipment/recover", {"host": "10.2.52.2", "username": "radius.user", "password": "second", "interface": "Gi0/1", "ticket": ticket})
        self.assertEqual(recovered.status_code, 200, recovered.json)
        self.assertEqual(recovered.json["recovery"], "recovered")
        self.assertEqual(self.calls[-1]["operation"], "recover")
        self.assertEqual(self.calls[-1]["interface"], "Gi0/1")
        self.assertEqual(self.calls[-1]["password"], "second")

    def test_legacy_connector_path_is_disabled_by_default(self):
        self.assertFalse(self.app.config["EQUIPMENT_CONNECTOR_ENABLED"])
        denied = self.post("/api/equipment/connector/claim", {})
        self.assertEqual(denied.status_code, 404)

    def test_rejects_non_private_targets_extra_fields_and_missing_csrf(self):
        base = {"host": "8.8.8.8", "username": "u", "password": "p"}
        self.assertEqual(self.post("/api/equipment/check", base).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "169.254.10.20", "username": "u", "password": "p"}).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "u", "password": "p", "command": "show run"}).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "u", "password": "p"}, csrf=False).status_code, 403)

    def test_rejects_shell_metacharacters_in_username_and_non_ascii_password(self):
        for body in (
            {"host": "10.2.52.2", "username": "u\" & calc & \"", "password": "p"},
            {"host": "10.2.52.2", "username": "-oProxyCommand=x", "password": "p"},
            {"host": "10.2.52.2", "username": "radius.user", "password": "p\u00e4ss"},
            {"host": "10.2.52.2", "username": "radius.user", "password": "p\nq"},
        ):
            self.assertEqual(self.post("/api/equipment/check", body).status_code, 400, body)
        ok = self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "DOMAIN\\net-ops_01@x", "password": "p&ss w|rd<>^%!"})
        self.assertEqual(ok.status_code, 200, ok.json)

    def test_direct_mode_runs_helper_with_ssh_settings_and_coordinated_timeout(self):
        import subprocess
        from server import equipment_ops
        self.app.config.update(EQUIPMENT_EXECUTOR=None, EQUIPMENT_CONNECTOR_ENABLED=False,
                               EQUIPMENT_PYTHON=__import__("sys").executable,
                               EQUIPMENT_HELPER=str(Path(__file__).resolve().parents[1] / "equipment_probe.py"),
                               EQUIPMENT_SSH="C:\\Windows\\System32\\OpenSSH\\ssh.exe",
                               EQUIPMENT_KNOWN_HOSTS="C:\\FAMData\\equipment\\known_hosts",
                               EQUIPMENT_HOST_KEY_POLICY="accept-new")
        seen = {}

        def fake_run(argv, **kwargs):
            seen.update(argv=argv, **kwargs)
            payload = json.loads(kwargs["input"].decode("utf-8"))
            self.assertEqual(payload["operation"], "status")
            self.assertEqual(payload["password"], "secret-only-on-stdin")
            return subprocess.CompletedProcess(argv, 0, stdout=b'{"ok":true,"ports":[]}', stderr=b"")

        with mock.patch.object(equipment_ops.subprocess, "run", side_effect=fake_run):
            result = self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "radius.user", "password": "secret-only-on-stdin"})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["errDisabledPorts"], [])
        self.assertNotIn("secret-only-on-stdin", " ".join(seen["argv"]))
        self.assertEqual(seen["timeout"], equipment_ops.EXECUTOR_TIMEOUT["status"])
        self.assertEqual(seen["env"]["FAM_EQUIPMENT_SSH"], "C:\\Windows\\System32\\OpenSSH\\ssh.exe")
        self.assertEqual(seen["env"]["FAM_EQUIPMENT_KNOWN_HOSTS"], "C:\\FAMData\\equipment\\known_hosts")
        self.assertEqual(seen["env"]["FAM_EQUIPMENT_HOST_KEY_POLICY"], "accept-new")
        self.assertFalse(any("secret-only-on-stdin" in value for value in seen["env"].values()))

        def hang(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, kwargs["timeout"])

        with mock.patch.object(equipment_ops.subprocess, "run", side_effect=hang):
            result = self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "radius.user", "password": "x"})
        self.assertEqual(result.status_code, 502)
        self.assertIn("زمان مجاز", result.json["error"])

    def test_old_worker_screen_and_api_are_not_registered(self):
        self.assertEqual(self.client.get("/network-operations").status_code, 404)
        self.assertEqual(self.client.post("/api/network/worker/claim", json={}, headers={"Origin": ORIGIN, "X-FAM-CSRF": self.csrf}).status_code, 404)

    def test_unreadable_table_has_actionable_unknown_error_without_raw_output(self):
        self.app.config['EQUIPMENT_EXECUTOR']=lambda value:{'ok':False,'error':'status_unreadable','raw':'PRIVATE CLI'}
        result=self.post('/api/equipment/check',{'host':'10.2.52.2','username':'fixture','password':'temporary'})
        self.assertEqual(result.status_code,502);self.assertIn('نامشخص',result.json['error']);self.assertNotIn('PRIVATE CLI',result.get_data(as_text=True))

    def test_descriptions_endpoint_returns_only_verified_table_and_checks_origin_and_csrf(self):
        from server.tests.test_equipment_probe import DESCRIPTION_TABLE
        self.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'output':'Private banner\nSwitch#'+DESCRIPTION_TABLE+'Switch#\n'}
        body={'host':'10.2.52.2','username':'fixture-user','password':'temporary-test-password'}
        response=self.post('/api/equipment/descriptions',body)
        self.assertEqual(response.status_code,200,response.json);self.assertEqual(response.json['output'],DESCRIPTION_TABLE);self.assertEqual(response.json['command'],'show interfaces description');self.assertEqual(response.json['source'],'server-ssh')
        self.assertNotIn('Private banner',str(response.json));self.assertNotIn('Switch#',str(response.json))
        self.assertEqual(self.post('/api/equipment/descriptions',body,csrf=False).status_code,403)
        self.assertEqual(self.post('/api/equipment/descriptions',{**body,'command':'show run'}).status_code,400)
        self.assertEqual(self.post('/api/equipment/descriptions',{**body,'host':'8.8.8.8'}).status_code,400)
        self.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'output':'SECRET RAW CLI'}
        response=self.post('/api/equipment/descriptions',body);self.assertEqual(response.status_code,502);self.assertNotIn('SECRET RAW CLI',str(response.json))

    def test_inspect_is_one_authorized_executor_call_with_safe_combined_result(self):
        from server.tests.test_equipment_probe import DESCRIPTION_TABLE
        calls=[]
        def executor(job):
            calls.append(job['operation']);return {'ok':True,'ports':[{'interface':'Gi0/7','description':'ATM'}],'descriptions':{'ok':True,'output':'Banner\nSwitch#'+DESCRIPTION_TABLE+'Switch#\n'},'timings':{'preparationMs':7,'sshMs':31,'unsafe':'never expose'}}
        self.app.config['EQUIPMENT_EXECUTOR']=executor;body={'host':'10.2.52.2','username':'fixture','password':'temporary'}
        response=self.post('/api/equipment/inspect',body);self.assertEqual(response.status_code,200,response.json);self.assertEqual(calls,['inspect']);self.assertEqual(response.json['descriptions']['output'],DESCRIPTION_TABLE);self.assertEqual(response.json['timings'],{'preparationMs':7,'sshMs':31});self.assertIn('Gi0/7',response.json['recoveryTickets'])
        self.assertEqual(self.post('/api/equipment/inspect',body,csrf=False).status_code,403);self.assertEqual(self.post('/api/equipment/inspect',{**body,'command':'show run'}).status_code,400);self.assertEqual(calls,['inspect'])

    def test_errdisabled_parser_discards_raw_cli_output(self):
        output = """Port Name Status Vlan Duplex Speed Type
Gi0/1 users err-disabled 1 auto auto 10/100/1000BaseTX
Gi0/2 uplink connected trunk a-full a-1000 10/100/1000BaseTX
Fa0/7 err-disabled 10 auto auto 10/100BaseTX
"""
        self.assertEqual(errdisabled_ports(output), ["Fa0/7", "Gi0/1"])
        self.assertEqual(errdisabled_interfaces(output), [
            {"interface": "Fa0/7", "description": ""},
            {"interface": "Gi0/1", "description": "users"},
        ])


if __name__ == "__main__":
    unittest.main()
