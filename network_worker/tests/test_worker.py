from __future__ import annotations

import base64
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

from network_worker.collector import READ_ONLY_COMMANDS, collect
from network_worker.config import ConfigError, load
from network_worker.runner import Runner
from network_worker.probe_envelope import ProbeKeyStore
from network_worker.remediator import recover_errdisabled
from network_worker.config import ProbeKeyStoreConfig
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from network_worker.secrets import Credential


class FakeConnection:
    def __init__(self):
        self.commands = []
        self.disconnected = False

    def send_command(self, command, read_timeout):
        self.commands.append(command)
        return {
            "show version": "lab-r1 uptime is 1 week\nCisco IOS XE Software, Version 17.6.1\ncisco ISR4451-X/K9 (1RU) processor",
            "show inventory": "inventory output that must not be returned",
            "show ip interface brief": "Interface IP-Address OK? Method Status Protocol\nGigabitEthernet0/0 192.0.2.1 YES manual up up\nGigabitEthernet0/1 unassigned YES unset administratively down down",
            "show interfaces status": "Port Name Status\nGi0/1 test err-disabled",
            "show interfaces counters errors": "counter output",
            "show errdisable recovery": "recovery output",
        }[command]

    def disconnect(self):
        self.disconnected = True



class FakeProbeKeys:
    def decrypt(self, envelope, worker_id):
        if envelope != {"sealed": "one-time"} or worker_id != "worker-fam-local":
            raise AssertionError("unexpected sealed probe")
        return SimpleNamespace(host="192.0.2.55", port=22, username="operator", password="not-a-real-password", operation="interactive_probe", interface=None)


class RecoveryConnection:
    def __init__(self):
        self.config = []
        self.status_calls = 0
        self.disconnected = False

    def send_command(self, command, read_timeout):
        self.status_calls += 1
        return "Port Name Status\nGi0/1 test err-disabled" if self.status_calls == 1 else "Port Name Status\nGi0/1 test connected"

    def send_config_set(self, commands, read_timeout):
        self.config.extend(commands)

    def disconnect(self):
        self.disconnected = True


class FakeClient:
    def __init__(self, job):
        self.job = job
        self.completed = None

    def claim(self):
        job, self.job = self.job, None
        return job

    def complete(self, job_id, results):
        self.completed = (job_id, results)
        return {"id": job_id}


