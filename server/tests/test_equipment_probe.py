"""Direct ssh.exe equipment probe: mocked OpenSSH child process.

These tests never open a network connection.  ``subprocess.Popen`` inside
``server.equipment_probe`` is replaced by a fake that records the exact argv,
environment and stdin the helper would hand to Windows OpenSSH and that
inspects the askpass helper while it exists.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from server import equipment_ops, equipment_probe

PASSWORD = "Tr@nsient&Pass|word<123>^%!"
USERNAME = "netops.user"
HOST = "10.2.35.2"

TABLE_CLEAN = """
Switch#Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   ATM 17             connected    10         a-full  a-1000 10/100/1000BaseTX
Gi1/0/2   disabled port      disabled     1            auto   auto 10/100/1000BaseTX
Gi1/0/3                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/4   err-disabled name  connected    trunk      a-full a-1000 10/100/1000BaseTX
Te1/1/1   --                 connected    trunk      a-full a-10G  SFP-10GBase-SR
Switch#
"""

TABLE_ERRDISABLED = """
Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   ATM 17             err-disabled 10           auto   auto 10/100/1000BaseTX
Gi1/0/2                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/7   --                 err-disabled 20           auto   auto 10/100/1000BaseTX
"""

TABLE_RECOVERED = TABLE_ERRDISABLED.replace("err-disabled 10 ", "notconnect   10 ")


DESCRIPTION_TABLE = "Interface                      Status         Protocol Description\nGi0/1                          up             up       Uplink core\nGi0/7                          down           down     ATM 17\nGi0/8                          admin down     down     Spare\n"

class FakeProcess:
    """Stands in for the ssh.exe Popen handle."""

    def __init__(self, recorder, script, argv, kwargs):
        self.recorder = recorder
        self.script = script
        self.argv = argv
        self.kwargs = kwargs
        self.returncode = None
        self.killed = False

    def communicate(self, input=None, timeout=None):
        askpass = self.kwargs["env"]["SSH_ASKPASS"]
        self.recorder.append({
            "argv": list(self.argv),
            "env": dict(self.kwargs["env"]),
            "stdin": input.decode("ascii") if input is not None else None,
            "timeout": timeout,
            "askpass_exists": os.path.isfile(askpass),
            "askpass_text": (Path(askpass).parent / "askpass.cs").read_text(encoding="ascii"),
            "askpass_path": askpass,
            "creationflags": self.kwargs.get("creationflags"),
        })
        if self.killed:
            return b"", b""
        step = self.script.pop(0)
        if step.get("hang"):
            raise subprocess.TimeoutExpired(self.argv, timeout)
        self.returncode = step.get("code", 0)
        return step.get("out", "").encode("utf-8"), step.get("err", "").encode("utf-8")

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


class ProbeHarness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.ssh = root / "ssh.exe"
        self.ssh.write_bytes(b"")
        self.known_hosts = root / "data" / "equipment" / "known_hosts"
        self.environ = mock.patch.dict(os.environ, {
            "FAM_EQUIPMENT_SSH": str(self.ssh),
            "FAM_EQUIPMENT_KNOWN_HOSTS": str(self.known_hosts),
            "FAM_EQUIPMENT_HOST_KEY_POLICY": "accept-new",
            "FAM_EQUIPMENT_TICKET_KEY": "unit-test-ticket-key",
        })
        self.environ.start()
        os.environ.pop("FAM_EQUIPMENT_RUNTIME_DIR", None)
        self.calls = []
        def prepare(directory):
            (Path(directory) / "askpass.cs").write_text(equipment_probe.ASKPASS_SOURCE, encoding="ascii")
            executable = Path(directory) / "askpass.exe"
            executable.write_bytes(b"mock-executable-no-secret")
            return str(executable)
        self.real_prepare = equipment_probe.prepare_askpass
        self.prepare_mock = mock.patch.object(equipment_probe, "prepare_askpass", side_effect=prepare)
        self.prepare_mock.start()

    def tearDown(self):
        self.prepare_mock.stop()
        self.environ.stop()
        self.temp.cleanup()

    def run_probe(self, job, script):
        calls = self.calls
        processes = []

        def popen(argv, **kwargs):
            process = FakeProcess(calls, script, argv, kwargs)
            processes.append(process)
            return process

        with mock.patch.object(equipment_probe.subprocess, "Popen", side_effect=popen):
            result = equipment_probe.execute(job)
        self.processes = processes
        return result

    def status_job(self, **extra):
        return {"operation": "status", "host": HOST, "username": USERNAME, "password": PASSWORD, **extra}

    def recover_job(self, interface="Gi1/0/1"):
        return {"operation": "recover", "host": HOST, "username": USERNAME, "password": PASSWORD, "interface": interface}


class SshExeTransportTests(ProbeHarness):
    def test_building_shared_range_reaches_ssh_but_other_100_ranges_do_not(self):
        for host in ['100.100.1.22','100.108.1.22','100.107.1.22','100.64.0.0','100.127.255.255']:
            self.calls.clear()
            self.assertEqual(self.run_probe(self.status_job(host=host),[{'out':TABLE_CLEAN}]),{'ok':True,'ports':[]})
            self.assertIn(host,self.calls[0]['argv'])
        for host in ['100.63.255.255','100.128.0.0','100.1.1.22','127.0.0.1','169.254.1.1','::ffff:100.100.1.22','100.100.1.256']:
            self.calls.clear()
            self.assertEqual(self.run_probe(self.status_job(host=host),[]),{'ok':False,'error':'invalid_request'})
            self.assertEqual(self.calls,[])

    def test_successful_connection_uses_only_aes128_cbc_legacy_exception(self):
        result = self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertEqual(result, {"ok": True, "ports": []})
        argv = self.calls[0]["argv"]
        self.assertEqual(argv[0], str(self.ssh))
        self.assertIn("-o", argv)
        self.assertIn("Ciphers=+aes128-cbc", argv)
        self.assertEqual(sum(1 for item in argv if item.startswith("Ciphers=")), 1)
        joined = " ".join(argv)
        for forbidden in ("3des-cbc", "aes192-cbc", "aes256-cbc", "+*", "*-cbc"):
            self.assertNotIn(forbidden, joined)
        self.assertNotIn("StrictHostKeyChecking=no", joined)
        self.assertIn("StrictHostKeyChecking=accept-new", argv)
        self.assertIn("UserKnownHostsFile=" + str(self.known_hosts), argv)
        self.assertTrue(self.known_hosts.parent.is_dir())
        self.assertIn("ConnectTimeout=%d" % equipment_probe.CONNECT_TIMEOUT, argv)
        self.assertIn("PubkeyAuthentication=no", argv)
        self.assertIn("NumberOfPasswordPrompts=1", argv)
        self.assertEqual(argv[-3:], ["-l", USERNAME, HOST])

    def test_status_sends_only_fixed_commands(self):
        self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertEqual(self.calls[0]["stdin"], "terminal length 0\nshow interfaces status\nexit\n")
        self.assertEqual(len(self.calls), 1)

    def test_clean_device_reports_no_errdisabled_ports(self):
        result = self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertEqual(result, {"ok": True, "ports": []})

    def test_errdisabled_port_returns_interface_and_description_only(self):
        result = self.run_probe(self.status_job(), [{"out": TABLE_ERRDISABLED}])
        self.assertEqual(result, {"ok": True, "ports": [
            {"interface": "Gi1/0/1", "description": "ATM 17"},
            {"interface": "Gi1/0/7", "description": ""},
        ]})
        for item in result["ports"]:
            self.assertEqual(set(item), {"interface", "description"})

    def test_raw_output_banner_prompt_and_credentials_never_leave_the_helper(self):
        banner = "Unauthorized access prohibited! Switch-Core-01#\n"
        result = self.run_probe(self.status_job(), [{"out": banner + TABLE_ERRDISABLED, "err": "Warning: Permanently added '10.2.35.2' (RSA)"}])
        serialized = json.dumps(result)
        for secret in (PASSWORD, USERNAME, "Switch-Core-01", "Unauthorized", "Vlan", "10/100/1000BaseTX", "notconnect", "Permanently added"):
            self.assertNotIn(secret, serialized)

    def test_authentication_failure_is_redacted(self):
        result = self.run_probe(self.status_job(), [{"code": 255, "err": "netops.user@10.2.35.2: Permission denied (keyboard-interactive,password)."}])
        self.assertEqual(result, {"ok": False, "error": "authentication_failed"})

    def test_connection_timeout_from_ssh_is_redacted(self):
        result = self.run_probe(self.status_job(), [{"code": 255, "err": "ssh: connect to host 10.2.35.2 port 22: Connection timed out"}])
        self.assertEqual(result, {"ok": False, "error": "connection_timeout"})

    def test_hung_ssh_child_is_killed_and_reported_as_timeout(self):
        result = self.run_probe(self.status_job(), [{"hang": True}])
        self.assertEqual(result, {"ok": False, "error": "connection_timeout"})
        self.assertTrue(self.processes[0].killed)

    def test_connection_failure_and_cipher_mismatch_are_redacted(self):
        refused = self.run_probe(self.status_job(), [{"code": 255, "err": "ssh: connect to host 10.2.35.2 port 22: Connection refused"}])
        self.assertEqual(refused, {"ok": False, "error": "connection_failed"})
        self.calls.clear()
        cipher = self.run_probe(self.status_job(), [{"code": 255, "err": "Unable to negotiate with 10.2.35.2 port 22: no matching cipher found. Their offer: aes128-cbc,3des-cbc"}])
        self.assertEqual(cipher, {"ok": False, "error": "connection_failed"})

    def test_host_key_change_is_refused_with_safe_code(self):
        result = self.run_probe(self.status_job(), [{"code": 255, "err": "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed."}])
        self.assertEqual(result, {"ok": False, "error": "connection_failed"})

    def test_malformed_output_is_never_reported_as_clean(self):
        for output in ("Port Name Status Vlan Duplex Speed Type\n", "Port Name Status Vlan Duplex Speed Type\nGi0/1 malformed\n", "", "% Invalid input detected at '^' marker.\n", "garbage without any table\nGi1/0/1 something\n"):
            self.calls.clear()
            result = self.run_probe(self.status_job(), [{"out": output}])
            self.assertEqual(result, {"ok": False, "error": "status_unreadable"}, output)

    def test_errdisabled_status_variants_are_not_reported_clean(self):
        for variant in ('err-disabled','errdisable','errdisabled'):
            result=self.run_probe(self.status_job(), [{'out':TABLE_ERRDISABLED.replace('err-disabled',variant)}])
            self.assertTrue(result['ok']);self.assertEqual([p['interface'] for p in result['ports']],['Gi1/0/1','Gi1/0/7'])

    def test_partially_parsed_error_row_must_not_be_clean(self):
        for broken in ('Gi1/0/99 bad-format err-disabled','Gi1/0/99 -- unknown-state 1 auto auto 10/100','Gi1/0/99: -- err-disabled','Gi1/0/1 bad-format err-disabled','--More--'):
            result=self.run_probe(self.status_job(), [{'out':TABLE_CLEAN+broken+'\n'}])
            self.assertEqual(result, {'ok':False,'error':'status_unreadable'})

    def test_recovery_requires_target_in_precheck_and_postcheck(self):
        missing=TABLE_CLEAN.replace('Gi1/0/1','Gi1/0/99')
        result=self.run_probe(self.recover_job(), [{'out':missing}])
        self.assertEqual(result, {'ok':False,'error':'status_unreadable'})
        self.calls.clear()
        result=self.run_probe(self.recover_job(), [{'out':TABLE_ERRDISABLED},{'out':''},{'out':missing}])
        self.assertEqual(result, {'ok':False,'error':'status_unreadable'})

    def test_descriptions_uses_only_fixed_read_command_and_preserves_table(self):
        result=self.run_probe({**self.status_job(),'operation':'descriptions'},[{'out':'Private banner '+PASSWORD+'\nSwitch#'+DESCRIPTION_TABLE+'Switch#exit\n'}])
        self.assertEqual(result,{'ok':True,'output':DESCRIPTION_TABLE,'redacted':False})
        self.assertEqual(self.calls[0]['stdin'],'terminal length 0\nshow interfaces description\nexit\n')
        self.assertNotIn(PASSWORD,str(result));self.assertNotIn('Switch#',result['output'])

    def test_descriptions_redacts_credentials_and_sensitive_payload_only(self):
        table=DESCRIPTION_TABLE.replace('ATM 17','token SUPER-SENSITIVE').replace('Uplink core',PASSWORD)
        result=self.run_probe({**self.status_job(),'operation':'descriptions'},[{'out':table}])
        self.assertTrue(result['ok']);self.assertTrue(result['redacted']);self.assertNotIn(PASSWORD,result['output']);self.assertNotIn('SUPER-SENSITIVE',result['output']);self.assertIn('[REDACTED]',result['output'])

    def test_descriptions_rejects_partial_unexpected_paginated_and_oversized_output(self):
        for table in ('','Interface Status Protocol Description\n',DESCRIPTION_TABLE+'unexpected banner\n',DESCRIPTION_TABLE+'--More--',DESCRIPTION_TABLE+'x'*100001,DESCRIPTION_TABLE.replace('ATM 17','\x1b[31msecret')):
            result=self.run_probe({**self.status_job(),'operation':'descriptions'},[{'out':table}]);self.assertEqual(result,{'ok':False,'error':'descriptions_unreadable'})
        count=len(self.calls)
        result=equipment_probe.execute({**self.status_job(),'operation':'descriptions','interface':'Gi0/1'})
        self.assertEqual(result,{'ok':False,'error':'invalid_request'});self.assertEqual(len(self.calls),count)

    def test_inspect_reads_both_tables_with_one_ssh_and_one_askpass(self):
        result=self.run_probe({**self.status_job(),'operation':'inspect'},[{'out':TABLE_ERRDISABLED+'Switch#show interfaces description\n'+DESCRIPTION_TABLE+'Switch#exit\n'}])
        self.assertTrue(result['ok']);self.assertEqual(result['descriptions']['output'],DESCRIPTION_TABLE)
        self.assertEqual(len(result['ports']),2);self.assertEqual(len(self.calls),1);self.assertEqual(equipment_probe.prepare_askpass.call_count,1)
        self.assertEqual(self.calls[0]['stdin'],'terminal length 0\nshow interfaces status\nshow interfaces description\nexit\n')
        self.assertGreater(self.calls[0]['timeout'],equipment_probe.SESSION_TIMEOUT)
        self.assertGreater(equipment_ops.EXECUTOR_TIMEOUT['inspect'],equipment_probe.HELPER_DEADLINE['inspect'])
        self.assertEqual(set(result['timings']),{'preparationMs','sshMs'});self.assertTrue(all(type(v) is int and v>=0 for v in result['timings'].values()))
        self.assertFalse(os.path.exists(self.calls[0]['askpass_path']));self.assertNotIn(PASSWORD,str(result))

    def test_inspect_never_reconnects_on_ambiguous_boundary_or_timeout(self):
        for step,error in [({'out':TABLE_CLEAN},'descriptions_unreadable'),({'hang':True},'connection_timeout')]:
            self.calls.clear();result=self.run_probe({**self.status_job(),'operation':'inspect'},[step])
            self.assertEqual(result,{'ok':False,'error':error});self.assertEqual(len(self.processes),1)

    def test_inspect_keeps_valid_status_when_description_table_is_malformed(self):
        result=self.run_probe({**self.status_job(),'operation':'inspect'},[{'out':TABLE_ERRDISABLED+'Interface Status Protocol Description\nGi0/1 malformed\n'}])
        self.assertTrue(result['ok']);self.assertEqual(len(result['ports']),2);self.assertEqual(result['descriptions'],{'ok':False,'error':'descriptions_unreadable'});self.assertEqual(len(self.calls),1)

    def test_recovery_compiles_askpass_once_but_preserves_three_ssh_safety_steps(self):
        result=self.run_probe(self.recover_job(),[{'out':TABLE_ERRDISABLED},{'out':''},{'out':TABLE_RECOVERED}])
        self.assertEqual(result,{'ok':True,'recovery':'recovered'});self.assertEqual(len(self.calls),3);self.assertEqual(equipment_probe.prepare_askpass.call_count,1)
        paths={call['askpass_path'] for call in self.calls};self.assertEqual(len(paths),1);self.assertTrue(all(not os.path.exists(path) for path in paths))
        self.assertEqual(self.calls[0]['stdin'],self.calls[2]['stdin']);self.assertIn('shutdown\nno shutdown',self.calls[1]['stdin'])

    def test_password_is_only_in_child_environment_never_argv_or_askpass_file(self):
        self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        call = self.calls[0]
        self.assertNotIn(PASSWORD, " ".join(call["argv"]))
        self.assertNotIn(PASSWORD, call["stdin"])
        self.assertTrue(call["askpass_exists"])
        self.assertNotIn(PASSWORD, call["askpass_text"])
        self.assertIn(equipment_probe.SECRET_ENV, call["askpass_text"])
        self.assertIn("Environment.GetEnvironmentVariable", call["askpass_text"])
        self.assertTrue(call["askpass_path"].endswith(".exe"))
        self.assertNotIn("%1", call["askpass_text"])
        self.assertEqual(call["env"][equipment_probe.SECRET_ENV], PASSWORD)
        self.assertEqual(call["env"]["SSH_ASKPASS"], call["askpass_path"])
        self.assertEqual(call["env"]["SSH_ASKPASS_REQUIRE"], "force")
        self.assertTrue(call["env"]["DISPLAY"])
        self.assertNotIn("FAM_EQUIPMENT_TICKET_KEY", call["env"])
        self.assertNotIn(" ", call["askpass_path"])

    def test_askpass_file_is_removed_in_finally_even_on_failure(self):
        self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertFalse(os.path.exists(self.calls[0]["askpass_path"]))
        self.assertFalse(os.path.exists(os.path.dirname(self.calls[0]["askpass_path"])))
        self.calls.clear()
        self.run_probe(self.status_job(), [{"hang": True}])
        self.assertFalse(os.path.exists(self.calls[0]["askpass_path"]))
        self.calls.clear()
        with mock.patch.object(equipment_probe.subprocess, "Popen", side_effect=OSError("spawn failed")):
            result = equipment_probe.execute(self.status_job())
        self.assertEqual(result, {"ok": False, "error": "connection_failed"})
        runtime = self.known_hosts.parent / "tmp"
        self.assertEqual([entry for entry in runtime.iterdir()] if runtime.exists() else [], [])

    def test_recovery_is_bounded_with_precheck_and_postcheck(self):
        result = self.run_probe(self.recover_job("Gi1/0/1"), [
            {"out": TABLE_ERRDISABLED},
            {"out": "Enter configuration commands, one per line.  End with CNTL/Z.\n"},
            {"out": TABLE_RECOVERED},
        ])
        self.assertEqual(result, {"ok": True, "recovery": "recovered"})
        self.assertEqual([call["stdin"] for call in self.calls], [
            "terminal length 0\nshow interfaces status\nexit\n",
            "terminal length 0\nconfigure terminal\ninterface Gi1/0/1\nshutdown\nno shutdown\nend\nexit\n",
            "terminal length 0\nshow interfaces status\nexit\n",
        ])
        everything = "\n".join(call["stdin"] for call in self.calls)
        for forbidden in ("enable", "write", "copy", "reload", "erase", "username", "crypto"):
            self.assertNotIn(forbidden, everything)

    def test_recovery_skips_configuration_when_port_is_not_errdisabled(self):
        result = self.run_probe(self.recover_job("Gi1/0/2"), [{"out": TABLE_ERRDISABLED}])
        self.assertEqual(result, {"ok": True, "recovery": "not_errdisabled"})
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn("configure", self.calls[0]["stdin"])

    def test_recovery_reports_still_errdisabled_after_postcheck(self):
        result = self.run_probe(self.recover_job("Gi1/0/7"), [{"out": TABLE_ERRDISABLED}, {"out": ""}, {"out": TABLE_ERRDISABLED}])
        self.assertEqual(result, {"ok": True, "recovery": "still_errdisabled"})

    def test_recovery_rejected_by_device_changes_nothing_else(self):
        result = self.run_probe(self.recover_job("Gi1/0/1"), [{"out": TABLE_ERRDISABLED}, {"out": "% Invalid input detected at '^' marker.\n"}])
        self.assertEqual(result, {"ok": False, "error": "connection_failed"})
        self.assertEqual(len(self.calls), 2)

    def test_session_timeouts_fit_inside_backend_executor_timeout(self):
        self.assertLess(equipment_probe.CONNECT_TIMEOUT, equipment_probe.SESSION_TIMEOUT)
        self.assertLessEqual(equipment_probe.SESSION_TIMEOUT, equipment_probe.HELPER_DEADLINE["status"])
        self.assertLessEqual(3 * equipment_probe.SESSION_TIMEOUT, equipment_probe.HELPER_DEADLINE["recover"])
        for operation in ("status", "recover"):
            self.assertGreaterEqual(equipment_ops.EXECUTOR_TIMEOUT[operation] - equipment_probe.HELPER_DEADLINE[operation], 5)
        self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertLessEqual(self.calls[0]["timeout"], equipment_probe.SESSION_TIMEOUT)

    def test_invalid_requests_are_rejected_before_any_ssh(self):
        bad = [
            self.status_job(host="8.8.8.8"),
            self.status_job(host="10.2.35.2", username="user\" & calc & \""),
            self.status_job(username="-oProxyCommand=calc"),
            self.status_job(password="pässwörd"),
            self.status_job(password="with\nnewline"),
            self.status_job(interface="Gi1/0/1"),
            {**self.recover_job(), "interface": "Gi1/0/1; reload"},
            {**self.status_job(), "command": "show run"},
            "not a dict",
            self.status_job(operation=[]),
            self.status_job(operation={}),
        ]
        for job in bad:
            self.calls.clear()
            self.assertEqual(self.run_probe(job, []), {"ok": False, "error": "invalid_request"}, job)
            self.assertEqual(self.calls, [])

    def test_strict_policy_and_unknown_policy(self):
        with mock.patch.dict(os.environ, {"FAM_EQUIPMENT_HOST_KEY_POLICY": "strict"}):
            self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertIn("StrictHostKeyChecking=yes", self.calls[0]["argv"])
        self.calls.clear()
        with mock.patch.dict(os.environ, {"FAM_EQUIPMENT_HOST_KEY_POLICY": "no"}):
            result = self.run_probe(self.status_job(), [{"out": TABLE_CLEAN}])
        self.assertEqual(result, {"ok": False, "error": "connection_failed"})
        self.assertEqual(self.calls, [])

    def test_nonzero_exit_even_with_table_is_not_clean(self):
        result = self.run_probe(self.status_job(), [{"code": 1, "out": TABLE_CLEAN}])
        self.assertEqual(result, {"ok": False, "error": "connection_failed"})

    def test_compiler_never_receives_secret_and_has_bounded_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            def compile(argv, **kwargs):
                self.assertNotIn(PASSWORD, " ".join(argv))
                self.assertNotIn(PASSWORD, Path(argv[-1]).read_text())
                self.assertNotIn(equipment_probe.SECRET_ENV, kwargs["env"])
                self.assertEqual(kwargs["timeout"], 5)
                Path(directory, "askpass.exe").write_bytes(b"compiled-test-helper")
                return subprocess.CompletedProcess(argv, 0)
            with mock.patch.dict(os.environ, {equipment_probe.SECRET_ENV: PASSWORD}), \
                 mock.patch.object(equipment_probe.os.path, "isfile", return_value=True), \
                 mock.patch.object(equipment_probe.subprocess, "run", side_effect=compile):
                result = self.real_prepare(directory)
            self.assertTrue(result.endswith("askpass.exe"))

    def test_source_has_no_netmiko_paramiko_or_preferred_ciphers_workaround(self):
        source = Path(equipment_probe.__file__).read_text(encoding="utf-8")
        for forbidden in ("netmiko", "paramiko", "_preferred_ciphers", "StrictHostKeyChecking=no"):
            self.assertNotIn(forbidden, source)
        requirements = (Path(equipment_probe.__file__).parent / "requirements.txt").read_text(encoding="utf-8")
        self.assertNotRegex(requirements, r"(?m)^netmiko")


if __name__ == "__main__":
    unittest.main()
