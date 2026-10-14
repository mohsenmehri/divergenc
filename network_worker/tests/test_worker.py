from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from network_worker.collector import READ_ONLY_COMMANDS, collect
from network_worker.config import ConfigError, load
from network_worker.runner import Runner
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


if __name__ == "__main__":
    unittest.main()
