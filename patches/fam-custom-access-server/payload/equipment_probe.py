"""One-shot Cisco IOS equipment probe used only by the FAM backend.

The process reads one JSON document from stdin and writes one sanitized JSON
result to stdout.  Credentials never appear in its arguments, environment,
logs, database, or output.  It deliberately exposes no terminal/command API.
"""
from __future__ import annotations

import ipaddress
import json
import re
import sys

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
RFC1918_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def respond(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def errdisabled_interfaces(output: str):
    """Return only an interface and its displayed status-name/description.

    Cisco IOS places the optional port name between the interface column and
    ``err-disabled`` in ``show interfaces status``.  This deliberately returns
    no raw CLI line or other device data.
    """
    ports = {}
    for line in output.splitlines():
        fields = line.split()
        if not fields or not INTERFACE.fullmatch(fields[0]):
            continue
        try:
            status_index = next(index for index, field in enumerate(fields[1:], 1) if field.lower() == "err-disabled")
        except StopIteration:
            continue
        description = " ".join(fields[1:status_index]).strip()
        # IOS uses -- when the Name column is empty. Keep the useful, bounded
        # label only; do not turn the complete device response into an API.
        if description in {"--", "-", "N/A"}:
            description = ""
        ports.setdefault(fields[0], description[:128])
    return [{"interface": interface, "description": ports[interface]} for interface in sorted(ports)]


def errdisabled_ports(output: str):
    """Compatibility helper for the recovery pre-/post-check."""
    return [item["interface"] for item in errdisabled_interfaces(output)]


def connect(value):
    # Import only after JSON validation; malformed requests never need the SSH
    # dependency and should never expose import/runtime details.
    from netmiko import ConnectHandler
    return ConnectHandler(
        device_type="cisco_ios",
        host=value["host"],
        port=22,
        username=value["username"],
        password=value["password"],
        conn_timeout=15,
        auth_timeout=15,
        banner_timeout=15,
        fast_cli=False,
    )


def status(value):
    connection = connect(value)
    try:
        # Fixed command only. Raw output is parsed then discarded.
        return {"ok": True, "ports": errdisabled_interfaces(connection.send_command("show interfaces status", read_timeout=20))}
    finally:
        connection.disconnect()


def recover(value):
    interface = value["interface"]
    connection = connect(value)
    try:
        before = errdisabled_ports(connection.send_command("show interfaces status", read_timeout=20))
        if interface not in before:
            return {"ok": True, "recovery": "not_errdisabled"}
        # This is the only allowed configuration sequence.  Do not enable,
        # save, or execute any caller-provided command.
        connection.send_config_set(["interface " + interface, "shutdown", "no shutdown"], read_timeout=20)
        after = errdisabled_ports(connection.send_command("show interfaces status", read_timeout=20))
        return {"ok": True, "recovery": "still_errdisabled" if interface in after else "recovered"}
    finally:
        connection.disconnect()


def execute(value):
    """Run one already-decoded, bounded job and return only its safe result."""
    if not isinstance(value, dict) or set(value) not in ({"operation", "host", "username", "password"}, {"operation", "host", "username", "password", "interface"}):
        return {"ok": False, "error": "invalid_request"}
    if value.get("operation") not in {"status", "recover"} or not all(isinstance(value.get(key), str) for key in ("host", "username", "password")):
        return {"ok": False, "error": "invalid_request"}
    try:
        address = ipaddress.ip_address(value["host"])
    except ValueError:
        return {"ok": False, "error": "invalid_request"}
    if not isinstance(address, ipaddress.IPv4Address) or not any(address in network for network in RFC1918_NETWORKS):
        return {"ok": False, "error": "invalid_request"}
    if value["operation"] == "recover" and (not isinstance(value.get("interface"), str) or not INTERFACE.fullmatch(value["interface"])):
        return {"ok": False, "error": "invalid_request"}
    try:
        return status(value) if value["operation"] == "status" else recover(value)
    except Exception as exc:  # Map all library/device details to stable codes.
        name = type(exc).__name__
        if name == "NetmikoAuthenticationException":
            return {"ok": False, "error": "authentication_failed"}
        if name in {"NetmikoTimeoutException", "ReadTimeout"}:
            return {"ok": False, "error": "connection_timeout"}
        return {"ok": False, "error": "connection_failed"}


def main():
    try:
        value = json.loads(sys.stdin.buffer.read(4096).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        respond({"ok": False, "error": "invalid_request"})
        return
    respond(execute(value))


if __name__ == "__main__":
    main()
