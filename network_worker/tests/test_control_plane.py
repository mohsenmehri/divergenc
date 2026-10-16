from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import ssl
import unittest
from unittest.mock import Mock, patch

from network_worker.client import ControlPlaneClient, _tls_context
from network_worker.config import Settings
import network_worker.main as worker_main


class ControlPlaneTests(unittest.TestCase):
    def settings(self):
        return Settings(
            control_plane_url="http://127.0.0.1:8765",
            worker_id="worker-fam-local",
            cohosted_loopback=True,
            poll_seconds=15,
            max_parallel=1,
            ca_file=None,
            probe_key_store=SimpleNamespace(),
            devices={},
        )

    @patch("network_worker.client.build_opener")
    def test_loopback_control_plane_never_uses_system_proxy_or_https(self, build_opener):
        ControlPlaneClient(self.settings())
        handlers = build_opener.call_args.args
        self.assertEqual(handlers[0].proxies, {})
        self.assertEqual(type(handlers[1]).__name__, "HTTPHandler")

    @patch("network_worker.client.ssl.DER_cert_to_PEM_cert", return_value="-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n")
    @patch("network_worker.client.ssl.create_default_context")
    def test_binary_der_ca_is_converted_for_openssl(self, context_factory, der_to_pem):
        fallback_context = Mock()
        context_factory.side_effect = [ssl.SSLError("DER path not accepted"), fallback_context]
        with patch.object(Path, "read_bytes", return_value=b"binary-der"):
            _tls_context(Path("C:/lab/fam.cer"))
        der_to_pem.assert_called_once_with(b"binary-der")
        fallback_context.load_verify_locations.assert_called_once()


class MainExitCodeTests(unittest.TestCase):
    def test_once_returns_nonzero_when_control_plane_claim_fails(self):
        runner = Mock()
        runner.run_once.side_effect = worker_main.ControlPlaneError("test")
        settings = SimpleNamespace(probe_key_store=SimpleNamespace())
        probe_keys = Mock(); probe_keys.public_key_pem.return_value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n"
        with (
            patch.object(worker_main, "arguments", return_value=SimpleNamespace(config="ignored", once=True)),
            patch.object(worker_main, "load", return_value=settings),
            patch.object(worker_main, "ControlPlaneClient"),
            patch.object(worker_main, "ProbeKeyStore", return_value=probe_keys),
            patch.object(worker_main, "Runner", return_value=runner),
        ):
            self.assertEqual(worker_main.main(), 3)

    def test_once_returns_zero_only_after_successful_claim_cycle(self):
        runner = Mock()
        settings = SimpleNamespace(probe_key_store=SimpleNamespace())
        probe_keys = Mock(); probe_keys.public_key_pem.return_value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n"
        with (
            patch.object(worker_main, "arguments", return_value=SimpleNamespace(config="ignored", once=True)),
            patch.object(worker_main, "load", return_value=settings),
            patch.object(worker_main, "ControlPlaneClient"),
            patch.object(worker_main, "ProbeKeyStore", return_value=probe_keys),
            patch.object(worker_main, "Runner", return_value=runner),
        ):
            self.assertEqual(worker_main.main(), 0)
        runner.run_once.assert_called_once()


if __name__ == "__main__":
    unittest.main()
