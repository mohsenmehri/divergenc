import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
import uuid

from server.app import create_app
from server import network_operations


ORIGIN = "http://localhost"
FINGERPRINT = "SHA256:" + "A" * 43


class NetworkOperationsApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []

        def executor(operation):
            self.calls.append(operation)
            return {
                "status": "succeeded",
                "message": "Recovery completed",
                "output": "Gi1/0/24 is now up",
            }

        self.path = str(Path(self.tmp.name) / "fam.sqlite3")
        self.app = create_app({
            "DB_PATH": self.path,
            "PUBLIC_ORIGIN": ORIGIN,
            "TESTING": True,
            "COOKIE_SECURE": False,
            "NETWORK_OPERATIONS_ENABLED": True,
            "DEVICE_NETWORKS": ["10.20.0.0/16"],
            "SSH_EXECUTOR": executor,
        })
        self.admin = self.login("admin")

    def tearDown(self):
        self.tmp.cleanup()

    def login(self, username, password="1109"):
        client = self.app.test_client()
        response = client.post("/api/login", json={"username": username, "password": password}, headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 200, response.json)
        client.csrf = response.json["csrf"]
        return client

    def post(self, client, path, body):
        return client.post("/api/" + path, json=body, headers={"Origin": ORIGIN, "X-FAM-CSRF": client.csrf})

    def request(self, **updates):
        value = {
            "requestId": str(uuid.uuid4()),
            "action": "recover_errdisable",
            "deviceType": "switch",
            "target": "10.20.4.8",
            "interface": "GigabitEthernet1/0/24",
            "username": "local.operator",
            "password": "a-device-password",
            "hostFingerprint": FINGERPRINT,
            "confirmed": True,
        }
        value.update(updates)
        return value

    def create_role3(self):
        users = self.admin.get("/api/users").json
        users["users"].append({
            "id": str(uuid.uuid4()), "username": "operator3", "name": "Operator 3", "role": 3,
            "enabled": True, "regions": [], "sheets": [], "password": "1109",
        })
        response = self.post(self.admin, "users", users)
        self.assertEqual(response.status_code, 200, response.json)
        return self.login("operator3")

    def test_operation_is_server_audited_idempotent_and_secret_free(self):
        ready = self.admin.get("/api/network-operations/capabilities")
        self.assertEqual(ready.status_code, 200, ready.json)
        self.assertTrue(ready.json["enabled"])

        body = self.request()
        first = self.post(self.admin, "network-operations", body)
        self.assertEqual(first.status_code, 200, first.json)
        operation = first.json["operation"]
        self.assertEqual(operation["status"], "succeeded")
        self.assertEqual(operation["target"], "10.20.4.8")
        self.assertNotIn("password", json.dumps(operation))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0].password, "a-device-password")

        repeated = self.post(self.admin, "network-operations", body)
        self.assertEqual(repeated.status_code, 200, repeated.json)
        self.assertEqual(repeated.json["operation"]["id"], operation["id"])
        self.assertEqual(len(self.calls), 1)

        conflict = self.post(self.admin, "network-operations", self.request(requestId=body["requestId"], interface="Gi1/0/23"))
        self.assertEqual(conflict.status_code, 409, conflict.json)
        history = self.admin.get("/api/network-operations")
        self.assertEqual(history.status_code, 200, history.json)
        self.assertEqual([item["id"] for item in history.json["operations"]], [operation["id"]])

        with sqlite3.connect(self.path) as db:
            stored = "\n".join(str(value) for row in db.execute("SELECT * FROM network_operations") for value in row)
        self.assertNotIn("a-device-password", stored)
        self.assertNotIn("local.operator", stored)

    def test_scope_roles_and_unapproved_target_are_rejected(self):
        scoped = self.create_role3()
        self.assertEqual(scoped.get("/api/network-operations/capabilities").status_code, 403)
        self.assertEqual(self.post(scoped, "network-operations", self.request()).status_code, 403)
        outside = self.post(self.admin, "network-operations", self.request(target="192.168.1.1"))
        self.assertEqual(outside.status_code, 403, outside.json)
        injected = self.post(self.admin, "network-operations", self.request(interface="Gi1/0/24\nwrite memory"))
        self.assertEqual(injected.status_code, 400, injected.json)
        missing_confirm = self.post(self.admin, "network-operations", self.request(confirmed=False))
        self.assertEqual(missing_confirm.status_code, 400, missing_confirm.json)
        self.assertFalse(self.calls)

    def test_disabled_feature_exposes_no_execution_endpoint(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            app = create_app({"DB_PATH": str(Path(tmp.name) / "fam.sqlite3"), "PUBLIC_ORIGIN": ORIGIN, "TESTING": True, "COOKIE_SECURE": False})
            client = app.test_client()
            login = client.post("/api/login", json={"username": "admin", "password": "1109"}, headers={"Origin": ORIGIN})
            client.csrf = login.json["csrf"]
            capability = client.get("/api/network-operations/capabilities")
            self.assertFalse(capability.json["enabled"])
            response = client.post("/api/network-operations", json=self.request(), headers={"Origin": ORIGIN, "X-FAM-CSRF": client.csrf})
            self.assertEqual(response.status_code, 503, response.json)
        finally:
            tmp.cleanup()


class NetworkOperationsRecipeTests(unittest.TestCase):
    def test_fixed_recipe_never_sends_enable_or_write_memory(self):
        operation = network_operations.parse_request({
            "requestId": str(uuid.uuid4()), "action": "recover_errdisable", "deviceType": "router",
            "target": "10.20.9.9", "interface": "Gi1/0/24", "username": "radius.user",
            "password": "secret", "hostFingerprint": FINGERPRINT, "confirmed": True,
        }, network_operations.configured_networks("10.20.0.0/16"))
        commands, shows = [], []

        class FakeClient:
            def set_missing_host_key_policy(self, policy):
                self.policy = policy
            def connect(self, **kwargs):
                self.kwargs = kwargs
            def invoke_shell(self, **kwargs):
                return object()
            def close(self):
                pass

        class FakeSshException(Exception):
            pass

        fake_paramiko = types.SimpleNamespace(
            SSHClient=FakeClient, SSHException=FakeSshException,
            AuthenticationException=FakeSshException, BadHostKeyException=FakeSshException,
        )
        old_module = sys.modules.get("paramiko")
        old_command = network_operations._shell_command
        sys.modules["paramiko"] = fake_paramiko

        def command(_, value):
            commands.append(value)
            if value.startswith("show interfaces"):
                shows.append(value)
                return "Gi1/0/24 err-disabled" if len(shows) == 1 else "Gi1/0/24 connected"
            return "ok"

        network_operations._shell_command = command
        try:
            result = network_operations.execute_recover_errdisable(operation)
        finally:
            network_operations._shell_command = old_command
            if old_module is None:
                del sys.modules["paramiko"]
            else:
                sys.modules["paramiko"] = old_module
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(commands, [
            "terminal length 0", "show interfaces Gi1/0/24 status", "configure terminal",
            "interface Gi1/0/24", "shutdown", "no shutdown", "end", "show interfaces Gi1/0/24 status",
        ])
        self.assertFalse(any(item.strip().lower() == "enable" for item in commands))
        self.assertFalse(any("write memory" in item.lower() for item in commands))


if __name__ == "__main__":
    unittest.main()
