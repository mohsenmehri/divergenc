"""One-shot Cisco IOS equipment probe used only by the FAM backend.

The process reads one JSON document from stdin and writes one sanitized JSON
result to stdout.  It runs directly on the FAM server and connects to the
device with the Windows OpenSSH client (``ssh.exe``) -- not Netmiko/Paramiko.

Security contract
-----------------
* The device password is never placed on a command line, in a URL, in the
  database, in a file, or in a log.  It lives only in the environment of the
  short-lived ``ssh.exe`` child; ``SSH_ASKPASS`` points at a tiny helper
  script that merely echoes that environment variable.  The script itself
  never contains the password and is deleted in ``finally``.
* Only the single legacy cipher ``aes128-cbc`` is appended to the OpenSSH
  default cipher list (``-o Ciphers=+aes128-cbc``).  ``3des-cbc``,
  ``aes192-cbc`` and ``aes256-cbc`` are never offered.
* Host keys are verified with a dedicated ``known_hosts`` file.  The default
  policy is ``accept-new`` (record on first contact, refuse any later change);
  ``strict`` requires the key to be pre-trusted.  Host-key checking is never
  disabled.
* Only two fixed command sequences exist (status / bounded recovery).  There is
  no terminal, free-form command, ``enable``, ``write memory`` or ``copy``.
* Raw CLI output, banners, prompts and ssh diagnostics never leave this
  process; callers only receive stable, redacted codes.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
# Device user names are passed with ``-l`` and echoed by OpenSSH into the
# askpass prompt argument, which Windows hands to cmd.exe.  A strict allowlist
# keeps shell metacharacters out of that path entirely.
USERNAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@\\-]{0,63}\Z")
RFC1918_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
CLI_ERROR = re.compile(r"^\s*%\s+\S")  # IOS "% Invalid input ..." (syslog lines are "%LINK-5-..." without a space)

# Exactly one temporary legacy exception.  Never widen this.
LEGACY_CIPHER_OPTION = "Ciphers=+aes128-cbc"
FORBIDDEN_CIPHERS = ("3des-cbc", "aes192-cbc", "aes256-cbc")
HOST_KEY_POLICIES = {"accept-new": "accept-new", "strict": "yes"}
SECRET_ENV = "FAM_EQUIPMENT_SSH_SECRET"

# Timeout budget.  ``SESSION_TIMEOUT`` bounds one ssh.exe process (connect +
# authenticate + fixed commands).  ``HELPER_DEADLINE`` bounds this whole
# helper per operation (status = 1 session, recovery = up to 3 sessions).
# ``equipment_ops.EXECUTOR_TIMEOUT`` must stay above these values so that the
# FAM backend never kills this helper while ssh.exe is still being supervised.
CONNECT_TIMEOUT = 10
SESSION_TIMEOUT = 25
HELPER_DEADLINE = {"status": 30, "recover": 85}
MAX_OUTPUT_BYTES = 1024 * 1024

STATUS_COMMANDS = ("terminal length 0", "show interfaces status", "exit")

# The askpass helper never references its prompt argument (%1) and prints the
# environment variable through delayed expansion so that password characters
# such as & | < > ^ % are emitted verbatim instead of being parsed by cmd.exe.
ASKPASS_SCRIPT = "@echo off\r\nsetlocal EnableDelayedExpansion\r\necho(!" + SECRET_ENV + "!\r\n"

# Only this subset of the parent environment is visible to ssh.exe / cmd.exe.
ENV_PASSTHROUGH = (
    "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "Path", "PATH",
    "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "USERNAME",
    "ProgramData", "APPDATA", "LOCALAPPDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
)


def respond(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


class ProbeError(Exception):
    """Carries only a stable, redacted error code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


# --------------------------------------------------------------------------- #
# Parsing                                                                     #
# --------------------------------------------------------------------------- #
PROMPT_PREFIX = re.compile(r"^[^\s#>]{1,64}[#>]\s*(?=[Pp]ort\b)")
KNOWN_STATUSES = {
    "connected", "notconnect", "err-disabled", "disabled", "inactive", "monitoring", "sfpabsent",
    "faulty", "suspended", "xcvrabsen", "linkflape", "nooperem", "errdisable", "errdisabled", "channel-",
}


def _strip_prompt(line: str) -> str:
    """Without a PTY, IOS may print its prompt directly before the header."""
    return PROMPT_PREFIX.sub("", line, count=1)


