"""Static and in-memory checks for the user-mode VDI Equipment Connector."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ConnectorPackageChecks(unittest.TestCase):
    def test_connector_needs_no_administrator_or_inbound_listener(self):
        connector = (ROOT / "equipment_connector" / "connector.py").read_text(encoding="utf8")
        launcher = (ROOT / "equipment_connector" / "START-FAM-EQUIPMENT-CONNECTOR.cmd").read_text(encoding="utf8")
        self.assertIn("%LOCALAPPDATA%", launcher)
        self.assertNotIn("schtasks", launcher.lower())
        self.assertNotIn("_create_unverified_context", connector)
        self.assertNotIn("CERT_NONE", connector)
        self.assertNotIn("socket.bind", connector)
        self.assertIn("/api/equipment/connector/claim", connector)
        self.assertIn("/api/equipment/connector/complete", connector)

    def test_server_enables_outbound_connector_mode(self):
        start = (ROOT / "server" / "windows" / "start.ps1").read_text(encoding="utf8")
        backend = (ROOT / "server" / "equipment_ops.py").read_text(encoding="utf8")
        self.assertIn("FAM_EQUIPMENT_CONNECTOR_ENABLED='1'", start)
        self.assertIn("class EquipmentBroker", backend)
        self.assertIn("connector_offline", backend)
        self.assertIn("/api/equipment/connector/claim", backend)


if __name__ == "__main__":
    unittest.main()
