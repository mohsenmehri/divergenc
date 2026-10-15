"""Fixed, auditable network operations executed only by the FAM backend.

The browser never opens an SSH session.  It submits a narrowly validated request
through the authenticated FAM API; credentials are held only long enough to make
one SSH connection and are deliberately omitted from database/audit records.

This module intentionally has no "run arbitrary command" capability.  The only
currently supported recipe is recovery of a Cisco-style ``err-disabled``
interface.  It never sends ``enable`` and it never writes startup configuration.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping


ACTION_RECOVER_ERRDISABLE = "recover_errdisable"
DEVICE_TYPES = frozenset({"router", "switch"})
MAX_OUTPUT = 4096

# A device interface is data in a fixed command recipe, not an arbitrary CLI
# fragment.  This accepts common Cisco forms such as Gi1/0/24, GigabitEthernet
# 1/0/24, Port-channel12 and Vlan10, while excluding whitespace tricks, quotes,
# semicolons, newlines, and configuration subcommands.
_INTERFACE = re.compile(r"[A-Za-z][A-Za-z-]*(?: ?\d+(?:/\d+){0,5})")
_USERNAME = re.compile(r"[A-Za-z0-9_.@\\/-]{1,128}")
_REQUEST_ID = re.compile(r"[a-f0-9-]{36}")
_FINGERPRINT = re.compile(r"SHA256:[A-Za-z0-9+/]{43}")
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class NetworkOperationError(Exception):
    """A safe, Persian message intended for the authenticated operator."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class NetworkOperationRequest:
    request_id: str
    action: str
    device_type: str
    target: str
    interface: str
    username: str
    password: str
    host_fingerprint: str

    @property
    def safe_payload(self) -> dict[str, str]:
        """The only request fields that may be hashed/stored/audited."""
        return {
            "requestId": self.request_id,
            "action": self.action,
            "deviceType": self.device_type,
            "target": self.target,
            "interface": self.interface,
            "hostFingerprint": self.host_fingerprint,
        }


def _normalise_fingerprint(value: str) -> str:
    value = str(value or "").strip().replace("=", "")
    if not _FINGERPRINT.fullmatch(value):
        raise NetworkOperationError(400, "اثر انگشت کلید SSH باید با SHA256: شروع شود و معتبر باشد.")
    return value


def parse_request(value: Mapping[str, Any], allowed_networks: list[ipaddress.IPv4Network]) -> NetworkOperationRequest:
    """Validate an operation request before a socket can be opened.

    Operators intentionally enter an IPv4 address for each operation.  The
    server still checks it against an administrator-configured CIDR allowlist,
    so a crafted browser request cannot turn FAM into a general SSRF/SSH proxy.
    """
    if not isinstance(value, Mapping):
        raise NetworkOperationError(400, "درخواست عملیات شبکه معتبر نیست.")
    allowed_fields = {
        "requestId", "action", "deviceType", "target", "interface", "username",
        "password", "hostFingerprint", "confirmed",
    }
    if set(value) - allowed_fields:
        raise NetworkOperationError(400, "فیلد ناشناخته در درخواست عملیات شبکه مجاز نیست.")
    request_id = value.get("requestId")
    action = value.get("action")
    device_type = value.get("deviceType")
    target = value.get("target")
    interface = value.get("interface")
    username = value.get("username")
    password = value.get("password")
    fingerprint = value.get("hostFingerprint")
    if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
        raise NetworkOperationError(400, "شناسهٔ درخواست عملیات نامعتبر است.")
    if action != ACTION_RECOVER_ERRDISABLE:
        raise NetworkOperationError(400, "فقط عملیات رفع Err-Disable در این نسخه مجاز است.")
    if device_type not in DEVICE_TYPES:
        raise NetworkOperationError(400, "نوع تجهیز باید روتر یا سوئیچ باشد.")
    if not isinstance(target, str):
        raise NetworkOperationError(400, "IP تجهیز معتبر نیست.")
    try:
        address = ipaddress.ip_address(target.strip())
    except ValueError as exc:
        raise NetworkOperationError(400, "IP تجهیز معتبر نیست.") from exc
    if not isinstance(address, ipaddress.IPv4Address):
        raise NetworkOperationError(400, "فقط IPv4 برای تجهیز مجاز است.")
    if not allowed_networks or not any(address in network for network in allowed_networks):
        raise NetworkOperationError(403, "IP واردشده در محدودهٔ مجاز عملیات شبکهٔ سرور نیست.")
    if not isinstance(interface, str):
        raise NetworkOperationError(400, "نام اینترفیس معتبر نیست.")
    interface = interface.strip()
    if not _INTERFACE.fullmatch(interface) or len(interface) > 64:
        raise NetworkOperationError(400, "نام اینترفیس معتبر نیست؛ فقط نام استاندارد اینترفیس Cisco وارد کنید.")
    if not isinstance(username, str) or not _USERNAME.fullmatch(username):
        raise NetworkOperationError(400, "نام کاربری تجهیز معتبر نیست.")
    if not isinstance(password, str) or not 1 <= len(password) <= 256:
        raise NetworkOperationError(400, "رمز تجهیز باید بین ۱ تا ۲۵۶ نویسه باشد.")
    if value.get("confirmed") is not True:
        raise NetworkOperationError(400, "تأیید صریح اجرای Shutdown و No shutdown لازم است.")
    return NetworkOperationRequest(
        request_id=request_id,
        action=action,
        device_type=device_type,
        target=str(address),
        interface=interface,
        username=username,
        password=password,
        host_fingerprint=_normalise_fingerprint(fingerprint),
    )