def _header_columns(line: str):
    """Return (name_start, status_start, status_end) from the IOS header row."""
    lowered = line.lower()
    if not lowered.startswith("port"):
        return None
    status = lowered.find("status", 4)
    if status < 0:
        return None
    name = lowered.find("name", 4, status)
    vlan = lowered.find("vlan", status + 6)
    return (name if name >= 0 else status, status, vlan if vlan >= 0 else len(line))


def _clean_description(value: str) -> str:
    value = value.strip()
    # IOS uses -- when the Name column is empty.  Keep the bounded label only.
    if value in {"--", "-", "N/A"}:
        return ""
    return value[:128]


def _table_rows(output: str):
    """Yield (interface, name, status) for each data row of ``show interfaces status``.

    Column offsets from the header row are used so that port names containing
    spaces (or words such as "disabled") are never mistaken for a status.  A
    whitespace-split fallback handles rows that are not aligned to the header.
    """
    columns = None
    for raw in output.splitlines():
        line = _strip_prompt(raw.rstrip("\r"))
        if not line.strip():
            continue
        header = _header_columns(line)
        if header:
            columns = header
            continue
        fields = line.split()
        if not fields or not INTERFACE.fullmatch(fields[0]):
            continue
        interface = fields[0]
        if columns and len(line) > columns[1]:
            name_start, status_start, _ = columns
            aligned = line[status_start - 1].isspace() and not line[status_start].isspace()
            positional = line[status_start:].split()
            if aligned and positional and positional[0].lower() in KNOWN_STATUSES:
                yield interface, line[name_start:status_start], positional[0]
                continue
        # Fallback: the first token that is exactly the err-disabled keyword.
        try:
            index = next(i for i, field in enumerate(fields[1:], 1) if field.lower() == "err-disabled")
        except StopIteration:
            continue
        yield interface, " ".join(fields[1:index]), fields[index]


def has_status_table(output: str) -> bool:
    """True only when the device really answered ``show interfaces status``."""
    return any(_header_columns(_strip_prompt(line.rstrip("\r"))) for line in output.splitlines())


def cli_errors(output: str) -> bool:
    return any(CLI_ERROR.match(line) for line in output.splitlines())


def errdisabled_interfaces(output: str):
    """Return only an interface and its displayed status-name/description.

    Statuses such as ``disabled``, ``connected`` and ``notconnect`` are never
    reported; only the exact ``err-disabled`` status counts.  This deliberately
    returns no raw CLI line or other device data.
    """
    ports = {}
    for interface, name, status in _table_rows(output):
        if status.lower() != "err-disabled":
            continue
        ports.setdefault(interface, _clean_description(name))
    return [{"interface": interface, "description": ports[interface]} for interface in sorted(ports)]


def errdisabled_ports(output: str):
    """Compatibility helper for the recovery pre-/post-check."""
    return [item["interface"] for item in errdisabled_interfaces(output)]


# --------------------------------------------------------------------------- #
# ssh.exe transport                                                           #
# --------------------------------------------------------------------------- #
def ssh_executable() -> str:
    configured = os.environ.get("FAM_EQUIPMENT_SSH", "").strip()
    candidates = [configured] if configured else []
    system_root = os.environ.get("SystemRoot") or os.environ.get("windir")
    if system_root:
        candidates.append(os.path.join(system_root, "System32", "OpenSSH", "ssh.exe"))
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    if os.name == "nt":
        # Never pick up an arbitrary ssh from PATH (e.g. an MSYS build) on the
        # server: only the configured or in-box Windows OpenSSH client is used.
        raise ProbeError("executor_unavailable")
    found = shutil.which("ssh")
    if not found:
        raise ProbeError("executor_unavailable")
    return found


def known_hosts_file() -> str:
    configured = os.environ.get("FAM_EQUIPMENT_KNOWN_HOSTS", "").strip()
    path = configured or os.path.join(os.path.dirname(os.path.abspath(__file__)), "private", "equipment_known_hosts")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    return path


def runtime_directory() -> str:
    """Space-free private directory for the per-session askpass helper."""
    configured = os.environ.get("FAM_EQUIPMENT_RUNTIME_DIR", "").strip()
    path = configured or os.path.join(os.path.dirname(known_hosts_file()), "tmp")
    try:
        os.makedirs(path, exist_ok=True)
        return tempfile.mkdtemp(prefix="session-", dir=path)
    except OSError:
        return tempfile.mkdtemp(prefix="fam-equipment-")


