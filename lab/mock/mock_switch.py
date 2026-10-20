#!/usr/bin/env python3
"""Mock Cisco IOS switch for the FAM lab. TEST TOOL ONLY.

This is original test software written for the FAM project. It is NOT Cisco
software, contains no Cisco code or images, and never ships in the customer
kit. It speaks a small subset of the IOS CLI on stdin/stdout so the FAM
equipment flows (SSH login, host-key verification, read-only interface
reviews, err-disabled recovery) can be exercised in the lab without hardware.

Run it behind OpenSSH ForceCommand for a dedicated lab user, for example:

    Match User mocksw
        ForceCommand /opt/fam-mock/mock_switch.py
        PasswordAuthentication yes
        PubkeyAuthentication no
        DisableForwarding yes
    Match all

Environment:
    FAM_MOCK_HOSTNAME  prompt hostname (default MOCK-2960)
    FAM_MOCK_STATE     JSON state path (default /tmp/fam-mock-state.json)

Supported commands (everything else answers an IOS-style error):
    terminal length 0
    show interfaces status
    show interfaces description
    show version
    configure terminal / interface <if> / shutdown / no shutdown / end / exit
"""
import json
import os
import re
import sys

HOSTNAME = os.environ.get("FAM_MOCK_HOSTNAME", "MOCK-2960").strip() or "MOCK-2960"
STATE_PATH = os.environ.get("FAM_MOCK_STATE", "/tmp/fam-mock-state.json")

STATUS_HEADER = "Port      Name               Status       Vlan       Duplex  Speed Type"
DESCRIPTION_HEADER = "Interface                      Status         Protocol Description"

# Canonical short names are used in ``show interfaces status`` (IOS style) and
# long names in ``show interfaces description``.
LONG_NAMES = {"Fa": "FastEthernet", "Gi": "GigabitEthernet", "Vl": "Vl"}


def short_name(long_name):
    match = re.fullmatch(r"(FastEthernet|GigabitEthernet|Vl)(\d+(?:/\d+)*)", long_name)
    if not match:
        return long_name
    prefix = {"FastEthernet": "Fa", "GigabitEthernet": "Gi", "Vl": "Vl"}[match.group(1)]
    return prefix + match.group(2)


def long_name(short):
    match = re.fullmatch(r"(Fa|Gi|Vl)(\d+(?:/\d+)*)", short)
    if not match:
        return short
    prefix = {"Fa": "FastEthernet", "Gi": "GigabitEthernet", "Vl": "Vl"}[match.group(1)]
    return prefix + match.group(2)


def normalize_interface(value):
    """Return the canonical short name (Fa0/3) or None."""
    value = value.strip()
    for pattern, prefix in (("FastEthernet", "Fa"), ("GigabitEthernet", "Gi"),
                            ("Gigabitethernet", "Gi"), ("fastethernet", "Fa"),
                            ("gigabitEthernet", "Gi")):
        if value.startswith(pattern):
            value = prefix + value[len(pattern):]
            break
    match = re.fullmatch(r"(Fa|Gi|Vl)(\d+(?:/\d+)*)", value, re.I)
    if not match:
        return None
    prefix = {"fa": "Fa", "gi": "Gi", "vl": "Vl"}[match.group(1).lower()]
    return prefix + match.group(2)


