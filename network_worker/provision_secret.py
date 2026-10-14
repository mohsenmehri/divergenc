"""Interactively add one device credential to the Worker DPAPI store."""
from __future__ import annotations

import argparse
import getpass
import sys

from .secrets import SecretStoreError, provision


def main():
    parser = argparse.ArgumentParser(description="Provision one FAM Network Worker DPAPI credential")
    parser.add_argument("--store", required=True, help="absolute secrets.json.dpapi path")
    parser.add_argument("--ref", required=True, help="credentialRef used by worker.json")
    args = parser.parse_args()
    username = input("Cisco Worker username: ").strip()
    password = getpass.getpass("Cisco Worker password: ")
    confirm = getpass.getpass("Confirm Cisco Worker password: ")
    if password != confirm:
        print("Passwords do not match.", file=sys.stderr)
        return 2
    try:
        provision(args.store, args.ref, username, password)
    except SecretStoreError:
        print("Credential was not provisioned.", file=sys.stderr)
        return 2
    print("Credential stored for the current Windows Worker identity.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
