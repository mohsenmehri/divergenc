"""Pure filter tests plus real Ansible engine with synthetic actions, NEVER SSH."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import shutil
import unittest

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/'exports/equipment-ansible'
spec=importlib.util.spec_from_file_location('fam_filters',PACKAGE/'filter_plugins/fam_equipment.py')
filters=importlib.util.module_from_spec(spec);spec.loader.exec_module(filters)
HEADER='Port Name Status Vlan Duplex Speed Type\n'
ERROR=HEADER+'Gi0/7 Fixture err-disabled 1 auto auto 10/100\nGi0/8 Other disabled 1 auto auto 10/100\n'

class Filters(unittest.TestCase):
    def test_building_targets_private_ranges_and_five_target_bound(self):
        self.assertEqual(filters.fam_plan('100.100.1.22,100.108.1.22,100.107.1.22')[0]['host'],'100.100.1.22')
        self.assertEqual(filters.fam_plan('100.100.1.22:Gi0/7',True)[0]['interface'],'Gi0/7')
        for value in ['8.8.8.8','100.63.1.1','100.128.1.1','127.0.0.1','169.254.1.1','::1','host.test','100.100.1.256','100.100.01.22',','.join('10.0.0.'+str(i) for i in range(1,7)),'10.0.0.1,10.0.0.1']:
            with self.subTest(value=value),self.assertRaises(Exception):filters.fam_plan(value)
    def test_interface_injection_and_duplicates_are_rejected(self):
        for value in ['100.100.1.22:Gi0/7;reload','100.100.1.22:interface range','100.100.1.22:Gi0/7\nreload','100.100.1.22:Gi0/7,100.100.1.22:Gi0/7']:
            with self.assertRaises(Exception):filters.fam_plan(value,True)
    def test_exact_status_variants_never_admin_disabled(self):
        for status in ['err-disabled','errdisable','errdisabled']:
            parsed=filters.fam_status(ERROR.replace('err-disabled',status))
            self.assertEqual(parsed['errdisabled'],['Gi0/7'])
            self.assertEqual(set(parsed),{'interfaces','errdisabled'})
            self.assertNotIn('Fixture',str(parsed))
    def test_incomplete_duplicate_paged_or_control_output_fails_closed(self):
        for output in ['',HEADER,HEADER+'Gi0/7 truncated err-disabled\n',ERROR+'Gi0/7 Same connected 1 auto auto 10/100\n',ERROR+'--More--',ERROR+'\x00','x'*(1024*1024+1)]:
            with self.assertRaises(Exception):filters.fam_status(output)
    def test_credentials_are_bounded_and_do_not_accept_option_injection(self):
        self.assertTrue(filters.fam_credentials('radius.user','synthetic-only'))
        self.assertFalse(filters.fam_credentials('-oProxyCommand=calc','x'))
        self.assertFalse(filters.fam_credentials('u','with\nnewline'))
    def test_yaml_pins_no_enable_no_save_no_raw_config_fetch(self):
        import yaml
        data=yaml.safe_load((PACKAGE/'tasks/recover_port.yml').read_text())
        config=next(t for t in data if 'block' in t)['block'][0]['cisco.ios.ios_config']
        self.assertEqual(config['lines'],['shutdown','no shutdown'])
        self.assertEqual(config['match'],'none');self.assertEqual(config['running_config'],'!')
        self.assertEqual(config['save_when'],'never');self.assertFalse(config['backup'])
        cfg=(PACKAGE/'ssh_config').read_text()
        self.assertIn('StrictHostKeyChecking yes',cfg)
        for forbidden in ['3des-cbc','aes192-cbc','aes256-cbc']:self.assertNotIn(forbidden,cfg)

@unittest.skipUnless(os.environ.get("FAM_RUN_ANSIBLE_SYNTHETIC")=="1", "opt-in pinned collection adapter tests")
class NarrowIosAdapter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0,str(ROOT/'.cache/ansible-collections'))
        adapter_spec=importlib.util.spec_from_file_location('fam_ios_adapter',PACKAGE/'cliconf_plugins/fam_ios.py')
        adapter=importlib.util.module_from_spec(adapter_spec);adapter_spec.loader.exec_module(adapter)
        cls.adapter=adapter
    def make(self,prompt=b'Switch#'):
        adapter=self.adapter.Cliconf.__new__(self.adapter.Cliconf)
        class Connection:
            def get_prompt(self):return prompt
        adapter._connection=Connection();sent=[]
        adapter.send_command=lambda command,**kwargs:sent.append(command) or ''
        return adapter,sent
    def test_native_ios_diff_retains_order_and_wire_has_only_exact_recovery(self):
        adapter,sent=self.make()
        diff=adapter.get_diff(candidate='interface Gi0/7\n shutdown\n no shutdown',running='!',diff_match='none',path=['interface Gi0/7'],diff_replace='line')
        adapter.edit_config(diff['config_diff'].splitlines())
        self.assertEqual(sent,['configure terminal','interface Gi0/7','shutdown','no shutdown','end'])
        self.assertEqual(adapter.get_device_info(),{'network_os':'ios'})
        self.assertEqual(len(sent),5) # no implicit show version/show vlan discovery
    def test_real_ios_command_argument_transform_is_supported_without_extra_cli(self):
        from types import SimpleNamespace
        from ansible.module_utils.basic import DEFAULT_TYPE_VALIDATORS
        from ansible_collections.cisco.ios.plugins.modules.ios_command import parse_commands
        module=SimpleNamespace(params={'commands':['show interfaces status']},check_mode=False,_CHECK_ARGUMENT_TYPES_DISPATCHER=DEFAULT_TYPE_VALIDATORS)
        commands=parse_commands(module,[])
        self.assertIsInstance(commands[0],dict)
        adapter,sent=self.make()
        adapter.run_commands(commands)
        self.assertEqual(sent,['show interfaces status'])
    def test_config_collection_and_unprivileged_or_freeform_write_are_refused(self):
        adapter,sent=self.make(b'Switch>')
        with self.assertRaises(ValueError):adapter.edit_config(['interface Gi0/7','shutdown','no shutdown'])
        self.assertEqual(sent,[])
        for fn in [lambda:adapter.get_config(),lambda:adapter.get(command='show running-config'),lambda:adapter.run_commands(['reload']),lambda:adapter.edit_config(['interface range Gi0/1-7','shutdown','no shutdown']),lambda:adapter.edit_config(['interface Gi0/7','write memory','no shutdown'])]:
            with self.assertRaises(ValueError):fn()
        self.assertEqual(sent,[])

@unittest.skipUnless(os.environ.get('FAM_RUN_ANSIBLE_SYNTHETIC')=='1','explicit synthetic Ansible integration opt-in required')
class AnsibleEngine(unittest.TestCase):
    def run_play(self,play,scenario='recovered',targets=None,confirm=True):
        import pexpect
        with tempfile.TemporaryDirectory() as d:
            trace=Path(d)/'trace.jsonl';env=dict(os.environ)
            # Reuse installed platform metadata/terminal code, replace only actions.
            # The replacements never call a transport method.
            collection_root=Path(d)/'collections'
            ios=collection_root/'ansible_collections/cisco/ios'
            shutil.copytree(ROOT/'.cache/ansible-collections/ansible_collections/cisco/ios',ios)
            for name in ['ios_command.py','ios_config.py']:
                destination=ios/'plugins/action'/name;destination.parent.mkdir(exist_ok=True)
                shutil.copyfile(ROOT/'tests/fixtures/fam_ansible/ansible_collections/cisco/ios/plugins/action'/name,destination)
            env.update(ANSIBLE_CONFIG=str(PACKAGE/'ansible.cfg'),ANSIBLE_COLLECTIONS_PATH=str(collection_root)+os.pathsep+str(ROOT/'.cache/ansible-collections'),FAM_SYNTHETIC_TRACE=str(trace),FAM_SYNTHETIC_SCENARIO=scenario,ANSIBLE_NOCOLOR='1')
            exe=str(ROOT/'.venv/bin/ansible-playbook')
            child=pexpect.spawn(exe,[play+'.yml'],cwd=str(PACKAGE),env=env,encoding='utf-8',timeout=30,echo=False)
            child.expect('at most five.*: ');child.sendline(targets or ('100.100.1.22:Gi0/7' if play=='recover' else '100.100.1.22'))
            child.expect('Transient SSH / RADIUS username: ');child.sendline('synthetic.user')
            child.expect('Transient SSH / RADIUS password: ');child.sendline('SYNTHETIC_PASSWORD_MARKER_6492')
            if play=='recover':
                child.expect('Enter alone cancels');child.sendline('REPAIR '+(targets or '100.100.1.22:Gi0/7') if confirm else '')
            child.expect(pexpect.EOF);output=child.before;child.close()
            events=[json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            self.assertNotIn('SYNTHETIC_PASSWORD_MARKER_6492',output)
            self.assertNotIn('SYNTHETIC RAW DIAGNOSTIC MUST NOT LEAK',output)
            return child.exitstatus,events,output
    def test_inspect_is_read_only(self):
        code,events,output=self.run_play('inspect');self.assertEqual(code,0,output)
        self.assertEqual([e['action'] for e in events],['read'])
        self.assertIn('Gi0/7',output)
    def test_successful_recovery_has_precheck_exact_ordered_write_postcheck(self):
        code,events,output=self.run_play('recover');self.assertEqual(code,0,output)
        self.assertEqual([e['action'] for e in events],['read','config','read'])
        self.assertEqual(events[1]['args']['parents'],'interface Gi0/7')
        self.assertEqual(events[1]['args']['lines'],['shutdown','no shutdown'])
        self.assertIn('recovered',output)
    def test_cancel_causes_zero_device_actions(self):
        code,events,_=self.run_play('recover',confirm=False);self.assertNotEqual(code,0);self.assertEqual(events,[])
    def test_clean_precheck_causes_no_config(self):
        code,events,output=self.run_play('recover','clean');self.assertEqual(code,0,output)
        self.assertEqual([e['action'] for e in events],['read']);self.assertIn('not_errdisabled',output)
    def test_malformed_and_connection_failure_never_write_or_retry(self):
        for scenario in ['malformed','connection_failed']:
            code,events,_=self.run_play('recover',scenario);self.assertNotEqual(code,0)
            self.assertEqual([e['action'] for e in events],['read'])
    def test_missing_postcheck_and_still_disabled_are_not_success(self):
        for scenario in ['missing_post','still']:
            code,events,output=self.run_play('recover',scenario);self.assertNotEqual(code,0,output)
            self.assertEqual([e['action'] for e in events],['read','config','read'])
    def test_unresolved_first_switch_stops_later_switch_writes(self):
        code,events,output=self.run_play('recover','still',targets='100.100.1.22:Gi0/7,100.108.1.22:Gi0/7')
        self.assertNotEqual(code,0,output)
        self.assertEqual([e['action'] for e in events],['read','config','read'])
    def test_public_target_is_denied_before_any_device_action(self):
        code,events,_=self.run_play('inspect',targets='8.8.8.8');self.assertNotEqual(code,0);self.assertEqual(events,[])

if __name__=='__main__':unittest.main()
