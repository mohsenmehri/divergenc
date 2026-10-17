"""Static checks for the user-mode, no-Python VDI Equipment Connector."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ConnectorPackageChecks(unittest.TestCase):
    @unittest.skipUnless((ROOT/'equipment_connector/connector.ps1').exists(), 'Historical connector fixture not included in SERVER-only bundles')
    def test_connector_needs_no_administrator_python_or_inbound_listener(self):
        connector = (ROOT / "equipment_connector" / "connector.ps1").read_text(encoding="utf8")
        launcher = (ROOT / "equipment_connector" / "START-FAM-EQUIPMENT-CONNECTOR.cmd").read_text(encoding="utf8")
        self.assertIn("powershell.exe", launcher.lower())
        self.assertIn("where ssh.exe", launcher.lower())
        self.assertNotIn("python", launcher.lower())
        self.assertNotIn("schtasks", launcher.lower())
        self.assertNotIn("CERT_NONE", connector)
        self.assertNotIn("ServerCertificateValidationCallback", connector)
        self.assertNotIn("socket.bind", connector)
        self.assertIn("Get-Command ssh.exe", connector)
        self.assertIn("/api/equipment/connector/claim", connector)
        self.assertIn("/api/equipment/connector/complete", connector)

    def test_server_runs_direct_ssh_mode_and_keeps_connector_disabled(self):
        start = (ROOT / "server" / "windows" / "start.ps1").read_text(encoding="utf8")
        backend = (ROOT / "server" / "equipment_ops.py").read_text(encoding="utf8")
        self.assertIn("FAM_EQUIPMENT_OPS_ENABLED='1'", start)
        self.assertIn("FAM_EQUIPMENT_CONNECTOR_ENABLED='0'", start)
        self.assertIn("System32\\OpenSSH\\ssh.exe", start)
        self.assertIn("FAM_EQUIPMENT_KNOWN_HOSTS", start)
        self.assertIn("FAM_EQUIPMENT_HOST_KEY_POLICY='strict'", start)
        self.assertNotIn("StrictHostKeyChecking=no", start)
        self.assertNotIn("class EquipmentBroker", backend)
        self.assertNotIn('/api/equipment/connector/claim', backend)


if __name__ == "__main__":
    unittest.main()
