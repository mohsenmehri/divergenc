"""Fixed, read-only Cisco IOS inventory collector.

This module never exposes a free-form CLI surface.  It sends only the constant
commands below, does not enter configuration mode, does not call ``enable()``,
and discards raw command output after deriving small structured facts.
"""
from __future__ import annotations

import re

from .config import Device


INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
from .secrets import Credential


READ_ONLY_COMMANDS = (
    "show version",
    "show inventory",
    "show ip interface brief",
    "show interfaces status",
    "show interfaces counters errors",
    "show errdisable recovery",
)


def _line_count(output, predicate):
    return sum(1 for line in output.splitlines() if predicate(line))


def _version_facts(output):
    facts = {}
    hostname = re.search(r"(?m)^([^\s]+)\s+uptime is\s+", output)
    if hostname:
        facts["hostname"] = hostname.group(1)[:120]
    version = re.search(r"(?:Cisco IOS(?: XE)? Software,\s*)?Version\s+([^,\s]+)", output, re.I)
    if version:
        facts["osVersion"] = version.group(1)[:120]
    model = re.search(r"(?im)^\s*[cC]isco\s+([^\s(]+)\s+\([^)]*\)\s+processor", output)
    if model:
        facts["model"] = model.group(1)[:120]
    return facts


def err_disabled_ports(interface_status):
    """Return syntax-safe interface identifiers from a fixed show command.

    The direct recovery workflow needs a human to select an affected port.
    Only the first token of an ``err-disabled`` status line is retained; all
    other device output remains transient and is never sent to FAM.
    """
    ports = []
    for line in interface_status.splitlines():
        if "err-disabled" not in line.lower():
            continue
        fields = line.split()
        if fields and INTERFACE.fullmatch(fields[0]) and fields[0] not in ports:
            ports.append(fields[0])
    return ports[:128]


def _interface_facts(interface_brief, interface_status, errors):
    interfaces = {}
    # IOS's "show ip interface brief" has a stable header then interfaces.
    lines = [line for line in interface_brief.splitlines() if line.strip()]
    data = lines[1:] if lines and "Interface" in lines[0] else lines
    if data:
        interfaces["total"] = len(data)
        interfaces["up"] = _line_count("\n".join(data), lambda line: bool(re.search(r"\bup\s+up\s*$", line)))
        interfaces["down"] = max(0, interfaces["total"] - interfaces["up"])
    ports = err_disabled_ports(interface_status)
    # Some IOS variants surface the word only in a counter/error response. Keep
    # its count, but expose a recoverable port only when its status line was
    # parsed safely from the fixed status command.
    err_disabled = max(len(ports), _line_count(interface_status + "\n" + errors, lambda line: "err-disabled" in line.lower()))
    if err_disabled:
        interfaces["errDisabled"] = err_disabled
    if ports:
        interfaces["errDisabledPorts"] = [{"name": port} for port in ports]
    return interfaces


def _unsupported_output(value):
    return "% Invalid input" in value or "% Incomplete command" in value or "% Unrecognized command" in value


def _failure(device_id, code, warning=None):
    warnings = [warning] if warning else []
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": warnings, "error": code}


def collect(device: Device, credential: Credential, *, connection_factory=None):
    """Collect one device and return only the API's allow-listed result schema.

    ``connection_factory`` exists to make the fixed-command behavior testable.
    In production it is Netmiko's ``ConnectHandler``.  Exceptions intentionally
    collapse into coarse error codes so raw device banners and command output do
    not reach FAM logs, results, or the browser.
    """
    if device.platform != "cisco_ios":
        return _failure(device.id, "unsupported_platform")
    if connection_factory is None:
        try:
            from netmiko import ConnectHandler
        except ImportError:
            return _failure(device.id, "worker_error")
        connection_factory = ConnectHandler
    connection = None
    outputs = {}
    unavailable = []
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
        for command in READ_ONLY_COMMANDS:
            try:
                output = connection.send_command(command, read_timeout=device.timeout_seconds)
            except Exception:
                unavailable.append(command)
                continue
            if _unsupported_output(output):
                unavailable.append(command)
            else:
                outputs[command] = output
    except Exception:
        return _failure(device.id, "connection_failed")
    finally:
        if connection is not None:
            try:
                connection.disconnect()
            except Exception:
                pass

    version = outputs.get("show version")
    if not version:
        return _failure(device.id, "command_failed", "show version unavailable")
    facts = _version_facts(version)
    interfaces = _interface_facts(
        outputs.get("show ip interface brief", ""),
        outputs.get("show interfaces status", ""),
        outputs.get("show interfaces counters errors", ""),
    )
    if interfaces:
        facts["interfaces"] = interfaces
    warnings = []
    if facts.get("interfaces", {}).get("errDisabled", 0):
        warnings.append("err-disabled interfaces detected")
    if unavailable:
        # Names are from the fixed allow-list, never device-supplied content.
        warnings.append("some fixed inventory commands were unavailable")
    # ``outputs`` leaves scope here and is never serialised or logged.
    return {"deviceId": device.id, "status": "succeeded", "facts": facts, "warnings": warnings, "error": None}
