"""Bounded execution loop for one strictly read-only inventory job."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .collector import collect
from .secrets import SecretStoreError


def missing_inventory(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "local_inventory_missing"}


def secret_failure(device_id):
    return {"deviceId": device_id, "status": "failed", "facts": {}, "warnings": [], "error": "worker_error"}


class Runner:
    def __init__(self, settings, client, secret_store, *, collector=collect):
        self.settings = settings
        self.client = client
        self.secret_store = secret_store
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

    def run_once(self):
        """Claim and finish at most one job; returns False when the queue is empty."""
        job = self.client.claim()
        if job is None:
            return False
        device_ids = job["deviceIds"]
        # The server only issues explicit, deduplicated lab IDs.  Preserve its
        # order in the completion payload so the result is easy to audit.
        with ThreadPoolExecutor(max_workers=self.settings.max_parallel, thread_name_prefix="fam-netops") as pool:
            futures = {device_id: pool.submit(self._one, device_id) for device_id in device_ids}
            results = [futures[device_id].result() for device_id in device_ids]
        self.client.complete(job["id"], results)
        return True