def configured_networks(raw: str | list[str] | tuple[str, ...] | None) -> list[ipaddress.IPv4Network]:
    """Parse an explicit IPv4 CIDR allowlist from FAM_DEVICE_NETWORKS."""
    if raw is None:
        return []
    parts = raw.split(",") if isinstance(raw, str) else list(raw)
    networks: list[ipaddress.IPv4Network] = []
    for part in parts:
        if not isinstance(part, str) or not part.strip():
            continue
        try:
            network = ipaddress.ip_network(part.strip(), strict=False)
        except ValueError as exc:
            raise RuntimeError("FAM_DEVICE_NETWORKS contains an invalid CIDR.") from exc
        if not isinstance(network, ipaddress.IPv4Network):
            raise RuntimeError("FAM_DEVICE_NETWORKS accepts IPv4 CIDRs only.")
        networks.append(network)
    return networks


def request_digest(operation: NetworkOperationRequest) -> str:
    """Idempotency digest that deliberately excludes the device password."""
    import json

    data = json.dumps(operation.safe_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def clean_output(value: str) -> str:
    """Bound a device transcript for UI/audit storage without terminal escapes."""
    value = _ANSI.sub("", str(value or "")).replace("\r", "")
    value = "".join(ch for ch in value if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    if len(value) > MAX_OUTPUT:
        value = value[:MAX_OUTPUT] + "\n… (خروجی کوتاه شد)"
    return value.strip()


def ssh_fingerprint(key: Any) -> str:
    """Return the OpenSSH SHA256 fingerprint for a Paramiko key object."""
    encoded = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
    return "SHA256:" + encoded


class ExpectedFingerprintPolicy:
    """Paramiko policy factory that rejects every key except the supplied SHA256 key."""

    def __init__(self, expected: str, paramiko: Any):
        self.expected = expected
        self.paramiko = paramiko

    def missing_host_key(self, client: Any, hostname: str, key: Any) -> None:
        actual = ssh_fingerprint(key)
        if not hmac.compare_digest(actual, self.expected):
            raise self.paramiko.SSHException("SSH host key fingerprint mismatch")


def _shell_command(channel: Any, command: str, timeout: float = 15.0) -> str:
    """Send one fixed CLI command and return its bounded response.

    Network appliances do not have an exec subsystem like a Unix shell, so this
    uses an interactive channel with a quiet-period response boundary.  Commands
    are constants or a validated interface name, never browser-provided CLI.
    """
    channel.send(command + "\n")
    deadline = time.monotonic() + timeout
    output: list[bytes] = []
    got_data = False
    last_data = time.monotonic()
    while time.monotonic() < deadline:
        while channel.recv_ready():
            chunk = channel.recv(4096)
            if not chunk:
                break
            output.append(chunk)
            got_data = True
            last_data = time.monotonic()
            if sum(map(len, output)) > MAX_OUTPUT * 3:
                break
        if got_data and time.monotonic() - last_data >= 0.45:
            break
        time.sleep(0.05)
    if not got_data:
        raise NetworkOperationError(504, "تجهیز به فرمان SSH در زمان مجاز پاسخ نداد.")
    return clean_output(b"".join(output).decode("utf-8", "replace"))


def execute_recover_errdisable(operation: NetworkOperationRequest) -> dict[str, str]:
    """Connect over SSH and run the single approved recovery recipe.

    The precheck is deliberately mandatory.  If the interface does not report
    ``err-disabled`` the server sends no configuration command, avoiding an
    unnecessary bounce of an active interface.
    """
    try:
        import paramiko
    except ImportError as exc:  # deployment configuration issue, never a browser error detail
        raise NetworkOperationError(503, "ماژول امن SSH روی سرویس سرور نصب نشده است.") from exc

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(ExpectedFingerprintPolicy(operation.host_fingerprint, paramiko))
    try:
        client.connect(
            hostname=operation.target,
            port=22,
            username=operation.username,
            password=operation.password,
            look_for_keys=False,
            allow_agent=False,
            timeout=10,
            banner_timeout=10,
            auth_timeout=10,
        )
        channel = client.invoke_shell(width=180, height=48)
        _shell_command(channel, "terminal length 0")
        before = _shell_command(channel, f"show interfaces {operation.interface} status")
        if "err-disabled" not in before.lower():
            return {
                "status": "not_errdisabled",
                "message": "اینترفیس در خروجی تجهیز Err-Disable گزارش نشده است؛ هیچ فرمان پیکربندی اجرا نشد.",
                "output": before,
            }
        transcript = [before]
        # The exact recovery recipe intentionally does not contain `enable` and
        # does not save running configuration to startup configuration.
        for command in (
            "configure terminal",
            f"interface {operation.interface}",
            "shutdown",
            "no shutdown",
            "end",
        ):
            transcript.append(_shell_command(channel, command))
        after = _shell_command(channel, f"show interfaces {operation.interface} status")
        transcript.append(after)
        if "err-disabled" in after.lower():
            return {
                "status": "still_errdisabled",
                "message": "فرمان بازیابی اجرا شد، اما Err-Disable همچنان در خروجی تجهیز دیده می‌شود؛ علت خطا را بررسی کنید.",
                "output": clean_output("\n".join(transcript)),
            }
        return {
            "status": "succeeded",
            "message": "فرمان Shutdown و No shutdown روی تجهیز اجرا شد. Startup-config تغییر داده نشده است.",
            "output": clean_output("\n".join(transcript)),
        }
    except NetworkOperationError:
        raise
    except paramiko.AuthenticationException as exc:
        raise NetworkOperationError(403, "ورود SSH به تجهیز رد شد؛ نام کاربری یا رمز را بررسی کنید.") from exc
    except paramiko.BadHostKeyException as exc:
        raise NetworkOperationError(403, "کلید SSH تجهیز با اثر انگشت واردشده تطابق ندارد.") from exc
    except paramiko.SSHException as exc:
        if "fingerprint mismatch" in str(exc).lower():
            raise NetworkOperationError(403, "کلید SSH تجهیز با اثر انگشت واردشده تطابق ندارد.") from exc
        raise NetworkOperationError(502, "اتصال SSH تجهیز ناموفق بود؛ وضعیت SSH و اثر انگشت کلید را بررسی کنید.") from exc
    except OSError as exc:
        raise NetworkOperationError(502, "سرور فام نتوانست به SSH تجهیز متصل شود؛ IP، مسیر شبکه و پورت ۲۲ را بررسی کنید.") from exc
    finally:
        client.close()


def paramiko_available() -> bool:
    try:
        import paramiko  # noqa: F401
    except ImportError:
        return False
    return True


def execute(operation: NetworkOperationRequest, executor: Callable[[NetworkOperationRequest], Mapping[str, str]] | None = None) -> dict[str, str]:
    """Run an injected test executor or the live fixed SSH recipe."""
    raw = executor(operation) if executor is not None else execute_recover_errdisable(operation)
    if not isinstance(raw, Mapping):
        raise RuntimeError("Network operation executor returned an invalid result.")
    status = str(raw.get("status", "failed"))
    message = str(raw.get("message", "عملیات شبکه نتیجهٔ معتبری نداشت."))
    output = clean_output(str(raw.get("output", "")))
    if status not in {"succeeded", "not_errdisabled", "still_errdisabled"}:
        raise RuntimeError("Network operation executor returned an invalid status.")
    return {"status": status, "message": message[:500], "output": output}