def host_key_policy() -> str:
    value = os.environ.get("FAM_EQUIPMENT_HOST_KEY_POLICY", "accept-new").strip().lower()
    try:
        return HOST_KEY_POLICIES[value]
    except KeyError as exc:  # An unknown policy must never silently relax checking.
        raise ProbeError("executor_unavailable") from exc


def ssh_arguments(executable: str, host: str, username: str, known_hosts: str, policy: str):
    """Fixed, auditable argv.  The password is never part of it."""
    options = (
        LEGACY_CIPHER_OPTION,
        "StrictHostKeyChecking=" + policy,
        "UserKnownHostsFile=" + (('"%s"' % known_hosts) if any(char.isspace() for char in known_hosts) else known_hosts),
        "UpdateHostKeys=no",
        "CheckHostIP=no",
        "HashKnownHosts=no",
        "ConnectTimeout=%d" % CONNECT_TIMEOUT,
        "ConnectionAttempts=1",
        "ServerAliveInterval=5",
        "ServerAliveCountMax=3",
        "NumberOfPasswordPrompts=1",
        "PreferredAuthentications=keyboard-interactive,password",
        "PubkeyAuthentication=no",
        "KbdInteractiveAuthentication=yes",
        "PasswordAuthentication=yes",
        "GSSAPIAuthentication=no",
        "BatchMode=no",
        "ClearAllForwardings=yes",
        "ForwardAgent=no",
        "ForwardX11=no",
        "PermitLocalCommand=no",
        "ControlMaster=no",
        "ControlPath=none",
        "RequestTTY=no",
        "EscapeChar=none",
        "LogLevel=ERROR",
    )
    argv = [executable, "-T", "-p", "22"]
    for option in options:
        argv += ["-o", option]
    argv += ["-l", username, host]
    return argv


def _child_environment(askpass_path: str, password: str):
    env = {}
    for key in ENV_PASSTHROUGH:
        value = os.environ.get(key)
        # Windows environment names are case-insensitive; never emit duplicates.
        if value is not None and key.upper() not in {name.upper() for name in env}:
            env[key] = value
    system_root = env.get("SystemRoot") or env.get("windir")
    if system_root and "ComSpec" not in env:
        env["ComSpec"] = os.path.join(system_root, "System32", "cmd.exe")
    # DISPLAY makes OpenSSH <= 8.3 use the askpass program when no console is
    # attached; SSH_ASKPASS_REQUIRE=force does the same on OpenSSH >= 8.4.
    env.update({
        "DISPLAY": "fam-equipment:0",
        "SSH_ASKPASS": askpass_path,
        "SSH_ASKPASS_REQUIRE": "force",
        SECRET_ENV: password,
    })
    return env


def _creation_flags() -> int:
    # No console is attached, so ssh.exe cannot fall back to an interactive
    # password prompt; it must use SSH_ASKPASS or fail.
    return getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)