def default_state():
    """A realistic 2960-24TT-L bench: 24 Fa + 2 Gi + management VLAN."""
    rows = []

    def add(short, name, status, vlan, duplex="auto", speed="auto", ptype="10/100BaseTX"):
        rows.append({"short": short, "name": name, "status": status, "vlan": vlan,
                     "duplex": duplex, "speed": speed, "type": ptype})

    add("Fa0/1", "Access-PC-1", "connected", "1", "a-full", "a-100")
    add("Fa0/2", "Access-PC-2", "connected", "1", "a-full", "a-100")
    add("Fa0/3", "IP-Phone-1", "err-disabled", "1")
    for index in range(4, 9):
        add("Fa0/%d" % index, "", "notconnect", "1")
    add("Fa0/9", "Printer-1", "connected", "1", "a-full", "a-100")
    add("Fa0/10", "Access-PC-3", "connected", "1", "a-full", "a-100")
    # Deliberately sensitive wording so the lab can demonstrate [REDACTED].
    add("Fa0/11", "Camera secret 1234", "connected", "1", "a-full", "a-100")
    add("Fa0/12", "AP-Floor-1", "connected", "1", "a-full", "a-100")
    for index in range(13, 21):
        add("Fa0/%d" % index, "", "notconnect", "1")
    add("Fa0/21", "Spare-port", "disabled", "1")
    for index in range(22, 25):
        add("Fa0/%d" % index, "", "notconnect", "1")
    add("Gi0/1", "Uplink-DIST", "connected", "trunk", "a-full", "a-1000",
        "10/100/1000BaseTX")
    add("Gi0/2", "Uplink-CORE", "notconnect", "trunk", "auto", "auto",
        "10/100/1000BaseTX")
    return {"interfaces": rows,
            "management": {"short": "Vl1", "name": "Management", "status": "up"}}


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as handle:
            state = json.load(handle)
        if isinstance(state, dict) and isinstance(state.get("interfaces"), list):
            return state
    except (OSError, ValueError):
        pass
    state = default_state()
    save_state(state)
    return state


def save_state(state):
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as handle:
            json.dump(state, handle)
    except OSError:
        pass


def find_interface(state, short):
    for row in state["interfaces"]:
        if row["short"] == short:
            return row
    return None


# --------------------------------------------------------------------------- #
# Command handlers                                                            #
# --------------------------------------------------------------------------- #
def cmd_status(state):
    """``show interfaces status`` exactly as IOS columns are laid out."""
    lines = [STATUS_HEADER]
    for row in state["interfaces"]:
        name = row["name"] if row["name"] else ""
        lines.append("%-10s%-19s%-13s%-11s%-8s%-6s%s" % (
            row["short"][:10], name[:19], row["status"][:13], row["vlan"][:11],
            row["duplex"][:8], row["speed"][:6], row["type"]))
    return lines


def description_columns(status):
    """IOS 'show interfaces description' never prints err-disabled."""
    if status in ("connected", "up"):
        return "up", "up"
    if status in ("disabled",):
        return "admin down", "down"
    return "down", "down"


def cmd_description(state):
    lines = [DESCRIPTION_HEADER]
    rows = [(row["short"], row["name"], row["status"]) for row in state["interfaces"]]
    rows.insert(0, (state["management"]["short"], state["management"]["name"],
                    state["management"]["status"]))
    for short, name, status in rows:
        state_col, protocol = description_columns(status)
        lines.append("%-30s%-15s%-9s%s" % (
            long_name(short)[:30], state_col[:15], protocol[:9], name))
    return lines


def cmd_version():
    """A condensed 'show version' matching the WS-C2960-24TT-L bench."""
    return [
        "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE6, RELEASE SOFTWARE (fc2)",
        "Technical Support: http://www.cisco.com/techsupport",
        "Copyright (c) 1986-2014 by Cisco Systems, Inc.",
        "Compiled Wed 09-Apr-14 03:40 by prod_rel_team",
        "",
        "ROM: Bootstrap program is C2960 boot loader",
        "BOOTLDR: C2960 Boot Loader (C2960-HBOOT-M) Version 12.2(53r)SEY3, RELEASE SOFTWARE (fc1)",
        "",
        "%s uptime is 1 day, 2 hours, 3 minutes" % HOSTNAME,
        "System returned to ROM by power-on",
        "System image file is \"flash:c2960-lanbasek9-mz.150-2.SE6.bin\"",
        "",
        "cisco WS-C2960-24TT-L (PowerPC405) processor (revision R0) with 65536K bytes of memory.",
        "24 FastEthernet interfaces",
        "2 Gigabit Ethernet interfaces",
        "The password-recovery mechanism is enabled.",
        "64K bytes of flash-simulated non-volatile configuration memory.",
        "Base ethernet MAC Address       : 00:11:22:33:44:55",
        "Model number                    : WS-C2960-24TT-L",
        "System serial number            : FCQ00000001",
        "",
        "Configuration register is 0xF",
    ]


