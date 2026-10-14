"""Bounded execution loop for strictly read-only Cisco inventory jobs."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .collector import collect
from .config import Device
from .probe_envelope import ProbeEnvelopeError
from .secrets import Credential, SecretStoreError


def missing_inventory(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "local_inventory_missing"}


def secret_failure(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "worker_error"}


class Runner:
    def __init__(self, settings, client, secret_store, probe_keys=None, *, collector=collect):
        self.settings = settings
        self.client = client
        self.secret_store = secret_store
        self.probe_keys = probe_keys
        self.collector = collector

    def _one(self, device_id):
        device = self.settings.devices.get(device_id)
        if device is None:
            return missing_inventory(device_id)
        try:
            credential = self.secret_store.credential(device.credential_ref)
        except SecretStoreError:
            return secret_failure(device_id)
        return self.collector(device, credential)

    def _interactive_probe(self, job):
        """Run one short-lived, browser-encrypted read-only probe.

        ``sealed`` decrypts only under this Worker's DPAPI identity. Its IP,
        username, and password never enter the FAM API result, event, or log.
        """
        device_ids = job["deviceIds"]
        if len(device_ids) != 1 or self.probe_keys is None:
            return [secret_failure(device_id) for device_id in device_ids]
        device_id = device_ids[0]
        try:
            host, port, username, password = self.probe_keys.decrypt(job["sealed"], self.settings.worker_id)
        except ProbeEnvelopeError:
            return [secret_failure(device_id)]
        device = Device(
            id=device_id,
            host=host,
            port=port,
            credential_ref="interactive-probe",
            platform="cisco_ios",
            timeout_seconds=30,
        )
        # The credential is held only for this collection call. The collector
        # emits only allow-listed, structured facts and discards CLI output.
        return [self.collector(device, Credential(username, password))]

    def run_once(self):
        """Claim and finish at most one job; returns False when the queue is empty."""
        job = self.client.claim()
        if job is None:
            return False
        if "sealed" in job:
            results = self._interactive_probe(job)
        else:
            device_ids = job["deviceIds"]
            # The server only issues explicit, deduplicated IDs. Preserve its
            # order in the completion payload so the result is easy to audit.
            with ThreadPoolExecutor(max_workers=self.settings.max_parallel, thread_name_prefix="fam-netops") as pool:
                futures = {device_id: pool.submit(self._one, device_id) for device_id in device_ids}
                results = [futures[device_id].result() for device_id in device_ids]
        self.client.complete(job["id"], results)
        return True
