"""Strict local-only configuration for the separately deployed Network Worker."""
from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlparse


IDENTIFIER = re.compile(r"[a-z][a-z0-9._-]{1,63}")
HOSTNAME = re.compile(r"(?=.{1,253}\Z)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)\Z")
WINDOWS_ABSOLUTE = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\)")


class ConfigError(ValueError):
    """A local worker configuration is malformed or unsafe."""


@dataclass(frozen=True)
class Device:
    id: str
    host: str
    port: int
    credential_ref: str
    platform: str
    timeout_seconds: int


@dataclass(frozen=True)
class ProbeKeyStoreConfig:
    kind: str
    path: Path


@dataclass(frozen=True)
class Settings:
    control_plane_url: str
    worker_id: str
    cohosted_loopback: bool
    poll_seconds: int
    max_parallel: int
    ca_file: Path | None
    probe_key_store: ProbeKeyStoreConfig
    devices: dict[str, Device]


def _identifier(value, label):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ConfigError(f"{label} is invalid")
    return value


def _host(value):
    if not isinstance(value, str) or not value or len(value) > 253 or any(c.isspace() for c in value):
        raise ConfigError("device host is invalid")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        if not HOSTNAME.fullmatch(value):
            raise ConfigError("device host is invalid")
    return value


def _integer(value, label, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ConfigError(f"{label} is invalid")
    return value


def _absolute_path(value):
    # Config parsing is tested off Windows too, so recognise a Windows absolute
    # path lexically instead of relying solely on POSIX Path.is_absolute().
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ConfigError("path is invalid")
    if not Path(value).is_absolute() and not WINDOWS_ABSOLUTE.match(value):
        raise ConfigError("path must be absolute")
    return Path(value)


def _url(value):
    """Accept only the co-hosted Worker's private loopback control plane.

    Browser users use the public HTTPS origin.  The Worker is a local server
    process and talks only to the unproxied loopback service, so it needs no
    browser-visible pairing token and never traverses IIS, a proxy, or a LAN.
    """
    if not isinstance(value, str):
        raise ConfigError("controlPlaneUrl is invalid")
    parsed = urlparse(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or
            parsed.port != 8765 or parsed.username or parsed.password or
            parsed.query or parsed.fragment or parsed.path.rstrip("/") not in ("", "/")):
        raise ConfigError("controlPlaneUrl must be http://127.0.0.1:8765 for the co-hosted Worker")
    return "http://127.0.0.1:8765"


def _store(value, label, cls):
    if not isinstance(value, dict) or set(value) != {"type", "path"} or value.get("type") != "windows-dpapi" or not isinstance(value.get("path"), str):
        raise ConfigError(f"{label} must use windows-dpapi")
    try:
        path = _absolute_path(value["path"])
    except ConfigError as exc:
        raise ConfigError(f"{label} path must be absolute") from exc
    return cls(kind="windows-dpapi", path=path)


def _device(value):
    allowed = {"id", "host", "port", "credentialRef", "platform", "timeoutSeconds"}
    if not isinstance(value, dict) or set(value) != allowed:
        raise ConfigError("device entries must contain only the fixed local mapping fields")
    return Device(
        id=_identifier(value["id"], "device id"),
        host=_host(value["host"]),
        port=_integer(value["port"], "device port", 1, 65535),
        credential_ref=_identifier(value["credentialRef"], "credentialRef"),
        platform=value["platform"],
        timeout_seconds=_integer(value["timeoutSeconds"], "timeoutSeconds", 5, 90),
    )


def load(path: str | Path) -> Settings:
    """Load a configuration without accepting inline tokens or credentials.

    Device hostnames belong only to this Worker file. FAM receives a device ID
    in an ordinary inventory job and looks it up here. An interactive probe is
    different: its connection fields are browser-encrypted for this Worker's
    DPAPI key, are decrypted only in Worker memory, and are never persisted.
    """
    file_path = Path(path)
    try:
        # Windows PowerShell 5.1 writes a UTF-8 BOM for Set-Content -Encoding UTF8.
        # Accept that standard JSON file encoding without weakening any schema checks.
        raw = json.loads(file_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError("configuration file cannot be read") from exc
    allowed = {"controlPlaneUrl", "workerId", "pollSeconds", "maxParallel", "caFile", "probeKeyStore", "devices"}
    if not isinstance(raw, dict) or set(raw) != allowed:
        raise ConfigError("configuration must contain exactly the documented fields")
    try:
        probe_key_store = _store(raw["probeKeyStore"], "probeKeyStore", ProbeKeyStoreConfig)
        ca_file = None if raw["caFile"] is None else _absolute_path(raw["caFile"])
    except ConfigError as exc:
        raise ConfigError(str(exc)) from exc
    if not isinstance(raw["devices"], list) or len(raw["devices"]) > 500:
        raise ConfigError("devices is invalid")
    parsed_devices = [_device(item) for item in raw["devices"]]
    if any(item.platform != "cisco_ios" for item in parsed_devices):
        raise ConfigError("phase 1 supports only cisco_ios")
    if len({item.id for item in parsed_devices}) != len(parsed_devices):
        raise ConfigError("device IDs must be unique")
    return Settings(
        control_plane_url=_url(raw["controlPlaneUrl"]),
        worker_id=_identifier(raw["workerId"], "workerId"),
        cohosted_loopback=True,
        poll_seconds=_integer(raw["pollSeconds"], "pollSeconds", 5, 300),
        # The first validation release deliberately caps concurrency at two.
        max_parallel=_integer(raw["maxParallel"], "maxParallel", 1, 2),
        ca_file=Path(ca_file) if ca_file else None,
        probe_key_store=probe_key_store,
        devices={item.id: item for item in parsed_devices},
    )
