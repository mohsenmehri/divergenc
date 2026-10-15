"""One-time, browser-encrypted credentials for a read-only Cisco probe.

The FAM control plane carries only a sealed envelope.  The private key is
created and protected by Windows DPAPI under the Worker service identity, so
IIS/FAM cannot decrypt an operator's interactive switch credential.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import ProbeKeyStoreConfig, _host, _integer
from .secrets import SecretStoreError, protect, unprotect


class ProbeEnvelopeError(RuntimeError):
    """A sealed interactive request cannot be safely used."""


INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")


@dataclass(frozen=True)
class ProbeConnection:
    host: str
    port: int
    username: str
    password: str
    operation: str
    interface: str | None


def _b64url_decode(value: str) -> bytes:
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise ProbeEnvelopeError("probe envelope is invalid")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ProbeEnvelopeError("probe envelope is invalid") from exc


def _fingerprint(public_pem: str) -> str:
    return hashlib.sha256(public_pem.encode("ascii")).hexdigest()


class ProbeKeyStore:
    """DPAPI-protected RSA key used only for short-lived interactive probes."""

    def __init__(self, config: ProbeKeyStoreConfig):
        if config.kind != "windows-dpapi":
            raise ProbeEnvelopeError("unsupported probe key store")
        self.path = config.path
        self._private_key = None
        self._public_pem = None

    def _load_or_create(self):
        if self._private_key is not None:
            return
        if os.name != "nt":
            raise ProbeEnvelopeError("Windows DPAPI is required for interactive probes")
        try:
            if self.path.exists():
                encoded = self.path.read_text(encoding="ascii").strip()
                private_pem = unprotect(base64.b64decode(encoded, validate=True))
                key = serialization.load_pem_private_key(private_pem, password=None)
                if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 3072:
                    raise ProbeEnvelopeError("probe private key is invalid")
            else:
                key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
                private_pem = key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.path.with_suffix(self.path.suffix + ".new")
                temporary.write_bytes(base64.b64encode(protect(private_pem)))
                os.replace(temporary, self.path)
        except (OSError, ValueError, TypeError, SecretStoreError) as exc:
            if isinstance(exc, ProbeEnvelopeError):
                raise
            raise ProbeEnvelopeError("probe key store cannot be read") from exc
        self._private_key = key
        self._public_pem = key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

    def public_key_pem(self) -> str:
        self._load_or_create()
        return self._public_pem

    def fingerprint(self) -> str:
        return _fingerprint(self.public_key_pem())

    def decrypt(self, envelope: dict, worker_id: str) -> ProbeConnection:
        """Decrypt and validate one job envelope without persisting its content."""
        self._load_or_create()
        if not isinstance(envelope, dict) or set(envelope) != {
            "algorithm", "keyFingerprint", "encryptedKey", "iv", "ciphertext"
        }:
            raise ProbeEnvelopeError("probe envelope is invalid")
        if envelope["algorithm"] != "RSA-OAEP-256/AES-256-GCM":
            raise ProbeEnvelopeError("probe envelope is invalid")
        if envelope["keyFingerprint"] != self.fingerprint():
            raise ProbeEnvelopeError("probe envelope was sealed for a different Worker key")
        try:
            aes_key = self._private_key.decrypt(
                _b64url_decode(envelope["encryptedKey"]),
                padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
            )
            plaintext = AESGCM(aes_key).decrypt(
                _b64url_decode(envelope["iv"]),
                _b64url_decode(envelope["ciphertext"]),
                ("FAM Network Worker Probe v1|" + worker_id).encode("utf-8"),
            )
            value = json.loads(plaintext.decode("utf-8"))
        except (InvalidTag, ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProbeEnvelopeError("probe envelope cannot be decrypted") from exc
        if not isinstance(value, dict) or set(value) != {"host", "port", "username", "password", "operation", "interface"}:
            raise ProbeEnvelopeError("probe payload is invalid")
        try:
            host = _host(value["host"])
            port = _integer(value["port"], "device port", 1, 65535)
        except Exception as exc:
            raise ProbeEnvelopeError("probe payload is invalid") from exc
        username, password = value["username"], value["password"]
        operation, interface = value["operation"], value["interface"]
        if (not isinstance(username, str) or not 1 <= len(username) <= 128 or "\n" in username or "\r" in username or
                not isinstance(password, str) or not 1 <= len(password) <= 512):
            raise ProbeEnvelopeError("probe payload is invalid")
        if operation == "interactive_probe" and interface is None:
            return ProbeConnection(host, port, username, password, operation, None)
        if operation == "errdisabled_recovery" and isinstance(interface, str) and INTERFACE.fullmatch(interface):
            return ProbeConnection(host, port, username, password, operation, interface)
        raise ProbeEnvelopeError("probe payload is invalid")
