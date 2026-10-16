"""Small, direct Equipment Management API for FAM.

This replaces the browser-visible Worker/pairing workflow.  A signed-in FAM
user submits a private IPv4 address and transient SSH credentials over the
existing HTTPS session.  FAM starts one local, bounded SSH helper process,
keeps the credentials only in process/pipe memory, and returns structured port
status.  There is no token, queued Worker, credential table, device inventory,
or raw CLI output persistence.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import time

from flask import current_app, g, jsonify

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
RFC1918_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _input(value, *, recovery=False):
    expected = {"host", "username", "password"} | ({"interface", "ticket"} if recovery else set())
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError
    host, username, password = value["host"], value["username"], value["password"]
    if not isinstance(host, str) or not isinstance(username, str) or not isinstance(password, str):
        raise ValueError
    try:
        address = ipaddress.ip_address(host.strip())
    except ValueError as exc:
        raise ValueError from exc
    # This release is intentionally an intranet equipment tool, not a generic
    # outbound SSH proxy.  Only private, non-loopback IPv4 management targets
    # may be selected.
    if not isinstance(address, ipaddress.IPv4Address) or not any(address in network for network in RFC1918_NETWORKS):
        raise ValueError
    username = username.strip()
    if not 1 <= len(username) <= 128 or "\r" in username or "\n" in username or not 1 <= len(password) <= 512:
        raise ValueError
    result = {"host": str(address), "username": username, "password": password}
    if recovery:
        interface, ticket = value["interface"], value["ticket"]
        if not isinstance(interface, str) or not INTERFACE.fullmatch(interface) or not isinstance(ticket, str) or not 40 <= len(ticket) <= 1024:
            raise ValueError
        result |= {"interface": interface, "ticket": ticket}
    return result


def _ticket(app, *, user_id, host, username, interface):
    # The browser needs an opaque one-time ticket, not a copy of its username.
    user_digest = hashlib.sha256(username.encode("utf-8")).hexdigest()
    payload = json.dumps({"u": user_id, "h": host, "n": user_digest, "i": interface, "e": int(time.time()) + 300}, separators=(",", ":"), sort_keys=True).encode("utf-8")
    tag = hmac.new(app.config["EQUIPMENT_TICKET_KEY"], payload, hashlib.sha256).digest()
    return _b64(payload) + "." + _b64(tag)


def _verify_ticket(app, value, *, user_id, host, username, interface):
    try:
        encoded, signature = value.split(".", 1)
        payload, tag = _unb64(encoded), _unb64(signature)
        expected = hmac.new(app.config["EQUIPMENT_TICKET_KEY"], payload, hashlib.sha256).digest()
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    user_digest = hashlib.sha256(username.encode("utf-8")).hexdigest()
    return (hmac.compare_digest(tag, expected) and isinstance(decoded, dict) and
            decoded == {"u": user_id, "h": host, "n": user_digest, "i": interface, "e": decoded.get("e")} and
            isinstance(decoded.get("e"), int) and int(time.time()) <= decoded["e"])


def _execute(app, payload):
    override = app.config.get("EQUIPMENT_EXECUTOR")
    if override is not None:
        return override(payload)
    executable = Path(app.config["EQUIPMENT_PYTHON"])
    helper = Path(app.config["EQUIPMENT_HELPER"])
    if not executable.is_file() or not helper.is_file():
        return {"ok": False, "error": "executor_unavailable"}
    try:
        completed = subprocess.run(
            [str(executable), str(helper)], input=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=45, check=False,
        )
        result = json.loads(completed.stdout.decode("utf-8"))
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "error": "executor_unavailable"}
    return result if isinstance(result, dict) else {"ok": False, "error": "executor_unavailable"}


def _failure(value):
    code = value.get("error") if isinstance(value, dict) else ""
    return {
        "authentication_failed": "نام کاربری یا رمز تجهیز پذیرفته نشد.",
        "connection_timeout": "اتصال SSH به تجهیز در زمان مجاز پاسخ نداد.",
        "connection_failed": "بررسی تجهیز انجام نشد؛ دسترسی SSH و وضعیت تجهیز را بررسی کنید.",
        "executor_unavailable": "موتور داخلی بررسی تجهیز روی سرور آماده نیست.",
    }.get(code, "بررسی تجهیز انجام نشد.")


def register_equipment_ops(app, *, data, fail, allowed):
    """Register the only browser-facing equipment operations routes."""

    def authorize():
        if not app.config["EQUIPMENT_OPS_ENABLED"]:
            fail(404, "مدیریت تجهیزات فعال نشده است.")
        if not allowed(g.user):
            fail(403, "مجوز مدیریت تجهیزات لازم است.")

    @app.post("/api/equipment/check")
    def equipment_check():
        authorize()
        try:
            value = _input(data())
        except ValueError:
            fail(400, "IP خصوصی، نام کاربری و رمز تجهیز معتبر نیست.")
        result = _execute(app, {"operation": "status", **value})
        raw_ports = result.get("ports") if isinstance(result, dict) else None
        if not isinstance(result, dict) or result.get("ok") is not True or not isinstance(raw_ports, list):
            fail(502, _failure(result))
        ports = []
        seen = set()
        for item in raw_ports:
            if (not isinstance(item, dict) or set(item) != {"interface", "description"} or
                    not isinstance(item["interface"], str) or not INTERFACE.fullmatch(item["interface"]) or
                    not isinstance(item["description"], str) or len(item["description"]) > 128 or
                    "\r" in item["description"] or "\n" in item["description"] or item["interface"] in seen):
                fail(502, _failure(result))
            seen.add(item["interface"])
            ports.append({"interface": item["interface"], "description": item["description"]})
        ports.sort(key=lambda item: item["interface"])
        tickets = {item["interface"]: _ticket(app, user_id=g.user["id"], host=value["host"], username=value["username"], interface=item["interface"]) for item in ports}
        return jsonify(host=value["host"], errDisabledPorts=ports, recoveryTickets=tickets)

    @app.post("/api/equipment/recover")
    def equipment_recover():
        authorize()
        try:
            value = _input(data(), recovery=True)
        except ValueError:
            fail(400, "درخواست بازیابی معتبر نیست.")
        if not _verify_ticket(app, value.pop("ticket"), user_id=g.user["id"], host=value["host"], username=value["username"], interface=value["interface"]):
            fail(409, "تأیید بررسی این پورت منقضی شده است؛ ابتدا وضعیت را دوباره بررسی کنید.")
        result = _execute(app, {"operation": "recover", **value})
        if result.get("ok") is not True or result.get("recovery") not in {"recovered", "still_errdisabled", "not_errdisabled"}:
            fail(502, _failure(result))
        return jsonify(host=value["host"], interface=value["interface"], recovery=result["recovery"])
