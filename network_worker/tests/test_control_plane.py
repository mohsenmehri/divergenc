from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import ssl
import unittest
from unittest.mock import Mock, patch

from network_worker.client import ControlPlaneClient
from network_worker.config import Settings
import network_worker.main as worker_main


class ControlPlaneTests(unittest.TestCase):
    def settings(self, ca_file=None):
        return Settings(
            control_plane_url="https://fam.example.test",
            worker_id="worker-lab-01",
            token_env="FAM_NETWORK_WORKER_TOKEN",
            poll_seconds=15,
            max_parallel=1,
            ca_file=Path(ca_file) if ca_file else None,
            secret_store=SimpleNamespace(),
            probe_key_store=SimpleNamespace(),
            devices={},
        )

    @patch("network_worker.client.build_opener")
    @patch("network_worker.client.ssl.create_default_context")
    def test_control_plane_never_uses_system_proxy(self, context_factory, build_opener):
        context_factory.return_value = Mock()
        ControlPlaneClient(self.settings(), "fwn_" + "x" * 32)
        handlers = build_opener.call_args.args
        self.assertEqual(handlers[0].proxies, {})

    @patch("network_worker.client.ssl.DER_cert_to_PEM_cert", return_value="-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n")
    @patch("network_worker.client.ssl.create_default_context")
    def test_binary_der_ca_is_converted_for_openssl(self, context_factory, der_to_pem):
        fallback_context = Mock()
        context_factory.side_effect = [ssl.SSLError("DER path not accepted"), fallback_context]
        with patch.object(Path, "read_bytes", return_value=b"binary-der"):
            ControlPlaneClient(self.settings("C:/lab/fam.cer"), "fwn_" + "x" * 32)
        der_to_pem.assert_called_once_with(b"binary-der")
        fallback_context.load_verify_locations.assert_called_once()


class MainExitCodeTests(unittest.TestCase):
    def test_once_returns_nonzero_when_control_plane_claim_fails(self):
        runner = Mock()
        runner.run_once.side_effect = worker_main.ControlPlaneError("test")
        settings = SimpleNamespace(token_env="FAM_NETWORK_WORKER_TOKEN", secret_store=SimpleNamespace(), probe_key_store=SimpleNamespace())
        probe_keys = Mock(); probe_keys.public_key_pem.return_value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n"
        with (
            patch.object(worker_main, "arguments", return_value=SimpleNamespace(config="ignored", once=True)),
            patch.object(worker_main, "load", return_value=settings),
            patch.object(worker_main, "ControlPlaneClient"),
            patch.object(worker_main, "DPAPISecretStore"),
            patch.object(worker_main, "ProbeKeyStore", return_value=probe_keys),
            patch.object(worker_main, "Runner", return_value=runner),
            patch.dict(worker_main.os.environ, {"FAM_NETWORK_WORKER_TOKEN": "fwn_" + "x" * 32}, clear=False),
        ):
            self.assertEqual(worker_main.main(), 3)

    def test_once_returns_zero_only_after_successful_claim_cycle(self):
        runner = Mock()
        settings = SimpleNamespace(token_env="FAM_NETWORK_WORKER_TOKEN", secret_store=SimpleNamespace(), probe_key_store=SimpleNamespace())
        probe_keys = Mock(); probe_keys.public_key_pem.return_value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n"
        with (
            patch.object(worker_main, "arguments", return_value=SimpleNamespace(config="ignored", once=True)),
            patch.object(worker_main, "load", return_value=settings),
            patch.object(worker_main, "ControlPlaneClient"),
            patch.object(worker_main, "DPAPISecretStore"),
            patch.object(worker_main, "ProbeKeyStore", return_value=probe_keys),
            patch.object(worker_main, "Runner", return_value=runner),
            patch.dict(worker_main.os.environ, {"FAM_NETWORK_WORKER_TOKEN": "fwn_" + "x" * 32}, clear=False),
        ):
            self.assertEqual(worker_main.main(), 0)
        runner.run_once.assert_called_once()


if __name__ == "__main__":
    unittest.main()
