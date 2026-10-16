"""Equipment Management replaces the former Worker control-plane UI."""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

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

    def test_rejects_non_private_targets_extra_fields_and_missing_csrf(self):
        base = {"host": "8.8.8.8", "username": "u", "password": "p"}
        self.assertEqual(self.post("/api/equipment/check", base).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "169.254.10.20", "username": "u", "password": "p"}).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "u", "password": "p", "command": "show run"}).status_code, 400)
        self.assertEqual(self.post("/api/equipment/check", {"host": "10.2.52.2", "username": "u", "password": "p"}, csrf=False).status_code, 403)

    def test_old_worker_screen_and_api_are_not_registered(self):
        self.assertEqual(self.client.get("/network-operations").status_code, 404)
        self.assertEqual(self.client.post("/api/network/worker/claim", json={}, headers={"Origin": ORIGIN, "X-FAM-CSRF": self.csrf}).status_code, 404)

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