class WorkerTests(unittest.TestCase):
    def settings(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "worker.json"
            config.write_text(json.dumps({
                "controlPlaneUrl": "http://127.0.0.1:8765",
                "workerId": "worker-fam-local",
                "pollSeconds": 15,
                "maxParallel": 2,
                "caFile": None,
                "probeKeyStore": {"type": "windows-dpapi", "path": "C:\\FAM-NetworkWorker\\private\\interactive-probe-key.dpapi"},
                "devices": [{"id": "lab-isr-01", "host": "192.0.2.10", "port": 22, "credentialRef": "cisco-readonly-lab", "platform": "cisco_ios", "timeoutSeconds": 30}],
            }), encoding="utf-8")
            return load(config)

    def test_config_accepts_utf8_bom_from_windows_powershell(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "worker.json"
            config.write_text(json.dumps({
                "controlPlaneUrl": "http://127.0.0.1:8765", "workerId": "worker-fam-local",
                "pollSeconds": 15, "maxParallel": 1, "caFile": None,
                "probeKeyStore": {"type": "windows-dpapi", "path": "C:\\private\\probe.dpapi"},
                "devices": [],
            }), encoding="utf-8-sig")
            self.assertEqual(load(config).worker_id, "worker-fam-local")

    def test_config_refuses_inline_credentials_commands_and_non_https(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "worker.json"
            raw = {
                "controlPlaneUrl": "http://127.0.0.1:8765", "workerId": "worker-fam-local",
                "pollSeconds": 15, "maxParallel": 1, "caFile": None,
                "probeKeyStore": {"type": "windows-dpapi", "path": "C:\\private\\probe.dpapi"},
                "devices": [{"id": "lab-isr-01", "host": "192.0.2.10", "port": 22, "credentialRef": "cred", "platform": "cisco_ios", "timeoutSeconds": 30, "command": "show run"}],
            }
            config.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(ConfigError):
                load(config)
            raw["devices"] = []
            raw["secretStore"] = {"type": "windows-dpapi", "path": "C:\\private\\legacy.dpapi"}
            config.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(ConfigError):
                load(config)

    def test_collector_uses_only_fixed_show_commands_and_discards_raw_output(self):
        device = self.settings().devices["lab-isr-01"]
        instance = FakeConnection()
        result = collect(device, Credential("readonly", "password"), connection_factory=lambda **kwargs: instance)
        self.assertEqual(instance.commands, list(READ_ONLY_COMMANDS))
        self.assertTrue(instance.disconnected)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["facts"]["hostname"], "lab-r1")
        self.assertEqual(result["facts"]["interfaces"]["errDisabled"], 1)
        self.assertEqual(result["facts"]["interfaces"]["errDisabledPorts"], [{"name": "Gi0/1"}])
        self.assertNotIn("inventory output", json.dumps(result))
        self.assertNotIn("192.0.2.1", json.dumps(result))
        source = Path("network_worker/collector.py").read_text(encoding="utf-8")
        self.assertNotIn("send_config_set", source)
        self.assertNotIn("config_mode(", source)
        self.assertNotIn(".enable(", source)

    def test_recovery_is_limited_to_one_prechecked_interface_and_never_saves_config(self):
        device = self.settings().devices["lab-isr-01"]
        connection = RecoveryConnection()
        result = recover_errdisabled(device, Credential("readonly", "password"), "Gi0/1", connection_factory=lambda **kwargs: connection)
        self.assertEqual(connection.config, ["interface Gi0/1", "shutdown", "no shutdown"])
        self.assertTrue(connection.disconnected)
        self.assertEqual(result["facts"]["recovery"], {"interface": "Gi0/1", "status": "recovered"})
        self.assertNotIn("write memory", " ".join(connection.config).lower())

    def test_runner_maps_only_claimed_inventory_ids_and_reports_missing_mapping(self):
        settings = self.settings()
        client = FakeClient({"id": "job_test", "kind": "read_only_inventory", "operation": "inventory", "targetInterface": None, "deviceIds": ["lab-isr-01", "unknown-device"], "leaseSeconds": 600})

        def fake_collector(device, credential):
            return {"deviceId": device.id, "status": "succeeded", "facts": {"hostname": "r1"}, "warnings": [], "error": None}

        runner = Runner(settings, client, collector=fake_collector)
        self.assertTrue(runner.run_once())
        job_id, results = client.completed
        self.assertEqual(job_id, "job_test")
        self.assertEqual([item["deviceId"] for item in results], ["lab-isr-01", "unknown-device"])
        self.assertTrue(all(item["error"] == "local_inventory_missing" for item in results))
        self.assertFalse(runner.run_once())

    def test_probe_envelope_is_bound_to_its_worker_and_decrypts_only_in_worker_memory(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode("ascii")
        store = ProbeKeyStore(ProbeKeyStoreConfig("windows-dpapi", Path("C:/private/probe.dpapi")))
        store._private_key, store._public_pem = key, public
        raw = bytes(range(32)); iv = bytes(range(12)); worker_id = "worker-fam-local"
        value = json.dumps({"host": "192.0.2.55", "port": 22, "username": "operator", "password": "not-a-real-password", "operation": "interactive_probe", "interface": None}, separators=(",", ":")).encode()
        encrypted = AESGCM(raw).encrypt(iv, value, ("FAM Network Worker Probe v1|" + worker_id).encode())
        b64 = lambda data: base64.urlsafe_b64encode(data).decode().rstrip("=")
        envelope = {
            "algorithm": "RSA-OAEP-256/AES-256-GCM", "keyFingerprint": store.fingerprint(),
            "encryptedKey": b64(key.public_key().encrypt(raw, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))),
            "iv": b64(iv), "ciphertext": b64(encrypted),
        }
        connection = store.decrypt(envelope, worker_id)
        self.assertEqual((connection.host, connection.port, connection.username, connection.operation, connection.interface), ("192.0.2.55", 22, "operator", "interactive_probe", None))

    def test_one_time_browser_sealed_probe_never_uses_or_persists_device_mapping(self):
        settings = self.settings()
        client = FakeClient({
            "id": "job_probe", "kind": "read_only_inventory", "operation": "interactive_probe", "targetInterface": None, "deviceIds": ["probe-123"], "leaseSeconds": 600,
            "sealed": {"sealed": "one-time"},
        })
        captured = {}

        def fake_collector(device, credential):
            captured.update(host=device.host, username=credential.username, password=credential.password, device_id=device.id)
            return {"deviceId": device.id, "status": "succeeded", "facts": {"interfaces": {"errDisabled": 1}}, "warnings": ["err-disabled interfaces detected"], "error": None}

        runner = Runner(settings, client, FakeProbeKeys(), collector=fake_collector)
        self.assertTrue(runner.run_once())
        self.assertEqual(captured, {"host": "192.0.2.55", "username": "operator", "password": "not-a-real-password", "device_id": "probe-123"})
        self.assertEqual(client.completed[1][0]["warnings"], ["err-disabled interfaces detected"])
        self.assertNotIn("192.0.2.55", str(client.completed[1][0]))
        self.assertNotIn("operator", str(client.completed[1][0]))


if __name__ == "__main__":
    unittest.main()