def run_ssh(job, commands, timeout: float):
    """Run one bounded ssh.exe session; return (returncode, stdout, stderr, timed_out)."""
    for name in FORBIDDEN_CIPHERS:
        if name in LEGACY_CIPHER_OPTION:
            raise ProbeError("executor_unavailable")
    executable = ssh_executable()
    argv = ssh_arguments(executable, job["host"], job["username"], known_hosts_file(), host_key_policy())
    script = ("\n".join(commands) + "\n").encode("ascii")
    workdir = runtime_directory()
    askpass = os.path.join(workdir, "askpass.cmd")
    process = None
    try:
        with open(askpass, "w", encoding="ascii", newline="") as handle:
            handle.write(ASKPASS_SCRIPT)
        try:
            os.chmod(askpass, 0o700)
        except OSError:
            pass
        process = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_child_environment(askpass, job["password"]),
            cwd=workdir,
            creationflags=_creation_flags(),
        )
        try:
            out, err = process.communicate(script, timeout=max(1.0, timeout))
            timed_out = False
        except subprocess.TimeoutExpired:
            process.kill()
            out, err = process.communicate()
            timed_out = True
        return process.returncode, out[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"), err[:65536].decode("utf-8", "replace"), timed_out
    finally:
        if process is not None and process.poll() is None:
            process.kill()
        # The askpass file never contains the secret, but it must not outlive
        # the session either.
        try:
            os.remove(askpass)
        except OSError:
            pass
        shutil.rmtree(workdir, ignore_errors=True)


def classify_failure(stderr: str, timed_out: bool) -> str:
    text = stderr.lower()
    if timed_out:
        return "connection_timeout"
    if "ssh_askpass" in text:
        # The askpass helper could not be started: a server-side setup problem.
        return "executor_unavailable"
    if "permission denied" in text or "authentication failed" in text or "too many authentication failures" in text:
        return "authentication_failed"
    if "host key verification failed" in text or "remote host identification has changed" in text or ("host key for" in text and "has changed" in text):
        return "host_key_rejected"
    if "timed out" in text or "timeout" in text:
        return "connection_timeout"
    return "connection_failed"


class Deadline:
    def __init__(self, seconds: float):
        self.until = time.monotonic() + seconds

    def session_timeout(self) -> float:
        remaining = self.until - time.monotonic()
        if remaining <= 1:
            raise ProbeError("connection_timeout")
        return min(SESSION_TIMEOUT, remaining)


def session_output(job, commands, deadline: Deadline) -> str:
    code, out, err, timed_out = run_ssh(job, commands, deadline.session_timeout())
    if timed_out or code == 255 or (code != 0 and not out.strip()):
        raise ProbeError(classify_failure(err, timed_out))
    return out


def status_table(job, deadline: Deadline) -> str:
    output = session_output(job, STATUS_COMMANDS, deadline)
    if not has_status_table(output):
        # Malformed/unexpected output must never be reported as "clean".
        raise ProbeError("connection_failed")
    return output


# --------------------------------------------------------------------------- #
# Operations                                                                  #
# --------------------------------------------------------------------------- #
def status(job):
    deadline = Deadline(HELPER_DEADLINE["status"])
    # Fixed commands only.  Raw output is parsed then discarded.
    return {"ok": True, "ports": errdisabled_interfaces(status_table(job, deadline))}


def recovery_commands(interface: str):
    # This is the only allowed configuration sequence.  Do not enable, save,
    # or execute any caller-provided command.
    assert INTERFACE.fullmatch(interface)
    return ("terminal length 0", "configure terminal", "interface " + interface, "shutdown", "no shutdown", "end", "exit")


def recover(job):
    interface = job["interface"]
    deadline = Deadline(HELPER_DEADLINE["recover"])
    if interface not in errdisabled_ports(status_table(job, deadline)):
        return {"ok": True, "recovery": "not_errdisabled"}
    config_output = session_output(job, recovery_commands(interface), deadline)
    if cli_errors(config_output):
        # e.g. insufficient privilege: nothing was changed, nothing is saved.
        raise ProbeError("recovery_rejected")
    after = errdisabled_ports(status_table(job, deadline))
    return {"ok": True, "recovery": "still_errdisabled" if interface in after else "recovered"}


def execute(value):
    """Run one already-decoded, bounded job and return only its safe result."""
    if not isinstance(value, dict) or set(value) not in ({"operation", "host", "username", "password"}, {"operation", "host", "username", "password", "interface"}):
        return {"ok": False, "error": "invalid_request"}
    if value.get("operation") not in {"status", "recover"} or not all(isinstance(value.get(key), str) for key in ("host", "username", "password")):
        return {"ok": False, "error": "invalid_request"}
    try:
        address = ipaddress.ip_address(value["host"])
    except ValueError:
        return {"ok": False, "error": "invalid_request"}
    if not isinstance(address, ipaddress.IPv4Address) or not any(address in network for network in RFC1918_NETWORKS):
        return {"ok": False, "error": "invalid_request"}
    if not USERNAME.fullmatch(value["username"]):
        return {"ok": False, "error": "invalid_request"}
    password = value["password"]
    if not 1 <= len(password) <= 512 or not all(0x20 <= ord(char) <= 0x7E for char in password):
        return {"ok": False, "error": "invalid_request"}
    if value["operation"] == "recover" and (not isinstance(value.get("interface"), str) or not INTERFACE.fullmatch(value["interface"])):
        return {"ok": False, "error": "invalid_request"}
    if value["operation"] == "status" and "interface" in value:
        return {"ok": False, "error": "invalid_request"}
    job = {"host": str(address), "username": value["username"], "password": password}
    if value["operation"] == "recover":
        job["interface"] = value["interface"]
    try:
        return status(job) if value["operation"] == "status" else recover(job)
    except ProbeError as exc:
        return {"ok": False, "error": exc.code}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "connection_timeout"}
    except Exception:  # Map every library/OS detail to one stable code.
        return {"ok": False, "error": "connection_failed"}


def main():
    try:
        value = json.loads(sys.stdin.buffer.read(4096).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        respond({"ok": False, "error": "invalid_request"})
        return
    respond(execute(value))


if __name__ == "__main__":
    main()
