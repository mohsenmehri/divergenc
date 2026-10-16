"""Bounded execution loop for fixed, policy-controlled Cisco IOS jobs."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .collector import collect
from .config import Device
from .probe_envelope import ProbeEnvelopeError
from .remediator import recover_errdisabled
from .secrets import Credential


def missing_inventory(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "local_inventory_missing"}


def secret_failure(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "worker_error"}


def recovery_secret_failure(device_id, interface):
    return {
        "deviceId": device_id, "status": "failed",
        "facts": {"recovery": {"interface": interface, "status": "not_completed"}},
        "warnings": [], "error": "worker_error",
    }


class Runner:
    def __init__(self, settings, client, probe_keys=None, *, collector=collect, remediator=recover_errdisabled):
        self.settings = settings
        self.client = client
        self.probe_keys = probe_keys
        self.collector = collector
        self.remediator = remediator

    def _one(self, device_id):
        # Co-hosted operation deliberately has no durable equipment credential
        # store.  Interactive browser-sealed checks are the supported path.
        return missing_inventory(device_id)

    def _interactive_job(self, job):
        """Run a one-time encrypted discovery or a validated port recovery.

        The Worker refuses any mismatch among the control-plane operation,
        source-approved target interface, and encrypted browser payload. This
        leaves no free-form command or unbounded network action surface.
        """
        device_ids = job["deviceIds"]
        recovery_target = job.get("targetInterface") if job.get("operation") == "errdisabled_recovery" else None
        failure = lambda device_id: recovery_secret_failure(device_id, recovery_target) if recovery_target else secret_failure(device_id)
        if len(device_ids) != 1 or self.probe_keys is None:
            return [failure(device_id) for device_id in device_ids]
        device_id = device_ids[0]
        try:
            connection = self.probe_keys.decrypt(job["sealed"], self.settings.worker_id)
        except ProbeEnvelopeError:
            return [failure(device_id)]
        if connection.operation != job["operation"]:
            return [failure(device_id)]
        target = job["targetInterface"]
        if connection.operation == "interactive_probe":
            if target is not None:
                return [failure(device_id)]
        elif connection.operation == "errdisabled_recovery":
            if not isinstance(target, str) or connection.interface != target:
                return [failure(device_id)]
        else:
            return [failure(device_id)]
        device = Device(
            id=device_id,
            host=connection.host,
            port=connection.port,
            credential_ref="interactive-request",
            platform="cisco_ios",
            timeout_seconds=30,
        )
        credential = Credential(connection.username, connection.password)
        if connection.operation == "interactive_probe":
            return [self.collector(device, credential)]
        return [self.remediator(device, credential, target)]

    def run_once(self):
        """Claim and finish at most one job; returns False when the queue is empty."""
        job = self.client.claim()
        if job is None:
            return False
        if "sealed" in job:
            results = self._interactive_job(job)
        else:
            device_ids = job["deviceIds"]
            with ThreadPoolExecutor(max_workers=self.settings.max_parallel, thread_name_prefix="fam-netops") as pool:
                futures = {device_id: pool.submit(self._one, device_id) for device_id in device_ids}
                results = [futures[device_id].result() for device_id in device_ids]
        self.client.complete(job["id"], results)
        return True