def cli_error():
    return ["% Invalid input detected at '^' marker."]


# --------------------------------------------------------------------------- #
# Session loop                                                                #
# --------------------------------------------------------------------------- #
def handle_line(state, line, mode, current_if):
    """Return (output_lines, mode, current_if, close_session)."""
    command = line.strip()
    if not command:
        return [""], mode, current_if, False
    lowered = command.lower()

    if lowered in ("exit", "quit", "logout"):
        if mode == "config-if":
            return [], "config", None, False
        if mode == "config":
            return [], "exec", None, False
        return [], mode, current_if, True
    if lowered == "end" and mode != "exec":
        return [], "exec", None, False
    if lowered in ("enable", "disable") and mode == "exec":
        return [], mode, current_if, False

    if lowered in ("terminal length 0", "terminal length 200"):
        return [], mode, current_if, False

    if lowered.startswith("show ") and mode == "exec":
        if lowered in ("show interfaces status", "show interface status",
                       "show interfaces status ", "show int status"):
            return cmd_status(state), mode, current_if, False
        if lowered in ("show interfaces description", "show interface description",
                       "show int des", "show interfaces desc",
                       "show interfaces descriptions"):
            return cmd_description(state), mode, current_if, False
        if lowered == "show version":
            return cmd_version(), mode, current_if, False
        return cli_error(), mode, current_if, False

    if lowered in ("configure terminal", "conf t", "configure t") and mode == "exec":
        return [], "config", None, False

    if mode in ("config", "config-if") and lowered.startswith("interface "):
        target = normalize_interface(command.split(None, 1)[1])
        if target and find_interface(state, target):
            return [], "config-if", target, False
        return cli_error(), mode, current_if, False

    if mode == "config-if" and lowered in ("shutdown", "shut"):
        row = find_interface(state, current_if)
        if row is not None and row["status"] != "disabled":
            row["resume"] = row["status"]
            row["status"] = "disabled"
            save_state(state)
        return [], mode, current_if, False

    if mode == "config-if" and lowered in ("no shutdown", "no shut"):
        row = find_interface(state, current_if)
        if row is not None and row["status"] == "disabled":
            resume = row.pop("resume", "notconnect")
            row["status"] = "connected" if resume in ("connected", "err-disabled") else "notconnect"
            save_state(state)
        return [], mode, current_if, False

    # Anything else (including write memory / copy / reload) is refused.
    return cli_error(), mode, current_if, False


def prompt_for(mode):
    if mode == "config":
        return HOSTNAME + "(config)#"
    if mode == "config-if":
        return HOSTNAME + "(config-if)#"
    return HOSTNAME + "#"


def run_session(state, script=None):
    mode, current_if = "exec", None
    if script is not None:
        commands = script.splitlines()
    else:
        commands = None
    while True:
        if commands is not None:
            if not commands:
                return
            line = commands.pop(0)
        else:
            line = sys.stdin.readline()
            if line == "":
                return
            line = line.rstrip("\r\n")
        sys.stdout.write(prompt_for(mode) + line + "\n")
        output, mode, current_if, close = handle_line(state, line, mode, current_if)
        for entry in output:
            sys.stdout.write(entry + "\n")
        sys.stdout.flush()
        if close:
            return


def main():
    state = load_state()
    remote = os.environ.get("SSH_ORIGINAL_COMMAND", "").strip()
    if remote:
        run_session(state, script=remote)
    else:
        run_session(state)


if __name__ == "__main__":
    main()
