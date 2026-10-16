"""DPAPI-only credential storage for the Windows Network Worker identity.

The FAM control plane never handles device credentials.  The encrypted file is
created and consumed by the same dedicated Windows service account, so a FAM
IIS identity cannot decrypt it.  No environment-variable credential fallback
exists in production code.
"""
from __future__ import annotations

from dataclasses import dataclass
import ctypes
from ctypes import wintypes
import os



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
