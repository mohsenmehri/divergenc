"""Bounded FAM IOS filters. No network, files, subprocess or credential storage."""
import ipaddress
import re
from ansible.errors import AnsibleFilterError

INTERFACE = re.compile(r"[A-Za-z][A-Za-z0-9/.-]{0,63}\Z")
USERNAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@\\-]{0,63}\Z")
CLI_ERROR = re.compile(r"^\s*%\s+\S")
NETWORKS = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10'))
class ProbeError(Exception):
    pass

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
        # Non-aligned fixtures/devices: status must be followed by a VLAN and
        # the duplex/speed/type columns, never just a word in a description.
        for index in range(len(fields) - 5, 0, -1):
            if (fields[index].lower() in KNOWN_STATUSES and
                    re.fullmatch(r"[0-9]+|trunk|routed|unassigned", fields[index + 1], re.I)):
                yield interface, " ".join(fields[1:index]), fields[index]
                break


def has_status_table(output: str) -> bool:
    """True only when the device really answered ``show interfaces status``."""
    return any(_header_columns(_strip_prompt(line.rstrip("\r"))) for line in output.splitlines())


def cli_errors(output: str) -> bool:
    return any(CLI_ERROR.match(line) for line in output.splitlines())


def errdisabled_interfaces(output: str):
    """Return only an interface and its displayed status-name/description.

    Statuses such as ``disabled``, ``connected`` and ``notconnect`` are never
    reported; only explicit err-disabled status variants count.  This deliberately
    returns no raw CLI line or other device data.
    """
    ports = {}
    for interface, name, status in _table_rows(output):
        if status.lower() not in {"err-disabled", "errdisable", "errdisabled"}:
            continue
        ports.setdefault(interface, _clean_description(name))
    return [{"interface": interface, "description": ports[interface]} for interface in sorted(ports)]


def errdisabled_ports(output: str):
    """Compatibility helper for the recovery pre-/post-check."""
    return [item["interface"] for item in errdisabled_interfaces(output)]


def validate_status_output(output: str) -> str:
    rows = list(_table_rows(output))
    # Never call a partially parsed table clean. A single unknown/truncated
    # interface row can be the failing port even if other rows parsed normally.
    parsed=[row[0] for row in rows]
    candidates=[];in_table=False;unparsed_error=False
    for raw in output.splitlines():
        line=_strip_prompt(raw.rstrip("\r"));fields=line.split()
        if _header_columns(line):in_table=True;continue
        if in_table and fields and INTERFACE.fullmatch(fields[0]) and any(c.isdigit() for c in fields[0]):candidates.append(fields[0])
        if in_table and fields and fields[0] not in parsed and re.search(r"\b(?:err-disabled|errdisable|errdisabled)\b",line,re.I):unparsed_error=True
    if (not has_status_table(output) or cli_errors(output) or not rows or "--More--" in output
            or unparsed_error or set(candidates)!=set(parsed) or len(candidates)!=len(parsed) or len(parsed)!=len(set(parsed))):
        raise ProbeError("status_unreadable")
    return output



def checked_host(value):
    if not isinstance(value,str):raise AnsibleFilterError('Invalid equipment IPv4')
    try:address=ipaddress.ip_address(value)
    except ValueError:raise AnsibleFilterError('Invalid equipment IPv4') from None
    if address.version!=4 or str(address)!=value or not any(address in n for n in NETWORKS):
        raise AnsibleFilterError('Equipment IPv4 outside approved ranges')
    return value

def fam_plan(value, recovery=False):
    if not isinstance(value,str) or not 1<=len(value)<=2048:raise AnsibleFilterError('Invalid plan')
    entries=value.split(',')
    if not 1<=len(entries)<=5:raise AnsibleFilterError('Select one to five targets')
    plan=[];seen=set()
    for entry in entries:
        parts=entry.strip().split(':')
        if len(parts)!=(2 if recovery else 1):raise AnsibleFilterError('Invalid target')
        host=checked_host(parts[0]);interface=parts[1] if recovery else None
        if interface is not None and (not INTERFACE.fullmatch(interface) or not any(c.isdigit() for c in interface)):
            raise AnsibleFilterError('Invalid interface')
        key=(host,interface)
        if key in seen:raise AnsibleFilterError('Duplicate target')
        seen.add(key);plan.append({'host':host,'interface':interface})
    return plan

def fam_credentials(username,password):
    return (isinstance(username,str) and USERNAME.fullmatch(username) is not None and
            isinstance(password,str) and 1<=len(password)<=512 and
            all(0x20<=ord(c)<=0x7e for c in password))

def fam_status(output):
    if (not isinstance(output,str) or len(output.encode('utf-8'))>1024*1024 or
            re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]',output)):
        raise AnsibleFilterError('Unreadable status; state unknown')
    try:validate_status_output(output)
    except ProbeError:raise AnsibleFilterError('Unreadable status; state unknown') from None
    # Never return labels, raw rows, banners, prompts, credentials or diagnostics.
    return {'interfaces':{row[0]:row[2].lower() for row in _table_rows(output)},
            'errdisabled':errdisabled_ports(output)}

class FilterModule:
    def filters(self):
        return {'fam_plan':fam_plan,'fam_credentials':fam_credentials,'fam_status':fam_status}
