"""TLS client for the two Worker-only FAM endpoints."""
from __future__ import annotations

import json
from pathlib import Path
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from .config import Settings


class ControlPlaneError(RuntimeError):
    """A sanitized control-plane communication failure."""


def _tls_context(ca_file: Path | None):
    """Create a context from the local CA file without trusting proxies.

    Windows exports public certificates as binary DER ``.cer`` files by
    default. OpenSSL accepts PEM paths directly, but not DER paths; support
    both formats locally so a Worker can use the verified public certificate
    emitted by FAM without a manual conversion step.
    """
    try:
        if ca_file is None:
            return ssl.create_default_context()
        try:
            return ssl.create_default_context(cafile=str(ca_file))
        except ssl.SSLError:
            der = ca_file.read_bytes()
            context = ssl.create_default_context()
            context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(der))
            return context
    except (OSError, TypeError, ValueError, ssl.SSLError) as exc:
        raise ControlPlaneError("control-plane CA file is unavailable or invalid") from exc


class ControlPlaneClient:
    def __init__(self, settings: Settings, token: str):
        if not isinstance(token, str) or not token.startswith("fwn_") or len(token) < 36:
            raise ControlPlaneError("Worker token is unavailable or malformed")
        self.base_url = settings.control_plane_url.rstrip("/")
        self.worker_id = settings.worker_id
        self.token = token
        self.context = _tls_context(settings.ca_file)
        # FAM is an explicitly configured internal control-plane endpoint.
        # A Windows/PAC proxy may return a gateway page for its short hostname,
        # so Worker API traffic is always direct and never exposes its bearer
        # token to a proxy.
        self.opener = build_opener(
            ProxyHandler({}),
            HTTPSHandler(context=self.context),
        )

    def _post(self, path, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": "Bearer " + self.token,
                "X-FAM-Worker-ID": self.worker_id,
                "User-Agent": "FAM-Network-Worker/1",
            },
        )
        try:
            with self.opener.open(request, timeout=45) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, ssl.SSLError, json.JSONDecodeError) as exc:
            # Do not surface response text: it can contain reverse-proxy details
            # and must never result in an accidental token/header log.
            raise ControlPlaneError("control-plane request failed") from exc
        if not isinstance(parsed, dict):
            raise ControlPlaneError("control-plane response is invalid")
        return parsed

    def register_probe_key(self, public_key: str):
        if not isinstance(public_key, str) or not public_key.startswith("-----BEGIN PUBLIC KEY-----\n") or len(public_key) > 4096:
            raise ControlPlaneError("Worker probe key is invalid")
        response = self._post(f"/api/network/workers/{self.worker_id}/probe-key", {"publicKey": public_key})
        if response.get("workerId") != self.worker_id or not isinstance(response.get("fingerprint"), str):
            raise ControlPlaneError("Worker probe-key registration is invalid")
        return response

    def claim(self):
        response = self._post("/api/network/worker/claim", {})
        job = response.get("job")
        if job is None:
            return None
        ordinary = {"id", "kind", "operation", "targetInterface", "deviceIds", "leaseSeconds"}
        interactive = ordinary | {"sealed"}
        if not isinstance(job, dict) or set(job) not in (ordinary, interactive):
            raise ControlPlaneError("control-plane job is invalid")
        if (job["kind"] != "read_only_inventory" or job.get("operation") not in {"inventory", "interactive_probe", "errdisabled_recovery"} or
                not isinstance(job["id"], str) or not isinstance(job["deviceIds"], list) or
                (job["targetInterface"] is not None and (not isinstance(job["targetInterface"], str) or len(job["targetInterface"]) > 64)) or
                ("sealed" in job and not isinstance(job["sealed"], dict))):
            raise ControlPlaneError("control-plane job is invalid")
        return job

    def complete(self, job_id, results):
        response = self._post(f"/api/network/worker/jobs/{job_id}/complete", {"results": results})
        if not isinstance(response.get("job"), dict):
            raise ControlPlaneError("control-plane completion response is invalid")
        return response["job"]
