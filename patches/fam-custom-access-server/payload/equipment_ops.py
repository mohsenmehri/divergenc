"""Bounded Equipment Management API for FAM.

The browser submits device credentials over its existing HTTPS FAM session.
The FAM server itself then opens one direct, bounded SSH session to the device
through the one-shot ``equipment_probe.py`` helper (Windows OpenSSH ssh.exe).
No device credential, job, or CLI output is stored in FAM's database, files,
URL, command line, or normal logs.  No connector broker or connector endpoints are registered.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time

from flask import g, jsonify
try:
    from .equipment_probe import descriptions_table, ProbeError, ENV_PASSTHROUGH
    from .equipment_guard import EquipmentGuard, AdmissionError
except ImportError:
    from equipment_probe import descriptions_table, ProbeError, ENV_PASSTHROUGH
    from equipment_guard import EquipmentGuard, AdmissionError

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
# Same allowlist as equipment_probe.USERNAME: the name is passed to ssh.exe -l
# and echoed into the askpass prompt, so control/option-like input is refused here.
USERNAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@\\-]{0,63}\Z")
# Outer wall clock for the helper process per operation.  It must exceed
# equipment_probe.HELPER_DEADLINE (30 / 85 s) so the backend never kills the
# helper while it is still supervising an ssh.exe child.
EXECUTOR_TIMEOUT = {"status": 40, "inspect": 65, "descriptions": 40, "recover": 95}
# RFC1918 plus the user-authorized building/shared-address range (RFC6598).
# Deliberately not all of 100/8 or arbitrary public targets.
ALLOWED_IPV4_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"))


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
    if not isinstance(address, ipaddress.IPv4Address) or not any(address in network for network in ALLOWED_IPV4_NETWORKS):
        raise ValueError
    username = username.strip()
    if not USERNAME.fullmatch(username) or not 1 <= len(password) <= 512:
        raise ValueError
    # The password only ever travels through an environment variable into the
    # ssh.exe child; keep it to printable ASCII so no code-page translation or
    # control character can alter it on the way.
    if not all(0x20 <= ord(char) <= 0x7E for char in password):
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
    payload = json.dumps({"u": user_id, "h": host, "n": user_digest, "i": interface, "e": int(time.time()) + 300, "j": secrets.token_hex(16)}, separators=(",", ":"), sort_keys=True).encode("utf-8")
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
            decoded == {"u": user_id, "h": host, "n": user_digest, "i": interface, "e": decoded.get("e"), "j": decoded.get("j")} and
            type(decoded.get("e")) is int and int(time.time()) <= decoded["e"] <= int(time.time())+300 and
            isinstance(decoded.get("j"),str) and re.fullmatch(r"[a-f0-9]{32}",decoded["j"]) is not None)


def _helper_environment(app):
    """Environment for the helper: minimal allowlisted OS environment plus the
    explicit ssh.exe / host-key settings.  No device credential is placed here;
    the helper receives the job on stdin only."""
    env = {key:os.environ[key] for key in ENV_PASSTHROUGH if key in os.environ}
    for key, name in (("EQUIPMENT_SSH", "FAM_EQUIPMENT_SSH"), ("EQUIPMENT_KNOWN_HOSTS", "FAM_EQUIPMENT_KNOWN_HOSTS"),
                      ("EQUIPMENT_HOST_KEY_POLICY", "FAM_EQUIPMENT_HOST_KEY_POLICY"), ("EQUIPMENT_RUNTIME_DIR", "FAM_EQUIPMENT_RUNTIME_DIR")):
        value = app.config.get(key)
        if value:
            env[name] = str(value)
    return env


def _execute(app, payload):
    override = app.config.get("EQUIPMENT_EXECUTOR")
    if override is not None:
        return override(payload)
    executable = Path(app.config["EQUIPMENT_PYTHON"])
    helper = Path(app.config["EQUIPMENT_HELPER"])
    if not executable.is_file() or not helper.is_file():
        return {"ok": False, "error": "connection_failed"}
    timeout = EXECUTOR_TIMEOUT.get(payload.get("operation"), EXECUTOR_TIMEOUT["status"])
    try:
        completed = subprocess.run(
            [str(executable), str(helper)], input=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False, env=_helper_environment(app),
        )
        result = json.loads(completed.stdout.decode("utf-8"))
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "recovery_uncertain" if payload.get("operation")=="recover" else "connection_timeout"}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "error": "recovery_uncertain" if payload.get("operation")=="recover" else "connection_failed"}
    return result if isinstance(result, dict) else {"ok": False, "error": "connection_failed"}


def _failure(value):
    code = value.get("error") if isinstance(value, dict) else ""
    return {
        "recovery_uncertain": "اثر عملیات روی پورت نامشخص است؛ ممکن است shutdown اجرا شده باشد. عملیات متوقف شد؛ پیش از هر اقدام، وضعیت همان پورت را با اپراتور مجاز بررسی کنید. فعال‌سازی خودکار انجام نمی‌شود.",
        "equipment_busy": "تجهیز یا ظرفیت SSH مشغول است؛ عملیات جدیدی اجرا نشد. پس از پایان درخواست قبلی، دوباره وضعیت را بررسی کنید.",
        "ticket_consumed": "این تأیید قبلاً مصرف شده است؛ دوباره بررسی و پورت را تأیید کنید.",
        "authentication_failed": "نام کاربری یا رمز تجهیز پذیرفته نشد.",
        "connection_timeout": "اتصال SSH به تجهیز در زمان مجاز پاسخ نداد.",
        "connection_failed": "بررسی تجهیز انجام نشد؛ دسترسی SSH و وضعیت تجهیز را بررسی کنید.",
        "descriptions_unreadable": "خروجی show int des کامل یا قابل تأیید نیست؛ متن خام دیگری نمایش داده نمی‌شود.",
        "status_unreadable": "اتصال انجام شد اما جدول کامل وضعیت پورت‌ها قابل تأیید نیست؛ وضعیت نامشخص است، نه بدون خطا.",
    }.get(code, "بررسی تجهیز انجام نشد.")


def _ports_or_fail(result, fail):
    if isinstance(result,dict) and result.get('error')=='equipment_busy':fail(429,_failure(result))
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
    return sorted(ports, key=lambda item: item["interface"])


def register_equipment_ops(app, *, data, fail, allowed):
    """Register authenticated browser endpoints for direct server-to-device SSH."""

    guard = EquipmentGuard(app.config['DB_PATH'])
    app.extensions['equipment_guard'] = guard

    def run(payload, ticket=None):
        try:
            with guard.admit(payload['host'],ticket):
                return _execute(app,payload)
        except AdmissionError as error:
            return {'ok':False,'error':error.code}

    def authorize(operation=None,host=None):
        if not app.config["EQUIPMENT_OPS_ENABLED"]:
            fail(404, "مدیریت تجهیزات فعال نشده است.")
        if not allowed(g.user,operation=operation,host=host):
            fail(403, "مجوز مدیریت تجهیزات لازم است.")

    @app.post("/api/equipment/check")
    def equipment_check():
        authorize()
        try:
            value = _input(data())
        except ValueError:
            fail(400, "IP داخلی مجاز، نام کاربری و رمز تجهیز معتبر نیست.")
        authorize("status",value["host"])
        result = run({"operation": "status", **value})
        ports = _ports_or_fail(result, fail)
        tickets = {item["interface"]: _ticket(app, user_id=g.user["id"], host=value["host"], username=value["username"], interface=item["interface"]) for item in ports}
        return jsonify(host=value["host"], source="server-ssh", checkedAt=int(time.time()*1000), errDisabledPorts=ports, recoveryTickets=tickets)

    @app.post('/api/equipment/inspect')
    def equipment_inspect():
        authorize('status')
        try:value=_input(data())
        except ValueError:fail(400,'IP داخلی مجاز، نام کاربری و رمز تجهیز معتبر نیست.')
        authorize('status',value['host'])
        result=run({'operation':'inspect',**value})
        ports=_ports_or_fail(result,fail)
        description={'error':_failure({'error':'descriptions_unreadable'})}
        raw=result.get('descriptions')
        if isinstance(raw,dict) and raw.get('ok') is True:
            try:
                output,redacted=descriptions_table(raw.get('output'),value['username'],value['password'])
                description={'output':output,'redacted':redacted or raw.get('redacted') is True}
            except ProbeError:pass
        timings=result.get('timings',{})
        timings={k:timings[k] for k in ('preparationMs','sshMs') if isinstance(timings,dict) and type(timings.get(k)) is int and 0<=timings[k]<=65000}
        return jsonify(host=value['host'],source='server-ssh',checkedAt=int(time.time()*1000),errDisabledPorts=ports,
            recoveryTickets={p['interface']:_ticket(app,user_id=g.user['id'],host=value['host'],username=value['username'],interface=p['interface']) for p in ports},
            descriptions=description,timings=timings)

    @app.post('/api/equipment/descriptions')
    def equipment_descriptions():
        authorize('descriptions')
        try:value=_input(data())
        except ValueError:fail(400,'IP داخلی مجاز، نام کاربری و رمز تجهیز معتبر نیست.')
        authorize('descriptions',value['host'])
        result=run({'operation':'descriptions',**value})
        if not isinstance(result,dict) or result.get('ok') is not True:fail(429 if isinstance(result,dict) and result.get('error')=='equipment_busy' else 502,_failure(result))
        try:output,redacted=descriptions_table(result.get('output'),value['username'],value['password'])
        except ProbeError:fail(502,_failure({'error':'descriptions_unreadable'}))
        return jsonify(host=value['host'],source='server-ssh',checkedAt=int(time.time()*1000),command='show interfaces description',output=output,redacted=redacted or result.get('redacted') is True)

    @app.post("/api/equipment/recover")
    def equipment_recover():
        authorize("recover")
        try:
            value = _input(data(), recovery=True)
        except ValueError:
            fail(400, "درخواست بازیابی معتبر نیست.")
        authorize("recover",value["host"])
        ticket=value.pop("ticket")
        if not _verify_ticket(app, ticket, user_id=g.user["id"], host=value["host"], username=value["username"], interface=value["interface"]):
            fail(409, "تأیید بررسی این پورت منقضی شده است؛ ابتدا وضعیت را دوباره بررسی کنید.")
        result = run({"operation": "recover", **value},ticket)
        if not isinstance(result, dict) or result.get("ok") is not True or result.get("recovery") not in {"recovered", "still_errdisabled", "not_errdisabled"}:
            code=result.get('error') if isinstance(result,dict) else None
            code=code if code in {'equipment_busy','ticket_consumed'} else 'recovery_uncertain'
            return jsonify(error=_failure({'error':code}),code=code,requiresRecheck=True), (409 if code=='ticket_consumed' else 429 if code=='equipment_busy' else 502)
        return jsonify(host=value["host"], interface=value["interface"], recovery=result["recovery"])
