"""DPAPI-only credential storage for the Windows Network Worker identity.

The FAM control plane never handles device credentials.  The encrypted file is
created and consumed by the same dedicated Windows service account, so a FAM
IIS identity cannot decrypt it.  No environment-variable credential fallback
exists in production code.
"""
from __future__ import annotations

from dataclasses import dataclass
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re

from .config import IDENTIFIER, SecretStoreConfig


class SecretStoreError(RuntimeError):
    pass


@dataclass(frozen=True)
class Credential:
    username: str
    password: str


if os.name == "nt":
    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    _crypt32 = ctypes.WinDLL("Crypt32.dll")
    _kernel32 = ctypes.WinDLL("Kernel32.dll")
    _crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(DATA_BLOB), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB),
    ]
    _crypt32.CryptProtectData.restype = wintypes.BOOL
    _crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(DATA_BLOB), ctypes.POINTER(wintypes.LPWSTR), ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB),
    ]
    _crypt32.CryptUnprotectData.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    _kernel32.LocalFree.restype = ctypes.c_void_p
    CRYPTPROTECT_UI_FORBIDDEN = 0x1


def _dpapi(operation, payload: bytes) -> bytes:
    if os.name != "nt":
        raise SecretStoreError("Windows DPAPI is required for Network Worker secrets")
    if not payload:
        raise SecretStoreError("empty DPAPI payload is invalid")
    source_buffer = (ctypes.c_byte * len(payload)).from_buffer_copy(payload)
    source = DATA_BLOB(len(payload), source_buffer)
    target = DATA_BLOB()
    if operation == "protect":
        ok = _crypt32.CryptProtectData(
            ctypes.byref(source), "FAM Network Worker", None, None, None,
            CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target),
        )
    else:
        description = wintypes.LPWSTR()
        ok = _crypt32.CryptUnprotectData(
            ctypes.byref(source), ctypes.byref(description), None, None, None,
            CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target),
        )
        if description:
            _kernel32.LocalFree(ctypes.cast(description, ctypes.c_void_p))
    if not ok:
        raise SecretStoreError("DPAPI operation failed for the Worker service identity")
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        _kernel32.LocalFree(target.pbData)


def protect(payload: bytes) -> bytes:
    return _dpapi("protect", payload)


def unprotect(payload: bytes) -> bytes:
    return _dpapi("unprotect", payload)


def _validate_store(raw):
    if not isinstance(raw, dict) or len(raw) > 500:
        raise SecretStoreError("DPAPI secret store is malformed")
    normalized = {}
    for reference, value in raw.items():
        if not isinstance(reference, str) or not IDENTIFIER.fullmatch(reference):
            raise SecretStoreError("DPAPI secret reference is malformed")
        if not isinstance(value, dict) or set(value) != {"username", "password"}:
            raise SecretStoreError("DPAPI credential record is malformed")
        username = value["username"]
        password = value["password"]
        if (not isinstance(username, str) or not 1 <= len(username) <= 128 or "\n" in username or "\r" in username or
                not isinstance(password, str) or not 1 <= len(password) <= 512):
            raise SecretStoreError("DPAPI credential record is malformed")
        normalized[reference] = Credential(username=username, password=password)
    return normalized


class DPAPISecretStore:
    def __init__(self, config: SecretStoreConfig):
        if config.kind != "windows-dpapi":
            raise SecretStoreError("unsupported secret store")
        self.path = config.path

    def _load(self):
        try:
            encoded = self.path.read_text(encoding="ascii").strip()
            plaintext = unprotect(base64.b64decode(encoded, validate=True))
            raw = json.loads(plaintext.decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError, SecretStoreError) as exc:
            if isinstance(exc, SecretStoreError):
                raise
            raise SecretStoreError("Worker DPAPI secret store cannot be read") from exc
        return _validate_store(raw)

    def credential(self, reference: str) -> Credential:
        if not isinstance(reference, str) or not IDENTIFIER.fullmatch(reference):
            raise SecretStoreError("credential reference is invalid")
        credential = self._load().get(reference)
        if not credential:
            raise SecretStoreError("credential reference is unavailable to this Worker")
        return credential


def provision(path: str | Path, reference: str, username: str, password: str):
    """Create/update one encrypted record, only under the current DPAPI identity.

    Call this from an interactive PowerShell started as the dedicated Worker
    account.  It intentionally accepts values only from the caller; no secret
    is printed, logged, or sent to FAM.
    """
    if os.name != "nt":
        raise SecretStoreError("secret provisioning must run on Windows as the Worker identity")
    if not isinstance(reference, str) or not IDENTIFIER.fullmatch(reference):
        raise SecretStoreError("credential reference is invalid")
    store_path = Path(path)
    if store_path.exists():
        raw = {key: {"username": value.username, "password": value.password} for key, value in DPAPISecretStore(SecretStoreConfig("windows-dpapi", store_path))._load().items()}
    else:
        raw = {}
    raw[reference] = {"username": username, "password": password}
    # Reuse the reader validation before storing encrypted JSON.
    _validate_store(raw)
    store_path.parent.mkdir(parents=True, exist_ok=True)
    protected = base64.b64encode(protect(json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
    temporary = store_path.with_suffix(store_path.suffix + ".new")
    temporary.write_bytes(protected)
    os.replace(temporary, store_path)
