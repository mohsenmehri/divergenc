"""One-shot Cisco IOS equipment probe used only by the FAM backend.

The process reads one JSON document from stdin and writes one sanitized JSON
result to stdout.  Credentials never appear in its arguments, environment,
logs, database, or output.  It deliberately exposes no terminal/command API.
"""
from __future__ import annotations

import json
import re
import sys

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")


def respond(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def errdisabled_ports(output: str):
    """Return only interface names with an explicit err-disabled status."""
    ports = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 2 and "err-disabled" in line.lower() and INTERFACE.fullmatch(fields[0]):
            ports.append(fields[0])
    return sorted(set(ports))


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
        # Fixed command only.  Raw output is parsed then discarded.
        return {"ok": True, "ports": errdisabled_ports(connection.send_command("show interfaces status", read_timeout=20))}
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


def main():
    try:
        value = json.loads(sys.stdin.buffer.read(4096).decode("utf-8"))
        if not isinstance(value, dict) or set(value) not in ({"operation", "host", "username", "password"}, {"operation", "host", "username", "password", "interface"}):
            raise ValueError
        if value.get("operation") not in {"status", "recover"}:
            raise ValueError
        if not all(isinstance(value.get(key), str) for key in ("host", "username", "password")):
            raise ValueError
        if value["operation"] == "recover" and (not isinstance(value.get("interface"), str) or not INTERFACE.fullmatch(value["interface"])):
            raise ValueError
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        respond({"ok": False, "error": "invalid_request"})
        return
    try:
        respond(status(value) if value["operation"] == "status" else recover(value))
    except Exception as exc:  # Map all library/device details to stable codes.
        name = type(exc).__name__
        if name == "NetmikoAuthenticationException":
            respond({"ok": False, "error": "authentication_failed"})
        elif name in {"NetmikoTimeoutException", "ReadTimeout"}:
            respond({"ok": False, "error": "connection_timeout"})
        else:
            respond({"ok": False, "error": "connection_failed"})


if __name__ == "__main__":
    main()
