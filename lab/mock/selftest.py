#!/usr/bin/env python3
"""Self-test for the FAM lab mock switch. TEST TOOL ONLY.

Feeds the same fixed command sequences the FAM probe sends to the mock and
validates the answers with the real product parsers (server/equipment_probe,
server/equipment_diagnostics).  If this prints "mock selftest: OK", the mock
is a faithful stand-in for the read-only FAM flows.

Usage:  python3 lab/mock/selftest.py
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "server"))

import equipment_probe as probe  # noqa: E402
import equipment_diagnostics as diagnostics  # noqa: E402

MOCK = os.path.join(HERE, "mock_switch.py")
JOB = {"username": "mocksw", "password": "lab-only-pass"}


def run(script, state):
    env = dict(os.environ, FAM_MOCK_STATE=state, FAM_MOCK_HOSTNAME="MOCK-2960")
    result = subprocess.run([sys.executable, MOCK], input=script,
                            capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    return result.stdout


def main():
    with tempfile.TemporaryDirectory() as tmp:
        state = os.path.join(tmp, "state.json")

        # 1) status session: strict validation + err-disabled reporting.
        out = run("terminal length 0\nshow interfaces status\nexit\n", state)
        probe.validate_status_output(out)
        ports = probe.safe_status_ports(out, JOB)["ports"]
        assert ports == [{"interface": "Fa0/3", "description": "IP-Phone-1"}], ports

        # 2) descriptions session: table parses and sensitive text is redacted.
        out = run("terminal length 0\nshow interfaces description\nexit\n", state)
        table, redacted = probe.descriptions_table(out, JOB["username"], JOB["password"])
        assert redacted, table
        assert "[REDACTED]" in table and "Camera secret 1234" not in table
        assert "FastEthernet0/11" in table and "GigabitEthernet0/1" in table

        # 3) inspect session: one authentication, split at the description header.
        out = run("terminal length 0\nshow interfaces status\n"
                  "show interfaces description\nexit\n", state)
        lines = out.splitlines()
        boundary = next(i for i, line in enumerate(lines)
                        if probe.DESCRIPTION_HEADER.fullmatch(
                            probe.DESCRIPTION_PROMPT.sub("", line, count=1)))
        probe.validate_status_output("\n".join(lines[:boundary]) + "\n")
        probe.descriptions_table("\n".join(lines[boundary:]) + "\n",
                                 JOB["username"], JOB["password"])

        # 4) recovery: before / bounce / after across three sessions.
        before = run("terminal length 0\nshow interfaces status\nexit\n", state)
        assert probe.errdisabled_ports(before) == ["Fa0/3"], before
        config = run("terminal length 0\nconfigure terminal\ninterface Fa0/3\n"
                     "shutdown\nno shutdown\nend\nexit\n", state)
        assert not probe.cli_errors(config), config
        after = run("terminal length 0\nshow interfaces status\nexit\n", state)
        probe.validate_status_output(after)
        assert probe.errdisabled_ports(after) == [], after

        # 5) show version matches the WS-C2960-24TT-L diagnostics profile.
        ver = run("terminal length 0\nshow version\nexit\n", state)
        profile = diagnostics.profile(ver)
        assert profile == {"model": "WS-C2960-24TT-L", "ios": "15.0(2)SE6",
                           "image": "c2960-lanbasek9-mz.150-2.SE6.bin"}, profile

        # 6) unknown commands fail honestly (never fake success).
        out = run("terminal length 0\nwrite memory\nexit\n", state)
        assert probe.cli_errors(out), out

    print("mock selftest: OK")


if __name__ == "__main__":
    main()
