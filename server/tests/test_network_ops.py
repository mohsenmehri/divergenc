"""Functional security tests for FAM's read-only Network Operations control plane."""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from server.app import create_app


ORIGIN = "http://localhost"


class NetworkOpsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "fam.sqlite3")
        self.app = create_app({
            "DB_PATH": self.path,
            "PUBLIC_ORIGIN": ORIGIN,
            "TESTING": True,
            "COOKIE_SECURE": False,
            "NETWORK_OPS_ENABLED": True,
            "NETWORK_OPS_MAX_LAB_DEVICES": 10,
        })
        self.admin = self.login("admin")

    def tearDown(self):
        self.temp.cleanup()

    def login(self, username, password="1109"):
        client = self.app.test_client()
        result = client.post("/api/login", json={"username": username, "password": password}, headers={"Origin": ORIGIN})
        self.assertEqual(result.status_code, 200, result.json)
        client.csrf = result.json["csrf"]
        return client

    def post(self, client, path, body):
        return client.post("/api/" + path, json=body, headers={"Origin": ORIGIN, "X-FAM-CSRF": client.csrf})

    def inventory(self, ident="lab-isr-01", *, site="lab", group="edge"):
        revision = self.admin.get("/api/network/overview").json["inventoryRevision"]
        return self.post(self.admin, "network/inventory", {
            "revision": revision,
            "device": {
                "id": ident,
                "name": "Lab device " + ident,
                "siteId": site,
                "groupId": group,
                "enabled": True,
                "lab": True,
                "platform": "cisco_ios",
            },
        })

    def worker(self):
        response = self.post(self.admin, "network/workers", {"id": "worker-lab-01", "name": "Lab Worker"})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["token"]

    @staticmethod
    def worker_headers(token):
        return {"Authorization": "Bearer " + token, "X-FAM-Worker-ID": "worker-lab-01"}

    def test_network_operations_page_is_private_dynamic_and_network_ops_is_opt_in(self):
        anonymous = self.app.test_client().get("/network-operations", follow_redirects=False)
        self.assertEqual(anonymous.status_code, 302)
        self.assertEqual(anonymous.headers["Location"], "/login.html")
        page = self.admin.get("/network-operations")
        self.assertEqual(page.status_code, 200)
        markup = page.get_data(as_text=True)
        self.assertIn("عملیات شبکه", markup)
        self.assertIn("crypto.subtle", markup)
        self.assertIn("/api/network/probes", markup)
        self.assertIn("/api/network/recoveries", markup)
        self.assertIn("await api('/api/network/probes','POST',{workerId,sealed})", markup)
        self.assertIn("selected interface is not currently err-disabled", Path("network_worker/remediator.py").read_text(encoding="utf-8"))
        page.close()
        # The template is outside the IIS/Flask static roots: only the rewrite
        # route may serve it, and its APIs still require an authenticated user.
        self.assertEqual(self.app.test_client().get("/network-operations.html").status_code, 404)
        disabled = create_app({
            "DB_PATH": str(Path(self.temp.name) / "disabled.sqlite3"),
            "PUBLIC_ORIGIN": ORIGIN,
            "TESTING": True,
            "COOKIE_SECURE": False,
            "NETWORK_OPS_ENABLED": False,
        })
        client = disabled.test_client()
        login = client.post("/api/login", json={"username": "admin", "password": "1109"}, headers={"Origin": ORIGIN})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(client.get("/api/network/overview").status_code, 404)
        # Worker routes must not accidentally become anonymous when disabled.
        self.assertEqual(client.post("/api/network/worker/claim", json={}).status_code, 404)

    def test_inventory_rejects_endpoints_credentials_and_non_lab_devices(self):
        revision = self.admin.get("/api/network/overview").json["inventoryRevision"]
        base = {
            "id": "lab-isr-01", "name": "Lab", "siteId": "lab", "groupId": "edge",
            "enabled": True, "lab": True, "platform": "cisco_ios",
        }
        leaked = dict(base, host="192.0.2.10")
        self.assertEqual(self.post(self.admin, "network/inventory", {"revision": revision, "device": leaked}).status_code, 400)
        unsafe = dict(base, lab=False)
        self.assertEqual(self.post(self.admin, "network/inventory", {"revision": revision, "device": unsafe}).status_code, 400)
        saved = self.inventory()
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertNotIn("host", saved.json["device"])
        self.assertNotIn("credential", saved.json["device"])

    def test_only_level_one_can_change_control_plane_and_level_two_can_read(self):
        users = self.admin.get("/api/users").json
        users["users"].append({
            "id": "network-reader-002", "username": "netreader", "name": "Network reader", "role": 2,
            "enabled": True, "regions": [], "sheets": [], "password": "1109",
        })
        self.assertEqual(self.post(self.admin, "users", users).status_code, 200)
        reader = self.login("netreader")
        self.assertEqual(reader.get("/api/network/overview").status_code, 200)
        self.assertEqual(self.post(reader, "network/inventory", {"revision": 0, "device": {}}).status_code, 403)
        self.assertEqual(self.post(reader, "network/jobs", {"siteId": "lab", "deviceIds": ["lab-isr-01"]}).status_code, 403)

    def test_custom_permissions_control_network_reports_and_management(self):
        users = self.admin.get("/api/users").json
        users["users"].append({
            "id": "network-audit-003", "username": "netaudit", "name": "Network audit", "enabled": True,
            "regions": [], "sheets": [], "categories": [], "permissions": ["view-history"], "password": "1109",
        })
        self.assertEqual(self.post(self.admin, "users", users).status_code, 200)
        audit_user = self.login("netaudit")
        self.assertEqual(audit_user.get("/api/network/overview").status_code, 200)
        self.assertEqual(self.post(audit_user, "network/inventory", {"revision": 0, "device": {}}).status_code, 403)

        users = self.admin.get("/api/users").json
        users["users"].append({
            "id": "network-manager-04", "username": "netmanager", "name": "Network manager", "enabled": True,
            "regions": [], "sheets": [], "categories": [], "permissions": ["manage-users"], "password": "1109",
        })
        self.assertEqual(self.post(self.admin, "users", users).status_code, 200)
        manager = self.login("netmanager")
        created = self.post(manager, "network/inventory", {"revision": 0, "device": {
            "id": "lab-isr-01", "name": "Lab", "siteId": "lab", "groupId": "edge",
            "enabled": True, "lab": True, "platform": "cisco_ios",
        }})
        self.assertEqual(created.status_code, 200, created.json)

    def test_pairing_token_is_one_time_response_and_worker_route_needs_it(self):
        token = self.worker()
        workers = self.admin.get("/api/network/workers")
        self.assertEqual(workers.status_code, 200)
        self.assertNotIn("token", str(workers.json))
        self.assertEqual(self.admin.post("/api/network/worker/claim", json={}).status_code, 401)
        self.assertEqual(self.admin.post("/api/network/worker/claim", json={}, headers=self.worker_headers(token)).status_code, 200)
        # A normal browser route still rejects a write without Origin + CSRF.
        self.assertEqual(self.admin.post("/api/network/jobs", json={}).status_code, 403)

    def test_user_entered_probe_is_opaque_to_fam_and_claimed_only_by_its_worker(self):
        token = self.worker()
        public_key = "-----BEGIN PUBLIC KEY-----\n" + ("A" * 400) + "\n-----END PUBLIC KEY-----\n"
        registered = self.admin.post(
            "/api/network/workers/worker-lab-01/probe-key", json={"publicKey": public_key}, headers=self.worker_headers(token)
        )
        self.assertEqual(registered.status_code, 200, registered.json)
        key = self.admin.get("/api/network/workers/worker-lab-01/probe-key")
        self.assertEqual(key.status_code, 200, key.json)
        self.assertEqual(key.json["fingerprint"], registered.json["fingerprint"])
        sealed = {
            "algorithm": "RSA-OAEP-256/AES-256-GCM",
            "keyFingerprint": key.json["fingerprint"],
            "encryptedKey": "A" * 512,
            "iv": "B" * 16,
            "ciphertext": "C" * 24,
        }
        queued = self.post(self.admin, "network/probes", {"workerId": "worker-lab-01", "sealed": sealed})
        self.assertEqual(queued.status_code, 201, queued.json)
        self.assertTrue(queued.json["job"]["interactive"])
        self.assertNotIn("host", str(queued.json).lower())
        self.assertNotIn("password", str(queued.json).lower())
        claimed = self.admin.post("/api/network/worker/claim", json={}, headers=self.worker_headers(token))
        self.assertEqual(claimed.status_code, 200, claimed.json)
        self.assertEqual(set(claimed.json["job"]), {"id", "kind", "operation", "targetInterface", "deviceIds", "leaseSeconds", "sealed"})
        self.assertEqual(claimed.json["job"]["sealed"], sealed)
        device_id = claimed.json["job"]["deviceIds"][0]
        completed = self.admin.post(
            "/api/network/worker/jobs/" + queued.json["job"]["id"] + "/complete",
            json={"results": [{"deviceId": device_id, "status": "succeeded", "facts": {"interfaces": {"errDisabled": 1, "errDisabledPorts": [{"name": "Gi0/1"}]}},
                                "warnings": ["err-disabled interfaces detected"], "error": None}]},
            headers=self.worker_headers(token),
        )
        self.assertEqual(completed.status_code, 200, completed.json)
        # The sealed credential envelope is cleared on completion and no
        # connection value is ever returned from the FAM data model.
        detail = self.admin.get("/api/network/jobs/" + queued.json["job"]["id"])
        self.assertTrue(detail.json["job"]["interactive"])
        self.assertNotIn("sealed", str(detail.json).lower())
        self.assertNotIn("password", str(detail.json).lower())
        # A recovery can target only the interface that the completed discovery
        # result structurally reported; it cannot be a free-form CLI request.
        wrong_port = self.post(self.admin, "network/recoveries", {
            "workerId": "worker-lab-01", "sourceJobId": queued.json["job"]["id"], "deviceId": device_id,
            "interface": "Gi0/2", "sealed": sealed,
        })
        self.assertEqual(wrong_port.status_code, 409)
        recovery = self.post(self.admin, "network/recoveries", {
            "workerId": "worker-lab-01", "sourceJobId": queued.json["job"]["id"], "deviceId": device_id,
            "interface": "Gi0/1", "sealed": sealed,
        })
        self.assertEqual(recovery.status_code, 201, recovery.json)
        self.assertEqual(recovery.json["job"]["operation"], "errdisabled_recovery")
        self.assertEqual(recovery.json["job"]["targetInterface"], "Gi0/1")
        recovery_claim = self.admin.post("/api/network/worker/claim", json={}, headers=self.worker_headers(token))
        self.assertEqual(recovery_claim.status_code, 200, recovery_claim.json)
        self.assertEqual(recovery_claim.json["job"]["operation"], "errdisabled_recovery")
        self.assertEqual(recovery_claim.json["job"]["targetInterface"], "Gi0/1")
        completed_recovery = self.admin.post(
            "/api/network/worker/jobs/" + recovery.json["job"]["id"] + "/complete",
            json={"results": [{"deviceId": device_id, "status": "succeeded",
                                "facts": {"recovery": {"interface": "Gi0/1", "status": "recovered"}}, "warnings": [], "error": None}]},
            headers=self.worker_headers(token),
        )
        self.assertEqual(completed_recovery.status_code, 200, completed_recovery.json)

    def test_job_scope_is_explicit_and_a_device_cannot_run_twice(self):
        self.assertEqual(self.inventory().status_code, 200)
        bad = self.post(self.admin, "network/jobs", {"siteId": "lab", "deviceIds": ["lab-isr-01"], "command": "show run"})
        self.assertEqual(bad.status_code, 400)
        wrong_scope = self.post(self.admin, "network/jobs", {"siteId": "other", "groupId": "edge", "deviceIds": ["lab-isr-01"]})
        self.assertEqual(wrong_scope.status_code, 403)
        queued = self.post(self.admin, "network/jobs", {"siteId": "lab", "groupId": "edge", "deviceIds": ["lab-isr-01"]})
        self.assertEqual(queued.status_code, 201, queued.json)
        self.assertEqual(queued.json["job"]["kind"], "read_only_inventory")
        duplicate = self.post(self.admin, "network/jobs", {"siteId": "lab", "groupId": "edge", "deviceIds": ["lab-isr-01"]})
        self.assertEqual(duplicate.status_code, 409)

    def test_worker_receives_only_inventory_ids_and_structured_results(self):
        self.assertEqual(self.inventory().status_code, 200)
        token = self.worker()
        queued = self.post(self.admin, "network/jobs", {"siteId": "lab", "groupId": "edge", "deviceIds": ["lab-isr-01"]}).json["job"]
        claimed = self.admin.post("/api/network/worker/claim", json={}, headers=self.worker_headers(token))
        self.assertEqual(claimed.status_code, 200, claimed.json)
        payload = claimed.json["job"]
        self.assertEqual(set(payload), {"id", "kind", "operation", "targetInterface", "deviceIds", "leaseSeconds"})
        self.assertEqual(payload["deviceIds"], ["lab-isr-01"])
        self.assertNotIn("host", str(payload))
        raw_attempt = {
            "results": [{
                "deviceId": "lab-isr-01", "status": "succeeded", "facts": {"hostname": "r1"},
                "warnings": [], "error": None, "rawOutput": "show running-config ...",
            }]
        }
        self.assertEqual(self.admin.post("/api/network/worker/jobs/" + queued["id"] + "/complete", json=raw_attempt, headers=self.worker_headers(token)).status_code, 400)
        completed = self.admin.post("/api/network/worker/jobs/" + queued["id"] + "/complete", json={"results": [{
            "deviceId": "lab-isr-01", "status": "succeeded",
            "facts": {"hostname": "r1", "model": "ISR4451", "osVersion": "17.6", "interfaces": {"total": 2, "up": 1, "down": 1}},
            "warnings": ["some fixed inventory commands were unavailable"], "error": None,
        }]}, headers=self.worker_headers(token))
        self.assertEqual(completed.status_code, 200, completed.json)
        detail = self.admin.get("/api/network/jobs/" + queued["id"])
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(set(detail.json["results"][0]), {"deviceId", "status", "collectedAt", "facts", "warnings", "error"})
        self.assertNotIn("raw", str(detail.json).lower())
        self.assertEqual(self.admin.post("/api/network/commands", json={}, headers={"Origin": ORIGIN, "X-FAM-CSRF": self.admin.csrf}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
