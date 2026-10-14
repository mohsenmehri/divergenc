"""TLS client for the two Worker-only FAM endpoints."""
from __future__ import annotations

import json
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings


class ControlPlaneError(RuntimeError):
    """A sanitized control-plane communication failure."""


class ControlPlaneClient:
    def __init__(self, settings: Settings, token: str):
        if not isinstance(token, str) or not token.startswith("fwn_") or len(token) < 36:
            raise ControlPlaneError("Worker token is unavailable or malformed")
        self.base_url = settings.control_plane_url.rstrip("/")
        self.worker_id = settings.worker_id
        self.token = token
        self.context = ssl.create_default_context(cafile=str(settings.ca_file) if settings.ca_file else None)

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
            with urlopen(request, timeout=45, context=self.context) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            # Do not surface response text: it can contain reverse-proxy details
            # and must never result in an accidental token/header log.
            raise ControlPlaneError("control-plane request failed") from exc
        if not isinstance(parsed, dict):
            raise ControlPlaneError("control-plane response is invalid")
        return parsed

    def claim(self):
        response = self._post("/api/network/worker/claim", {})
        job = response.get("job")
        if job is None:
            return None
        if not isinstance(job, dict) or set(job) != {"id", "kind", "deviceIds", "leaseSeconds"}:
            raise ControlPlaneError("control-plane job is invalid")
        if job["kind"] != "read_only_inventory" or not isinstance(job["id"], str) or not isinstance(job["deviceIds"], list):
            raise ControlPlaneError("control-plane job is invalid")
        return job

    def complete(self, job_id, results):
        response = self._post(f"/api/network/worker/jobs/{job_id}/complete", {"results": results})
        if not isinstance(response.get("job"), dict):
            raise ControlPlaneError("control-plane completion response is invalid")
        return response["job"]
