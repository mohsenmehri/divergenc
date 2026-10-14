from __future__ import annotations

import base64
import json
from pathlib import Path
import tempfile
import unittest

from network_worker.collector import READ_ONLY_COMMANDS, collect
from network_worker.config import ConfigError, load
from network_worker.runner import Runner
from network_worker.probe_envelope import ProbeKeyStore
from network_worker.config import ProbeKeyStoreConfig
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from network_worker.secrets import Credential, SecretStoreError


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


class FakeStore:
    def credential(self, reference):
        if reference == "missing":
            raise SecretStoreError("not available")
        return Credential("readonly", "not-a-real-password")


class FakeProbeKeys:
    def decrypt(self, envelope, worker_id):
        if envelope != {"sealed": "one-time"} or worker_id != "worker-lab-01":
            raise AssertionError("unexpected sealed probe")
        return "192.0.2.55", 22, "operator", "not-a-real-password"


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
                "controlPlaneUrl": "https://fam.example.test",
                "workerId": "worker-lab-01",
                "tokenEnv": "FAM_NETWORK_WORKER_TOKEN",
                "pollSeconds": 15,
                "maxParallel": 2,
                "caFile": None,
                "secretStore": {"type": "windows-dpapi", "path": "C:\\FAM-NetworkWorker\\private\\secrets.json.dpapi"},
                "probeKeyStore": {"type": "windows-dpapi", "path": "C:\\FAM-NetworkWorker\\private\\interactive-probe-key.dpapi"},
                "devices": [{"id": "lab-isr-01", "host": "192.0.2.10", "port": 22, "credentialRef": "cisco-readonly-lab", "platform": "cisco_ios", "timeoutSeconds": 30}],
            }), encoding="utf-8")
            return load(config)

    def test_config_refuses_inline_credentials_commands_and_non_https(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "worker.json"
            raw = {
                "controlPlaneUrl": "http://fam.example.test", "workerId": "worker-lab-01", "tokenEnv": "FAM_NETWORK_WORKER_TOKEN",
                "pollSeconds": 15, "maxParallel": 1, "caFile": None,
                "secretStore": {"type": "windows-dpapi", "path": "C:\\private\\s.dpapi"},
                "probeKeyStore": {"type": "windows-dpapi", "path": "C:\\private\\probe.dpapi"},
                "devices": [{"id": "lab-isr-01", "host": "192.0.2.10", "port": 22, "credentialRef": "cred", "platform": "cisco_ios", "timeoutSeconds": 30, "command": "show run"}],
            }
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
        self.assertNotIn("inventory output", json.dumps(result))
        self.assertNotIn("192.0.2.1", json.dumps(result))
        source = Path("network_worker/collector.py").read_text(encoding="utf-8")
        self.assertNotIn("send_config_set", source)
        self.assertNotIn("config_mode(", source)
        self.assertNotIn(".enable(", source)

    def test_runner_maps_only_claimed_inventory_ids_and_reports_missing_mapping(self):
        settings = self.settings()
        client = FakeClient({"id": "job_test", "kind": "read_only_inventory", "deviceIds": ["lab-isr-01", "unknown-device"], "leaseSeconds": 600})

        def fake_collector(device, credential):
            return {"deviceId": device.id, "status": "succeeded", "facts": {"hostname": "r1"}, "warnings": [], "error": None}

        runner = Runner(settings, client, FakeStore(), collector=fake_collector)
        self.assertTrue(runner.run_once())
        job_id, results = client.completed
        self.assertEqual(job_id, "job_test")
        self.assertEqual([item["deviceId"] for item in results], ["lab-isr-01", "unknown-device"])
        self.assertEqual(results[1]["error"], "local_inventory_missing")
        self.assertFalse(runner.run_once())

    def test_probe_envelope_is_bound_to_its_worker_and_decrypts_only_in_worker_memory(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode("ascii")
        store = ProbeKeyStore(ProbeKeyStoreConfig("windows-dpapi", Path("C:/private/probe.dpapi")))
        store._private_key, store._public_pem = key, public
        raw = bytes(range(32)); iv = bytes(range(12)); worker_id = "worker-lab-01"
        value = json.dumps({"host": "192.0.2.55", "port": 22, "username": "operator", "password": "not-a-real-password"}, separators=(",", ":")).encode()
        encrypted = AESGCM(raw).encrypt(iv, value, ("FAM Network Worker Probe v1|" + worker_id).encode())
        b64 = lambda data: base64.urlsafe_b64encode(data).decode().rstrip("=")
        envelope = {
            "algorithm": "RSA-OAEP-256/AES-256-GCM", "keyFingerprint": store.fingerprint(),
            "encryptedKey": b64(key.public_key().encrypt(raw, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))),
            "iv": b64(iv), "ciphertext": b64(encrypted),
        }
        self.assertEqual(store.decrypt(envelope, worker_id), ("192.0.2.55", 22, "operator", "not-a-real-password"))

    def test_one_time_browser_sealed_probe_never_uses_or_persists_device_mapping(self):
        settings = self.settings()
        client = FakeClient({
            "id": "job_probe", "kind": "read_only_inventory", "deviceIds": ["probe-123"], "leaseSeconds": 600,
            "sealed": {"sealed": "one-time"},
        })
        captured = {}

        def fake_collector(device, credential):
            captured.update(host=device.host, username=credential.username, password=credential.password, device_id=device.id)
            return {"deviceId": device.id, "status": "succeeded", "facts": {"interfaces": {"errDisabled": 1}}, "warnings": ["err-disabled interfaces detected"], "error": None}

        runner = Runner(settings, client, FakeStore(), FakeProbeKeys(), collector=fake_collector)
        self.assertTrue(runner.run_once())
        self.assertEqual(captured, {"host": "192.0.2.55", "username": "operator", "password": "not-a-real-password", "device_id": "probe-123"})
        self.assertEqual(client.completed[1][0]["warnings"], ["err-disabled interfaces detected"])
        self.assertNotIn("192.0.2.55", str(client.completed[1][0]))
        self.assertNotIn("operator", str(client.completed[1][0]))


if __name__ == "__main__":
    unittest.main()
