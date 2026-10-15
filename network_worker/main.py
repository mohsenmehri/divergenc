"""Command-line entry point for the separately installed Network Worker."""
from __future__ import annotations

import argparse
import os
import sys
import time

from .client import ControlPlaneClient, ControlPlaneError
from .config import ConfigError, load
from .runner import Runner
from .probe_envelope import ProbeEnvelopeError, ProbeKeyStore
from .secrets import DPAPISecretStore, SecretStoreError


def arguments():
    parser = argparse.ArgumentParser(description="FAM read-only Network Operations Worker")
    parser.add_argument("--config", required=True, help="absolute path to worker.json")
    parser.add_argument("--once", action="store_true", help="claim and process at most one job, then exit")
    return parser.parse_args()


def main():
    args = arguments()
    try:
        settings = load(args.config)
        token = os.environ.get(settings.token_env, "")
        client = ControlPlaneClient(settings, token)
        probe_keys = ProbeKeyStore(settings.probe_key_store)
        client.register_probe_key(probe_keys.public_key_pem())
        runner = Runner(settings, client, DPAPISecretStore(settings.secret_store), probe_keys)
    except (ConfigError, ControlPlaneError, SecretStoreError, ProbeEnvelopeError):
        print("FAM Network Worker configuration is invalid or unavailable.", file=sys.stderr)
        return 2

    if args.once:
        try:
            runner.run_once()
        except ControlPlaneError:
            # Deliberately no exception text: avoid writing tokens, proxy
            # diagnostics, or device details into a Windows service log.
            print("FAM Network Worker control-plane request failed.", file=sys.stderr)
            return 3
        except Exception:
            print("FAM Network Worker job failed safely.", file=sys.stderr)
            return 4
        return 0

    while True:
        try:
            did_work = runner.run_once()
        except ControlPlaneError:
            # Deliberately no exception text: avoid writing tokens, proxy
            # diagnostics, or device details into a Windows service log.
            print("FAM Network Worker control-plane request failed.", file=sys.stderr)
            did_work = False
        except Exception:
            print("FAM Network Worker job failed safely.", file=sys.stderr)
            did_work = False
        time.sleep(1 if did_work else settings.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
