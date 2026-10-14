"""Read-only Network Operations control-plane endpoints.

This module deliberately contains no SSH implementation and does not store a
management address, password, enable secret, RADIUS secret, SNMP community, or
raw CLI output.  FAM queues only inventory IDs.  A separately deployed Worker
owns the local ID-to-device mapping and the DPAPI-protected credentials.

The first release is intentionally narrow:
* one fixed job type: ``read_only_inventory``;
* only explicit, small lab-device selections;
* fixed platform: Cisco IOS (``cisco_ios``);
* fixed, structured result fields with no raw output; and
* no configuration, remediation, or free-form command endpoint.
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

from flask import g, jsonify, request, send_file


IDENTIFIER = re.compile(r"[a-z][a-z0-9._-]{1,63}")
NAME = re.compile(r"[^\r\n]{1,80}")
ERROR_CODES = {
    "authentication_failed",
    "command_failed",
    "connection_failed",
    "local_inventory_missing",
    "timeout",
    "unsupported_platform",
    "worker_error",
}
RESULT_STATUSES = {"succeeded", "failed"}
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
    if not isinstance(facts, dict) or set(facts) - {"hostname", "model", "osVersion", "interfaces"}:
        raise ValueError("دادهٔ Inventory")
    normalized_facts = {}
    for key in ("hostname", "model", "osVersion"):
        if key in facts:
            normalized_facts[key] = _fact_text(facts[key], "دادهٔ Inventory")
    if "interfaces" in facts:
        interfaces = facts["interfaces"]
        if not isinstance(interfaces, dict) or set(interfaces) - {"total", "up", "down", "errDisabled"}:
            raise ValueError("دادهٔ Inventory")
        normalized_interfaces = {}
        for key, number in interfaces.items():
            if type(number) is not int or number < 0 or number > 100000:
                raise ValueError("دادهٔ Inventory")
            normalized_interfaces[key] = number
        normalized_facts["interfaces"] = normalized_interfaces

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


def register_network_ops(app, *, connect, transaction, data, fail, can_read_network, can_write_network):
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
              interactive INTEGER NOT NULL DEFAULT 0 CHECK(interactive IN (0,1))
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
        db.execute("INSERT OR IGNORE INTO network_settings VALUES(1,0)")

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

    def worker_auth(db):
        enabled()
        worker_id = request.headers.get("X-FAM-Worker-ID", "")
        authorization = request.headers.get("Authorization", "")
        if not IDENTIFIER.fullmatch(worker_id) or not authorization.startswith("Bearer "):
            fail(401, "اعتبار Worker معتبر نیست.")
        token = authorization[7:]
        if not 32 <= len(token) <= 200:
            fail(401, "اعتبار Worker معتبر نیست.")
        row = db.execute("SELECT * FROM network_workers WHERE id=? AND enabled=1", (worker_id,)).fetchone()
        supplied = hashlib.sha256(token.encode("utf-8")).hexdigest()
        if not row or not hmac.compare_digest(supplied, row["token_hash"]):
            fail(401, "اعتبار Worker معتبر نیست.")
        db.execute("UPDATE network_workers SET last_seen_at=? WHERE id=?", (_millis(), worker_id))
        return row

    @app.get("/network-operations")
    def network_operations_page():
        # The static screen contains no privileged data. Every data call below
        # remains protected by the normal FAM session/CSRF guard.
        return send_file(app.root_path + "/network_operations.html", mimetype="text/html")

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
            return jsonify(workers=[_public_worker(row) for row in db.execute("SELECT * FROM network_workers ORDER BY name")])

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

    @app.post("/api/network/workers/<worker_id>/probe-key")
    def register_network_worker_probe_key(worker_id):
        body = data()
        if set(body) != {"publicKey"} or not IDENTIFIER.fullmatch(worker_id):
            fail(400, "کلید رمزنگاری Worker نامعتبر است.")
        try:
            public_key, fingerprint = _probe_public_key(body["publicKey"])
        except ValueError:
            fail(400, "کلید رمزنگاری Worker نامعتبر است.")
        with transaction() as db:
            worker = worker_auth(db)
            if worker["id"] != worker_id:
                fail(403, "Worker فقط می‌تواند کلید خود را ثبت کند.")
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
                """INSERT INTO network_jobs(id,kind,site_id,group_id,device_ids,status,requested_by,created_at,sealed_payload,interactive)
                   VALUES(?,?,?,?,?,'queued',?,?,?,1)""",
                (job_id, "read_only_inventory", "interactive", "", _json([device_id]), g.user["username"], now, sealed_payload),
            )
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            # The audit contains only a generated probe ID, never an address or
            # credential, and the sealed envelope cannot be rendered by FAM.
            event(db, g.user["username"], "interactive_read_only_probe_queued", job_id=job_id, detail=device_id)
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
        write_access()
        body = data()
        if set(body) - {"id", "name", "rotate"} or "id" not in body or "name" not in body:
            fail(400, "مشخصات Worker نامعتبر است.")
        try:
            worker_id = _text(body["id"], "شناسه Worker", identifier=True)
            name = _text(body["name"], "نام Worker")
        except ValueError:
            fail(400, "مشخصات Worker نامعتبر است.")
        rotate = body.get("rotate", False)
        if type(rotate) is not bool:
            fail(400, "مشخصات Worker نامعتبر است.")
        # The token is intentionally returned only from this write response;
        # database/API reads expose its hash and status, never its plaintext.
        token = "fwn_" + secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with transaction() as db:
            old = db.execute("SELECT * FROM network_workers WHERE id=?", (worker_id,)).fetchone()
            if old and not rotate:
                fail(409, "این Worker وجود دارد؛ برای چرخش اعتبار، rotate را صریحاً فعال کنید.")
            now = _millis()
            if old:
                db.execute(
                    "UPDATE network_workers SET name=?,token_hash=?,enabled=1,created_by=?,created_at=?,last_seen_at=NULL WHERE id=?",
                    (name, digest, g.user["username"], now, worker_id),
                )
                action = "worker_token_rotated"
            else:
                db.execute(
                    "INSERT INTO network_workers(id,name,token_hash,enabled,created_by,created_at) VALUES(?,?,?,?,?,?)",
                    (worker_id, name, digest, 1, g.user["username"], now),
                )
                action = "worker_provisioned"
            row = db.execute("SELECT * FROM network_workers WHERE id=?", (worker_id,)).fetchone()
            event(db, g.user["username"], action, detail=worker_id)
            return jsonify(worker=_public_worker(row), token=token)

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

    @app.post("/api/network/worker/claim")
    def worker_claim_job():
        body = data()
        if body:
            fail(400, "درخواست Worker نامعتبر است.")
        with transaction() as db:
            worker = worker_auth(db)
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
            # Ordinary jobs carry only IDs. A direct check additionally carries
            # opaque ciphertext that only the Worker's DPAPI-held private key
            # can decrypt; FAM never receives its plaintext.
            job = {
                "id": claimed["id"],
                "kind": claimed["kind"],
                "deviceIds": json.loads(claimed["device_ids"]),
                "leaseSeconds": max(60, min(lease_seconds, 3600)),
            }
            if sealed_payload is not None:
                job["sealed"] = sealed_payload
            return jsonify(job=job)

    @app.post("/api/network/worker/jobs/<job_id>/complete")
    def worker_complete_job(job_id):
        body = data()
        if set(body) != {"results"} or not isinstance(body["results"], list):
            fail(400, "نتیجهٔ Worker نامعتبر است.")
        try:
            results = [_result_input(item) for item in body["results"]]
        except ValueError:
            fail(400, "نتیجهٔ Worker نامعتبر است.")
        with transaction() as db:
            worker = worker_auth(db)
            row = db.execute("SELECT * FROM network_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                fail(404, "Job پیدا نشد.")
            if row["status"] != "claimed" or row["worker_id"] != worker["id"] or row["lease_expires_at"] < _millis():
                fail(409, "اجارهٔ Job معتبر نیست.")
            requested = json.loads(row["device_ids"])
            reported = [item["deviceId"] for item in results]
            if len(results) != len(requested) or len(set(reported)) != len(reported) or set(reported) != set(requested):
                fail(400, "نتیجه باید دقیقاً برای تجهیزات همان Job ارسال شود.")
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
