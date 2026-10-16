"""Controlled Network Operations control-plane endpoints.

FAM itself has no SSH implementation and never stores a management address,
password, enable secret, RADIUS secret, SNMP community, or raw CLI output. A
Worker on the managed server owns connections and DPAPI-protected keys.

The exposed surface is deliberately narrow: fixed Cisco IOS discovery plus one
human-confirmed ``errdisabled_recovery`` for an interface previously reported
by that exact discovery job. There is no terminal, command text, global config,
auto-remediation, or configuration-save endpoint.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid

from flask import g, jsonify, redirect, request, send_file


IDENTIFIER = re.compile(r"[a-z][a-z0-9._-]{1,63}")
NAME = re.compile(r"[^\r\n]{1,80}")
INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
ERROR_CODES = {
    "authentication_failed",
    "command_failed",
    "connection_failed",
    "local_inventory_missing",
    "precheck_failed",
    "recovery_failed",
    "timeout",
    "unsupported_platform",
    "worker_error",
}
RESULT_STATUSES = {"succeeded", "failed"}
COHOSTED_WORKER_ID = "worker-fam-local"
COHOSTED_WORKER_NAME = "FAM Co-hosted Local Service Worker"
MAX_RESULT_TEXT = 120


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _millis():
    return int(time.time() * 1000)


def _text(value, label, *, maximum=80, identifier=False, required=True):
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValueError(label)
    value = value.strip()
    valid = bool(IDENTIFIER.fullmatch(value)) if identifier else bool(NAME.fullmatch(value))
    if not valid or len(value) > maximum:
        raise ValueError(label)
    return value


def _fact_text(value, label):
    if not isinstance(value, str) or not value or len(value) > MAX_RESULT_TEXT or "\n" in value or "\r" in value:
        raise ValueError(label)
    return value.strip()


def _public_device(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "siteId": row["site_id"],
        "groupId": row["group_id"] or None,
        "platform": row["platform"],
        "enabled": bool(row["enabled"]),
        "lab": bool(row["lab"]),
        "lastScanAt": row["last_scan_at"],
        "lastStatus": row["last_status"],
    }


def _public_worker(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "enabled": bool(row["enabled"]),
        "interactiveProbeReady": bool(row["probe_public_key"]),
        "probeKeyFingerprint": row["probe_key_fingerprint"],
        "createdAt": row["created_at"],
        "lastSeenAt": row["last_seen_at"],
    }


def _public_job(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "siteId": row["site_id"],
        "groupId": row["group_id"] or None,
        "deviceIds": json.loads(row["device_ids"]),
        "status": row["status"],
        "requestedBy": row["requested_by"],
        "createdAt": row["created_at"],
        "claimedAt": row["claimed_at"],
        "finishedAt": row["finished_at"],
        "workerId": row["worker_id"],
        "resultCount": row["result_count"],
        "failureCount": row["failure_count"],
        # The encrypted envelope is deliberately never returned to a browser.
        "interactive": bool(row["interactive"]),
        "operation": row["operation"],
        "sourceJobId": row["source_job_id"],
        "targetInterface": row["target_interface"],
    }


def _public_result(row):
    return {
        "deviceId": row["device_id"],
        "status": row["status"],
        "collectedAt": row["collected_at"],
        "facts": json.loads(row["facts"]),
        "warnings": json.loads(row["warnings"]),
        "error": row["error"],
    }


def _device_input(value):
    """Validate safe control-plane metadata only.

    Explicitly rejecting unknown keys is important here: it prevents a browser
    client from turning the FAM database into a host/credential vault by adding
    fields such as host, address, password, secret, command, or rawOutput.
    """
    if not isinstance(value, dict) or set(value) - {"id", "name", "siteId", "groupId", "enabled", "lab", "platform"}:
        raise ValueError("مشخصات تجهیز")
    ident = _text(value.get("id"), "شناسه تجهیز", identifier=True)
    name = _text(value.get("name"), "نام تجهیز")
    site_id = _text(value.get("siteId"), "شناسه سایت", identifier=True)
    group_id = _text(value.get("groupId"), "شناسه گروه", identifier=True, required=False)
    enabled = value.get("enabled", True)
    lab = value.get("lab", True)
    platform = value.get("platform", "cisco_ios")
    if type(enabled) is not bool or type(lab) is not bool or platform != "cisco_ios":
        raise ValueError("مشخصات تجهیز")
    # Production-wide polling is intentionally not an option in this release.
    if not lab:
        raise ValueError("این نسخه فقط تجهیزات اعتبارسنجی آزمایشگاهی را می‌پذیرد.")
    return {
        "id": ident,
        "name": name,
        "siteId": site_id,
        "groupId": group_id,
        "enabled": enabled,
        "lab": lab,
        "platform": platform,
    }


def _probe_public_key(value):
    """Validate an opaque Worker public key without accepting private key data."""
    if (not isinstance(value, str) or len(value) > 4096 or
            not value.startswith("-----BEGIN PUBLIC KEY-----\n") or
            not value.endswith("-----END PUBLIC KEY-----\n")):
        raise ValueError("کلید رمزنگاری Worker")
    body = "".join(value.splitlines()[1:-1])
    try:
        decoded = base64.b64decode(body, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("کلید رمزنگاری Worker") from exc
    if len(decoded) < 256:
        raise ValueError("کلید رمزنگاری Worker")
    return value, hashlib.sha256(value.encode("ascii")).hexdigest()


def _sealed_probe(value, fingerprint):
    """Accept only an opaque browser-to-Worker encrypted payload.

    FAM validates the envelope shape and the Worker's current public-key
    fingerprint, but never receives a decryptable IP address or credential.
    """
    allowed = {"algorithm", "keyFingerprint", "encryptedKey", "iv", "ciphertext"}
    if not isinstance(value, dict) or set(value) != allowed or value.get("algorithm") != "RSA-OAEP-256/AES-256-GCM":
        raise ValueError("درخواست رمزگذاری‌شده")
    if value.get("keyFingerprint") != fingerprint:
        raise ValueError("کلید Worker تغییر کرده است؛ صفحه را دوباره باز کنید.")
    for key, minimum, maximum in (("encryptedKey", 500, 520), ("iv", 16, 20), ("ciphertext", 24, 4096)):
        item = value.get(key)
        if not isinstance(item, str) or not minimum <= len(item) <= maximum or not re.fullmatch(r"[A-Za-z0-9_-]+", item):
            raise ValueError("درخواست رمزگذاری‌شده")
    return value


def _result_input(value):
    if not isinstance(value, dict) or set(value) != {"deviceId", "status", "facts", "warnings", "error"}:
        raise ValueError("نتیجهٔ Worker")
    device_id = _text(value.get("deviceId"), "شناسه تجهیز", identifier=True)
    status = value.get("status")
    error = value.get("error")
    if status not in RESULT_STATUSES or (error is not None and error not in ERROR_CODES):
        raise ValueError("نتیجهٔ Worker")
    if status == "succeeded" and error is not None:
        raise ValueError("نتیجهٔ Worker")
    if status == "failed" and error not in ERROR_CODES:
        raise ValueError("نتیجهٔ Worker")

    facts = value.get("facts")
    if not isinstance(facts, dict) or set(facts) - {"hostname", "model", "osVersion", "interfaces", "recovery"}:
        raise ValueError("دادهٔ Inventory")
    normalized_facts = {}
    for key in ("hostname", "model", "osVersion"):
        if key in facts:
            normalized_facts[key] = _fact_text(facts[key], "دادهٔ Inventory")
    if "interfaces" in facts:
        interfaces = facts["interfaces"]
        if not isinstance(interfaces, dict) or set(interfaces) - {"total", "up", "down", "errDisabled", "errDisabledPorts"}:
            raise ValueError("دادهٔ Inventory")
        normalized_interfaces = {}
        for key in ("total", "up", "down", "errDisabled"):
            if key in interfaces:
                number = interfaces[key]
                if type(number) is not int or number < 0 or number > 100000:
                    raise ValueError("دادهٔ Inventory")
                normalized_interfaces[key] = number
        if "errDisabledPorts" in interfaces:
            ports = interfaces["errDisabledPorts"]
            if not isinstance(ports, list) or len(ports) > 128:
                raise ValueError("دادهٔ Inventory")
            normalized_ports = []
            for port in ports:
                if not isinstance(port, dict) or set(port) != {"name"} or not isinstance(port.get("name"), str) or not INTERFACE.fullmatch(port["name"]):
                    raise ValueError("دادهٔ Inventory")
                normalized_ports.append({"name": port["name"]})
            if len({item["name"] for item in normalized_ports}) != len(normalized_ports):
                raise ValueError("دادهٔ Inventory")
            normalized_interfaces["errDisabledPorts"] = normalized_ports
        normalized_facts["interfaces"] = normalized_interfaces
    if "recovery" in facts:
        recovery = facts["recovery"]
        if (not isinstance(recovery, dict) or set(recovery) != {"interface", "status"} or
                not isinstance(recovery.get("interface"), str) or not INTERFACE.fullmatch(recovery["interface"]) or
                recovery.get("status") not in {"recovered", "not_completed"}):
            raise ValueError("دادهٔ بازیابی")
        normalized_facts["recovery"] = {"interface": recovery["interface"], "status": recovery["status"]}

    warnings = value.get("warnings")
    if not isinstance(warnings, list) or len(warnings) > 12:
        raise ValueError("هشدارهای Inventory")
    normalized_warnings = []
    for warning in warnings:
        if not isinstance(warning, str) or not warning.strip() or len(warning) > 160 or "\n" in warning or "\r" in warning:
            raise ValueError("هشدارهای Inventory")
        normalized_warnings.append(warning.strip())
    return {
        "deviceId": device_id,
        "status": status,
        "facts": normalized_facts,
        "warnings": normalized_warnings,
        "error": error,
    }


def register_network_ops(app, *, connect, transaction, data, fail, can_read_network, can_write_network, page_session):
    """Attach the Network Operations API to the FAM control plane.

    ``connect`` and ``transaction`` are supplied by ``server.app`` so this
    module uses the same SQLite locking, database location, and lifetime rules
    as the existing FAM service without importing its Flask application.
    """
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS network_settings(
              id INTEGER PRIMARY KEY CHECK(id=1), inventory_revision INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS network_devices(
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              site_id TEXT NOT NULL,
              group_id TEXT NOT NULL DEFAULT '',
              platform TEXT NOT NULL CHECK(platform='cisco_ios'),
              enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
              lab INTEGER NOT NULL CHECK(lab IN (0,1)),
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              last_scan_at INTEGER,
              last_status TEXT
            );
            CREATE INDEX IF NOT EXISTS network_devices_scope ON network_devices(site_id,group_id,enabled);
            CREATE TABLE IF NOT EXISTS network_workers(
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              token_hash TEXT NOT NULL,
              enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
              created_by TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_seen_at INTEGER,
              probe_public_key TEXT,
              probe_key_fingerprint TEXT
            );
            CREATE TABLE IF NOT EXISTS network_jobs(
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL CHECK(kind='read_only_inventory'),
              site_id TEXT NOT NULL,
              group_id TEXT NOT NULL DEFAULT '',
              device_ids TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','cancelled')),
              requested_by TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              claimed_at INTEGER,
              lease_expires_at INTEGER,
              finished_at INTEGER,
              worker_id TEXT,
              result_count INTEGER NOT NULL DEFAULT 0,
              failure_count INTEGER NOT NULL DEFAULT 0,
              sealed_payload TEXT,
              interactive INTEGER NOT NULL DEFAULT 0 CHECK(interactive IN (0,1)),
              operation TEXT NOT NULL DEFAULT 'inventory',
              source_job_id TEXT,
              target_interface TEXT
            );
            CREATE INDEX IF NOT EXISTS network_jobs_queue ON network_jobs(status,created_at);
            CREATE TABLE IF NOT EXISTS network_results(
              job_id TEXT NOT NULL REFERENCES network_jobs(id) ON DELETE CASCADE,
              device_id TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('succeeded','failed')),
              collected_at INTEGER NOT NULL,
              facts TEXT NOT NULL,
              warnings TEXT NOT NULL,
              error TEXT,
              PRIMARY KEY(job_id,device_id)
            );
            CREATE TABLE IF NOT EXISTS network_events(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at INTEGER NOT NULL,
              actor TEXT NOT NULL,
              action TEXT NOT NULL,
              job_id TEXT,
              detail TEXT NOT NULL
            );
            """
        )
        # Existing phase-one databases predate direct interactive probes. These
        # additive migrations preserve the original job schema and never add a
        # plaintext endpoint, IP, or credential column.
        worker_columns = {row["name"] for row in db.execute("PRAGMA table_info(network_workers)")}
        if "probe_public_key" not in worker_columns:
            db.execute("ALTER TABLE network_workers ADD COLUMN probe_public_key TEXT")
        if "probe_key_fingerprint" not in worker_columns:
            db.execute("ALTER TABLE network_workers ADD COLUMN probe_key_fingerprint TEXT")
        job_columns = {row["name"] for row in db.execute("PRAGMA table_info(network_jobs)")}
        if "sealed_payload" not in job_columns:
            db.execute("ALTER TABLE network_jobs ADD COLUMN sealed_payload TEXT")
        if "interactive" not in job_columns:
            db.execute("ALTER TABLE network_jobs ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0")
        if "operation" not in job_columns:
            db.execute("ALTER TABLE network_jobs ADD COLUMN operation TEXT NOT NULL DEFAULT 'inventory'")
        if "source_job_id" not in job_columns:
            db.execute("ALTER TABLE network_jobs ADD COLUMN source_job_id TEXT")
        if "target_interface" not in job_columns:
            db.execute("ALTER TABLE network_jobs ADD COLUMN target_interface TEXT")
        db.execute("INSERT OR IGNORE INTO network_settings VALUES(1,0)")
        # Phase 1 is a single co-hosted Worker on the FAM server.  It has no
        # browser-visible pairing secret and no independent named account.
        # Any old manually paired rows are disabled: they cannot claim jobs or
        # register a key after this migration.
        if app.config.get("NETWORK_OPS_ENABLED", False):
            now = _millis()
            db.execute("UPDATE network_workers SET enabled=0 WHERE id<>?", (COHOSTED_WORKER_ID,))
            row = db.execute("SELECT id FROM network_workers WHERE id=?", (COHOSTED_WORKER_ID,)).fetchone()
            if row:
                db.execute("UPDATE network_workers SET name=?,enabled=1 WHERE id=?", (COHOSTED_WORKER_NAME, COHOSTED_WORKER_ID))
            else:
                db.execute(
                    "INSERT INTO network_workers(id,name,token_hash,enabled,created_by,created_at) VALUES(?,?,?,?,?,?)",
                    (COHOSTED_WORKER_ID, COHOSTED_WORKER_NAME, "cohosted-loopback-only", 1, "system", now),
                )

    def enabled():
        if not app.config.get("NETWORK_OPS_ENABLED", False):
            fail(404, "عملیات شبکه در این استقرار فعال نشده است.")

    def read_access():
        enabled()
        if not can_read_network(g.user):
            fail(403, "مجوز مشاهدهٔ گزارش عملیات شبکه لازم است.")

    def write_access():
        enabled()
        if not can_write_network(g.user):
            fail(403, "مجوز مدیریت عملیات شبکه لازم است.")

    def event(db, actor, action, *, job_id=None, detail=""):
        db.execute(
            "INSERT INTO network_events(at,actor,action,job_id,detail) VALUES(?,?,?,?,?)",
            (_millis(), actor, action, job_id, detail[:200]),
        )

    def inventory_revision(db):
        return db.execute("SELECT inventory_revision FROM network_settings WHERE id=1").fetchone()[0]

    def release_expired_claims(db):
        now = _millis()
        expired = db.execute(
            "SELECT id,worker_id FROM network_jobs WHERE status='claimed' AND lease_expires_at<?", (now,)
        ).fetchall()
        for row in expired:
            db.execute(
                "UPDATE network_jobs SET status='queued',worker_id=NULL,claimed_at=NULL,lease_expires_at=NULL WHERE id=?",
                (row["id"],),
            )
            event(db, row["worker_id"] or "worker", "job_lease_expired", job_id=row["id"])

    def internal_worker_auth(db):
        """Authenticate the only supported Worker by an unproxied loopback path.

        IIS deliberately has no rewrite for /_internal.  A browser can reach
        only /api via HTTPS; this route is reachable only by a process on the
        FAM host connecting to 127.0.0.1:8765.  This removes manual Bearer
        token handling without making a browser-facing Worker API public.
        """
        enabled()
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            fail(403, "این endpoint فقط برای Worker داخلی سرور است.")
        worker_id = request.headers.get("X-FAM-Worker-ID", "")
        if worker_id != COHOSTED_WORKER_ID:
            fail(401, "Worker داخلی معتبر نیست.")
        row = db.execute("SELECT * FROM network_workers WHERE id=? AND enabled=1", (COHOSTED_WORKER_ID,)).fetchone()
        if not row:
            fail(401, "Worker داخلی فعال نیست.")
        db.execute("UPDATE network_workers SET last_seen_at=? WHERE id=?", (_millis(), COHOSTED_WORKER_ID))
        return row

    @app.get("/network-operations")
    def network_operations_page():
        # Keep every operational UI behind the same FAM session boundary as
        # the main spreadsheet. The page has no secrets, but it is not a public
        # static asset and all of its data calls stay server-authorised.
        if not page_session():return redirect('/login.html',code=302)
        return send_file(app.root_path + "/network_operations.html", mimetype="text/html", max_age=0, conditional=False)

    @app.get("/api/network/overview")
    def network_overview():
        read_access()
        with connect() as db:
            devices = [_public_device(row) for row in db.execute("SELECT * FROM network_devices ORDER BY site_id,group_id,name")]
            jobs = [_public_job(row) for row in db.execute("SELECT * FROM network_jobs ORDER BY created_at DESC LIMIT 100")]
            return jsonify(enabled=True, inventoryRevision=inventory_revision(db), devices=devices, jobs=jobs)

    @app.get("/api/network/workers")
    def network_workers():
        write_access()
        with connect() as db:
            return jsonify(workers=[_public_worker(row) for row in db.execute("SELECT * FROM network_workers WHERE id=?", (COHOSTED_WORKER_ID,))])

    @app.get("/api/network/workers/<worker_id>/probe-key")
    def network_worker_probe_key(worker_id):
        write_access()
        if not IDENTIFIER.fullmatch(worker_id):
            fail(404, "Worker پیدا نشد.")
        with connect() as db:
            row = db.execute("SELECT * FROM network_workers WHERE id=? AND enabled=1", (worker_id,)).fetchone()
            if not row or not row["probe_public_key"] or not row["probe_key_fingerprint"]:
                fail(409, "کلید رمزنگاری این Worker هنوز آماده نیست.")
            return jsonify(workerId=worker_id, publicKey=row["probe_public_key"], fingerprint=row["probe_key_fingerprint"])

    @app.post("/_internal/network/workers/<worker_id>/probe-key")
    def register_network_worker_probe_key(worker_id):
        body = data()
        if set(body) != {"publicKey"} or not IDENTIFIER.fullmatch(worker_id):
            fail(400, "کلید رمزنگاری Worker نامعتبر است.")
        try:
            public_key, fingerprint = _probe_public_key(body["publicKey"])
        except ValueError:
            fail(400, "کلید رمزنگاری Worker نامعتبر است.")
        with transaction() as db:
            worker = internal_worker_auth(db)
            if worker["id"] != worker_id:
                fail(403, "Worker داخلی فقط می‌تواند کلید خود را ثبت کند.")
            db.execute(
                "UPDATE network_workers SET probe_public_key=?,probe_key_fingerprint=? WHERE id=?",
                (public_key, fingerprint, worker_id),
            )
            event(db, worker_id, "worker_probe_key_registered", detail=fingerprint)
            return jsonify(workerId=worker_id, fingerprint=fingerprint)

    @app.post("/api/network/probes")
    def enqueue_interactive_probe():
        """Queue one browser-encrypted, read-only Cisco IOS err-disabled check."""
        write_access()
        body = data()
        if set(body) != {"workerId", "sealed"} or not isinstance(body.get("workerId"), str) or not IDENTIFIER.fullmatch(body["workerId"]):
            fail(400, "درخواست بررسی مستقیم نامعتبر است.")
        with transaction() as db:
            release_expired_claims(db)
            worker = db.execute("SELECT * FROM network_workers WHERE id=? AND enabled=1", (body["workerId"],)).fetchone()
            if not worker or not worker["probe_public_key"] or not worker["probe_key_fingerprint"]:
                fail(409, "Worker انتخاب‌شده برای بررسی مستقیم آماده نیست.")
            try:
                sealed = _sealed_probe(body["sealed"], worker["probe_key_fingerprint"])
            except ValueError as exc:
                fail(400, str(exc))
            # One interactive credential-bearing check per Worker at a time
            # keeps its time window and blast radius deliberately small.
            active_rows = db.execute(
                "SELECT sealed_payload FROM network_jobs WHERE status IN ('queued','claimed') AND sealed_payload IS NOT NULL"
            ).fetchall()
            for active in active_rows:
                try:
                    if json.loads(active["sealed_payload"]).get("workerId") == worker["id"]:
                        fail(409, "یک بررسی مستقیم دیگر برای این Worker در حال انجام است.")
                except (json.JSONDecodeError, AttributeError):
                    fail(409, "یک بررسی مستقیم دیگر برای این Worker در حال انجام است.")
            job_id = "job_" + uuid.uuid4().hex
            device_id = "probe-" + uuid.uuid4().hex
            now = _millis()
            sealed_payload = _json({"workerId": worker["id"], "sealed": sealed})
            db.execute(
                """INSERT INTO network_jobs(id,kind,site_id,group_id,device_ids,status,requested_by,created_at,sealed_payload,interactive,operation)
                   VALUES(?,?,?,?,?,'queued',?,?,?,1,'interactive_probe')""",
                (job_id, "read_only_inventory", "interactive", "", _json([device_id]), g.user["username"], now, sealed_payload),
            )
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            # The audit contains only a generated probe ID, never an address or
            # credential, and the sealed envelope cannot be rendered by FAM.
            event(db, g.user["username"], "interactive_read_only_probe_queued", job_id=job_id, detail=device_id)
            return jsonify(job=_public_job(row)), 201

    @app.post("/api/network/recoveries")
    def enqueue_errdisabled_recovery():
        """Queue a single human-confirmed recovery for a reported interface."""
        write_access()
        body = data()
        allowed = {"workerId", "sourceJobId", "deviceId", "interface", "sealed"}
        if set(body) != allowed or not all(isinstance(body.get(key), str) for key in ("workerId", "sourceJobId", "deviceId", "interface")):
            fail(400, "درخواست رفع Err-disabled نامعتبر است.")
        if (not IDENTIFIER.fullmatch(body["workerId"]) or not body["sourceJobId"].startswith("job_") or
                not IDENTIFIER.fullmatch(body["deviceId"]) or not INTERFACE.fullmatch(body["interface"])):
            fail(400, "درخواست رفع Err-disabled نامعتبر است.")
        with transaction() as db:
            release_expired_claims(db)
            worker = db.execute("SELECT * FROM network_workers WHERE id=? AND enabled=1", (body["workerId"],)).fetchone()
            source = db.execute("SELECT * FROM network_jobs WHERE id=?", (body["sourceJobId"],)).fetchone()
            if (not worker or not worker["probe_public_key"] or not worker["probe_key_fingerprint"] or not source or
                    source["status"] != "completed" or source["operation"] != "interactive_probe" or source["worker_id"] != worker["id"]):
                fail(409, "منبع معتبر برای رفع Err-disabled یافت نشد.")
            result = db.execute(
                "SELECT * FROM network_results WHERE job_id=? AND device_id=? AND status='succeeded'",
                (source["id"], body["deviceId"]),
            ).fetchone()
            if not result:
                fail(409, "نتیجهٔ موفقی برای تجهیز انتخاب‌شده وجود ندارد.")
            try:
                facts = json.loads(result["facts"])
                ports = facts.get("interfaces", {}).get("errDisabledPorts", [])
                reported = {item["name"] for item in ports if isinstance(item, dict) and isinstance(item.get("name"), str)}
            except (TypeError, json.JSONDecodeError, AttributeError):
                reported = set()
            if body["interface"] not in reported:
                fail(409, "این پورت در نتیجهٔ Err-disabled همان Job گزارش نشده است.")
            try:
                sealed = _sealed_probe(body["sealed"], worker["probe_key_fingerprint"])
            except ValueError as exc:
                fail(400, str(exc))
            active_rows = db.execute(
                "SELECT sealed_payload FROM network_jobs WHERE status IN ('queued','claimed') AND sealed_payload IS NOT NULL"
            ).fetchall()
            for active in active_rows:
                try:
                    if json.loads(active["sealed_payload"]).get("workerId") == worker["id"]:
                        fail(409, "یک بررسی یا بازیابی دیگر برای این Worker در حال انجام است.")
                except (json.JSONDecodeError, AttributeError):
                    fail(409, "یک بررسی یا بازیابی دیگر برای این Worker در حال انجام است.")
            job_id = "job_" + uuid.uuid4().hex
            now = _millis()
            sealed_payload = _json({"workerId": worker["id"], "sealed": sealed})
            db.execute(
                """INSERT INTO network_jobs(id,kind,site_id,group_id,device_ids,status,requested_by,created_at,sealed_payload,interactive,operation,source_job_id,target_interface)
                   VALUES(?,?,?,?,?,'queued',?,?,?,1,'errdisabled_recovery',?,?)""",
                (job_id, "read_only_inventory", "interactive", "", _json([body["deviceId"]]), g.user["username"], now,
                 sealed_payload, source["id"], body["interface"]),
            )
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            event(db, g.user["username"], "errdisabled_recovery_queued", job_id=job_id, detail=body["interface"])
            return jsonify(job=_public_job(row)), 201

    @app.post("/api/network/inventory")
    def save_network_device():
        write_access()
        body = data()
        if set(body) != {"revision", "device"} or type(body["revision"]) is not int:
            fail(400, "درخواست Inventory نامعتبر است.")
        try:
            device = _device_input(body["device"])
        except ValueError as exc:
            fail(400, f"{exc} نامعتبر است.")
        with transaction() as db:
            if body["revision"] != inventory_revision(db):
                fail(409, "Inventory توسط کاربر دیگری تغییر کرده است؛ دوباره دریافت کنید.")
            now = _millis()
            existing = db.execute("SELECT id FROM network_devices WHERE id=?", (device["id"],)).fetchone()
            if existing:
                db.execute(
                    """UPDATE network_devices SET name=?,site_id=?,group_id=?,platform=?,enabled=?,lab=?,updated_at=?
                       WHERE id=?""",
                    (
                        device["name"], device["siteId"], device["groupId"], device["platform"],
                        int(device["enabled"]), int(device["lab"]), now, device["id"],
                    ),
                )
                action = "inventory_updated"
            else:
                db.execute(
                    """INSERT INTO network_devices(id,name,site_id,group_id,platform,enabled,lab,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?)""",
                    (
                        device["id"], device["name"], device["siteId"], device["groupId"], device["platform"],
                        int(device["enabled"]), int(device["lab"]), now, now,
                    ),
                )
                action = "inventory_created"
            db.execute("UPDATE network_settings SET inventory_revision=inventory_revision+1 WHERE id=1")
            event(db, g.user["username"], action, detail=device["id"])
            saved = db.execute("SELECT * FROM network_devices WHERE id=?", (device["id"],)).fetchone()
            return jsonify(revision=inventory_revision(db), device=_public_device(saved))

    @app.post("/api/network/workers")
    def provision_network_worker():
        # There is no browser pairing/token workflow in the co-hosted model.
        write_access()
        fail(410, "Worker داخلی به‌صورت خودکار روی همان سرور FAM ثبت می‌شود.")

    @app.post("/api/network/jobs")
    def enqueue_network_job():
        write_access()
        body = data()
        if set(body) - {"siteId", "groupId", "deviceIds"} or "siteId" not in body or "deviceIds" not in body:
            fail(400, "محدودهٔ Scan نامعتبر است.")
        try:
            site_id = _text(body["siteId"], "سایت", identifier=True)
            group_id = _text(body.get("groupId"), "گروه", identifier=True, required=False)
        except ValueError:
            fail(400, "محدودهٔ Scan نامعتبر است.")
        device_ids = body["deviceIds"]
        maximum = min(int(app.config.get("NETWORK_OPS_MAX_LAB_DEVICES", 10)), 10)
        if not isinstance(device_ids, list) or not 1 <= len(device_ids) <= maximum:
            fail(400, "برای این مرحله باید بین ۱ تا ۱۰ تجهیز آزمایشگاهی را صریحاً انتخاب کنید.")
        try:
            normalized_ids = [_text(item, "شناسه تجهیز", identifier=True) for item in device_ids]
        except ValueError:
            fail(400, "محدودهٔ Scan نامعتبر است.")
        if len(set(normalized_ids)) != len(normalized_ids):
            fail(400, "شناسهٔ تجهیز تکراری است.")
        with transaction() as db:
            release_expired_claims(db)
            placeholders = ",".join("?" for _ in normalized_ids)
            rows = db.execute(f"SELECT * FROM network_devices WHERE id IN ({placeholders})", normalized_ids).fetchall()
            if len(rows) != len(normalized_ids):
                fail(400, "یک یا چند تجهیز انتخاب‌شده در Inventory وجود ندارد.")
            for row in rows:
                if not row["enabled"] or not row["lab"] or row["site_id"] != site_id or row["group_id"] != group_id:
                    fail(403, "انتخاب تجهیز با محدودهٔ سایت/گروه و فاز آزمایشگاهی سازگار نیست.")
            # Per-device serialisation: an inventory ID can belong to only one
            # queued/claimed job.  The Worker also never receives a host from FAM.
            active = db.execute("SELECT device_ids FROM network_jobs WHERE status IN ('queued','claimed')").fetchall()
            selected = set(normalized_ids)
            if any(selected.intersection(json.loads(row["device_ids"])) for row in active):
                fail(409, "حداقل یک تجهیز انتخاب‌شده در یک Job فعال دیگر است.")
            job_id = "job_" + uuid.uuid4().hex
            now = _millis()
            db.execute(
                """INSERT INTO network_jobs(id,kind,site_id,group_id,device_ids,status,requested_by,created_at)
                   VALUES(?,?,?,?,?,'queued',?,?)""",
                (job_id, "read_only_inventory", site_id, group_id, _json(normalized_ids), g.user["username"], now),
            )
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            event(db, g.user["username"], "read_only_inventory_queued", job_id=job_id, detail=str(len(normalized_ids)))
            return jsonify(job=_public_job(row)), 201

    @app.get("/api/network/jobs/<job_id>")
    def network_job(job_id):
        read_access()
        with connect() as db:
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                fail(404, "Job پیدا نشد.")
            results = [_public_result(result) for result in db.execute("SELECT * FROM network_results WHERE job_id=? ORDER BY device_id", (job_id,))]
            return jsonify(job=_public_job(row), results=results)

    @app.post("/api/network/jobs/<job_id>/cancel")
    def cancel_network_job(job_id):
        write_access()
        body = data()
        if body:
            fail(400, "درخواست لغو نامعتبر است.")
        with transaction() as db:
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                fail(404, "Job پیدا نشد.")
            if row["status"] != "queued":
                fail(409, "فقط Job در صف قابل لغو است.")
            db.execute("UPDATE network_jobs SET status='cancelled',finished_at=?,sealed_payload=NULL WHERE id=?", (_millis(), job_id))
            updated = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            event(db, g.user["username"], "job_cancelled", job_id=job_id)
            return jsonify(job=_public_job(updated))

    @app.post("/_internal/network/worker/claim")
    def worker_claim_job():
        body = data()
        if body:
            fail(400, "درخواست Worker نامعتبر است.")
        with transaction() as db:
            worker = internal_worker_auth(db)
            release_expired_claims(db)
            rows = db.execute("SELECT * FROM network_jobs WHERE status='queued' ORDER BY created_at").fetchall()
            row = None
            sealed_payload = None
            for candidate in rows:
                if candidate["sealed_payload"]:
                    try:
                        parsed = json.loads(candidate["sealed_payload"])
                    except (TypeError, json.JSONDecodeError):
                        continue
                    if not isinstance(parsed, dict) or parsed.get("workerId") != worker["id"] or not isinstance(parsed.get("sealed"), dict):
                        continue
                    sealed_payload = parsed["sealed"]
                row = candidate
                break
            if not row:
                return jsonify(job=None)
            now = _millis()
            lease_seconds = int(app.config.get("NETWORK_OPS_JOB_LEASE_SECONDS", 600))
            db.execute(
                "UPDATE network_jobs SET status='claimed',worker_id=?,claimed_at=?,lease_expires_at=? WHERE id=? AND status='queued'",
                (worker["id"], now, now + max(60, min(lease_seconds, 3600)) * 1000, row["id"]),
            )
            claimed = db.execute("SELECT * FROM network_jobs WHERE id=?", (row["id"],)).fetchone()
            event(db, worker["id"], "job_claimed", job_id=row["id"])
            # Ordinary jobs carry only IDs. Interactive jobs additionally carry
            # opaque ciphertext plus a pre-authorized operation/interface. The
            # Worker must match all three before it can act.
            job = {
                "id": claimed["id"],
                "kind": claimed["kind"],
                "operation": claimed["operation"],
                "targetInterface": claimed["target_interface"],
                "deviceIds": json.loads(claimed["device_ids"]),
                "leaseSeconds": max(60, min(lease_seconds, 3600)),
            }
            if sealed_payload is not None:
                job["sealed"] = sealed_payload
            return jsonify(job=job)

    @app.post("/_internal/network/worker/jobs/<job_id>/complete")
    def worker_complete_job(job_id):
        body = data()
        if set(body) != {"results"} or not isinstance(body["results"], list):
            fail(400, "نتیجهٔ Worker نامعتبر است.")
        try:
            results = [_result_input(item) for item in body["results"]]
        except ValueError:
            fail(400, "نتیجهٔ Worker نامعتبر است.")
        with transaction() as db:
            worker = internal_worker_auth(db)
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                fail(404, "Job پیدا نشد.")
            if row["status"] != "claimed" or row["worker_id"] != worker["id"] or row["lease_expires_at"] < _millis():
                fail(409, "اجارهٔ Job معتبر نیست.")
            requested = json.loads(row["device_ids"])
            reported = [item["deviceId"] for item in results]
            if len(results) != len(requested) or len(set(reported)) != len(reported) or set(reported) != set(requested):
                fail(400, "نتیجه باید دقیقاً برای تجهیزات همان Job ارسال شود.")
            if row["operation"] == "errdisabled_recovery":
                recovery = results[0].get("facts", {}).get("recovery")
                if not recovery or recovery.get("interface") != row["target_interface"]:
                    fail(400, "نتیجهٔ بازیابی با پورت تأییدشده منطبق نیست.")
            now = _millis()
            failures = 0
            for item in results:
                if item["status"] == "failed":
                    failures += 1
                db.execute(
                    """INSERT INTO network_results(job_id,device_id,status,collected_at,facts,warnings,error)
                       VALUES(?,?,?,?,?,?,?)""",
                    (job_id, item["deviceId"], item["status"], now, _json(item["facts"]), _json(item["warnings"]), item["error"]),
                )
                db.execute(
                    "UPDATE network_devices SET last_scan_at=?,last_status=? WHERE id=?",
                    (now, item["status"], item["deviceId"]),
                )
            db.execute(
                """UPDATE network_jobs SET status='completed',finished_at=?,lease_expires_at=NULL,
                   result_count=?,failure_count=?,sealed_payload=NULL WHERE id=?""",
                (now, len(results), failures, job_id),
            )
            completed = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            event(db, worker["id"], "job_completed", job_id=job_id, detail=f"{len(results)}:{failures}")
            return jsonify(job=_public_job(completed))
