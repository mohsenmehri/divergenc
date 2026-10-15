"""One narrowly-scoped, human-approved Cisco IOS err-disabled recovery.

This module deliberately is not a terminal.  It accepts one already-reported
interface identifier and can issue only the fixed shutdown/no shutdown recovery
sequence after a fresh read-only pre-check.
"""
from __future__ import annotations

from .collector import INTERFACE, err_disabled_ports
from .config import Device
from .secrets import Credential


def _failure(device_id, code, warning=None, *, interface=None):
    facts = {}
    if interface:
        facts["recovery"] = {"interface": interface, "status": "not_completed"}
    return {"deviceId": device_id, "status": "failed", "facts": facts, "warnings": [warning] if warning else [], "error": code}


def recover_errdisabled(device: Device, credential: Credential, interface: str, *, connection_factory=None):
    """Recover exactly one previously detected err-disabled interface.

    The caller supplies a syntax-validated interface that FAM already matched
    against a completed discovery result.  We nevertheless re-read live status
    immediately before configuration and refuse when the port is not currently
    err-disabled.  No raw output is retained and no configuration is saved.
    """
    if device.platform != "cisco_ios":
        return _failure(device.id, "unsupported_platform", interface=interface)
    if not isinstance(interface, str) or not INTERFACE.fullmatch(interface):
        return _failure(device.id, "precheck_failed", interface=str(interface)[:64])
    if connection_factory is None:
        try:
            from netmiko import ConnectHandler
        except ImportError:
            return _failure(device.id, "worker_error", interface=interface)
        connection_factory = ConnectHandler
    connection = None
    try:
        connection = connection_factory(
            device_type="cisco_ios",
            host=device.host,
            port=device.port,
            username=credential.username,
            password=credential.password,
            conn_timeout=device.timeout_seconds,
            auth_timeout=device.timeout_seconds,
            banner_timeout=device.timeout_seconds,
            fast_cli=False,
        )
        before = connection.send_command("show interfaces status", read_timeout=device.timeout_seconds)
        if interface not in err_disabled_ports(before):
            return _failure(device.id, "precheck_failed", "selected interface is not currently err-disabled", interface=interface)
        # This is the entire permitted write surface: one validated interface,
        # then shutdown/no shutdown. There is no user command string, no global
        # configuration, no enable secret, and no write memory operation.
        connection.send_config_set((f"interface {interface}", "shutdown", "no shutdown"), read_timeout=device.timeout_seconds)
        after = connection.send_command("show interfaces status", read_timeout=device.timeout_seconds)
        if interface in err_disabled_ports(after):
            return _failure(device.id, "recovery_failed", "interface remains err-disabled after recovery", interface=interface)
        return {
            "deviceId": device.id,
            "status": "succeeded",
            "facts": {"recovery": {"interface": interface, "status": "recovered"}},
            "warnings": [],
            "error": None,
        }
    except Exception:
        return _failure(device.id, "connection_failed", interface=interface)
    finally:
        if connection is not None:
            try:
                connection.disconnect()
            except Exception:
                pass
