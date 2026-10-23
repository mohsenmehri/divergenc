"""Synthetic only. Never contacts a switch or stores equipment credentials."""
import copy
import json
import sqlite3
import unittest
import uuid
from unittest import mock
from server import equipment_replacement as r, equipment_probe as p
from server.tests import test_equipment_probe as transport, test_equipment_diagnostics as diag
from server.tests import test_review_fixes as fixtures

PORT='Fa0/7';OLD='0001.08f1.31a6';NEW='0002.2222.2222';IP='10.4.86.7'
CONFIG='''Building configuration...
Current configuration : 210 bytes
!
interface FastEthernet0/7
 switchport access vlan 100
 switchport mode access
 switchport port-security
 switchport port-security mac-address sticky
 ip verify source port-security
 spanning-tree portfast
end
'''
BIND='MacAddress IpAddress Lease(sec) Type VLAN Interface\n'
SEC='Vlan Mac Address Type Ports Remaining Age (mins)\n'
CAM='Vlan Mac Address Type Ports\n'
STATUS='Port Name Status Vlan Duplex Speed Type\nFa0/7 client connected 100 a-full a-100 10/100BaseTX\n'
ACL='arp access-list Inspection\n permit ip host '+IP+' mac host '+OLD+'\n permit ip host 10.4.86.8 mac host 0003.3333.3333\n'


def transcript(static=True, *, protected=True, shutdown=False, mac=OLD, bound=True, state='connected', seen=False, sticky=False):
    cfg=CONFIG
    if not protected:cfg=cfg.replace(' ip verify source port-security\n','')
    if shutdown:cfg=cfg.replace('end\n',' shutdown\nend\n')
    if sticky:cfg=cfg.replace('end\n',' switchport port-security mac-address sticky '+mac+'\nend\n')
    binding=BIND+(f'{mac} {IP} infinite static 100 {PORT}\n' if bound and static else '')
    secure=SEC+(f'100 {mac} SecureSticky {PORT} -\n' if seen else '')
    cam=CAM+(f'100 {mac} STATIC {PORT}\n' if seen else '')
    status=STATUS.replace('connected',state)
    acl=ACL.replace(OLD,mac) if bound else 'arp access-list Inspection\n permit ip host 10.4.86.8 mac host 0003.3333.3333\n'
    texts=[cfg,binding,secure,cam,status]+([acl] if static else [])
    return ''.join('Switch#'+cmd+'\n'+text for cmd,text in zip(r.reads(PORT,static),texts))+'Switch#exit\n'


def plan(static=True):return r.plan_from(r.snapshot(transcript(static),PORT,static),PORT,static)


def echo(commands):return ''.join('Switch#'+cmd+'\n' for cmd in commands)


class ParserTests(unittest.TestCase):
    def test_static_plan_keeps_exact_ip_not_port_derived(self):
        value=plan();self.assertEqual(value['ip'],IP);self.assertEqual(value['oldMac'],OLD)
        changed=transcript().replace(IP,'100.108.77.193')
        self.assertEqual(r.plan_from(r.snapshot(changed,PORT,True),PORT,True)['ip'],'100.108.77.193')

    def test_no_static_changes_without_checkbox(self):
        value=plan(False)
        text='\n'.join(r.commands(value,'open')+r.commands(value,'protect',NEW))
        self.assertNotIn('source binding',text);self.assertNotIn('arp access-list',text)
        with self.assertRaises(ValueError):r.snapshot(transcript(),PORT,False)
        text=transcript(False).replace(BIND,BIND+f'{OLD} {IP} infinite static 100 {PORT}\n')
        with self.assertRaisesRegex(ValueError,'static_checkbox_required'):r.plan_from(r.snapshot(text,PORT,False),PORT,False)

    def test_commands_delete_old_pair_then_restore_same_ip_with_new_mac(self):
        value=plan();a=r.commands(value,'open');b=r.commands(value,'protect',NEW)
        self.assertLess(a.index('shutdown'),a.index('no ip verify source'))
        self.assertIn(f'no ip source binding {OLD} vlan 100 {IP} interface {PORT}',a)
        self.assertIn(f'no permit ip host {IP} mac host {OLD}',a)
        self.assertIn(f'ip source binding {NEW} vlan 100 {IP} interface {PORT}',b)
        self.assertIn(f'permit ip host {IP} mac host {NEW}',b)
        self.assertIn('ip verify source port-security',b)
        self.assertNotIn('no shutdown',a+b)
        for word in ('clear ','write memory','copy running','enable','no arp access-list'):
            self.assertNotIn(word,'\n'.join(a+b))

    def test_malformed_shared_missing_acl_and_admin_down_fail_closed(self):
        values=[transcript().replace('switchport mode access','switchport mode trunk'),transcript().replace(' switchport port-security\n',''),transcript().replace(' switchport port-security\n',' switchport port-security\n switchport voice vlan 200\n'),transcript(sticky=True),transcript().replace('permit ip host '+IP,'deny ip host '+IP),transcript().replace('Switch#exit',''),transcript()+'\x00',transcript().replace('infinite static 100','infinite static 200'),transcript().replace('infinite static 100','infinite dhcp-snooping 100'),transcript(shutdown=True)]
        for text in values:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):r.plan_from(r.snapshot(text,PORT,True),PORT,True)

    def test_duplicate_binding_and_acl_do_not_pick_first(self):
        for text in [transcript().replace(BIND,BIND+f'{NEW} 10.4.86.99 infinite static 100 {PORT}\n'),transcript().replace(ACL,ACL+f' permit ip host {IP} mac host {NEW}\n')]:
            with self.assertRaises(ValueError):r.plan_from(r.snapshot(text,PORT,True),PORT,True)

    def test_injection_uplink_and_broadcast_mac_rejected(self):
        for port in ['Fa0/7\nreload','Gi0/1','7','Fa0/25','FastEthernet0/7',None]:
            with self.assertRaises(ValueError):r.interface(port)
        for address in ['ffff.ffff.ffff','0100.0000.0001','0000.0000.0000','0001.1234.5678\nreload']:
            with self.assertRaises(ValueError):r.unicast(address)


class TransportTests(transport.ProbeHarness):
    def job(self,apply=False,static=True):return {**self.status_job(),'operation':'replacement-apply' if apply else 'replacement-plan','interface':PORT,'staticIp':static,**({'planHash':plan(static)['planHash']} if apply else {})}
    def scripts(self,static=True,err=False):
        value=plan(static)
        steps=[{'out':diag.VERSION},{'out':transcript(static)},
               {'out':echo(r.commands(value,'open'))},
               {'out':transcript(static,protected=False,shutdown=True,bound=False,state='disabled')},
               {'out':echo(r.commands(value,'up'))}]
        if err:steps += [{'out':transcript(static,protected=False,bound=False,state='err-disabled')},{'out':echo(p.recovery_commands(PORT))}]
        steps += [{'out':transcript(static,protected=False,bound=False,mac=NEW,seen=True,sticky=True)},
                  {'out':echo(r.commands(value,'protect',NEW))},
                  {'out':transcript(static,shutdown=True,mac=NEW,seen=True,sticky=True,state='disabled')},
                  {'out':echo(r.commands(value,'up'))},
                  {'out':transcript(static,mac=NEW,seen=True,sticky=True)}]
        return steps

    def test_plan_is_read_only_and_shared_askpass_is_cleaned(self):
        result=self.run_probe(self.job(),[{'out':diag.VERSION},{'out':transcript()}]);self.assertEqual(result,{'ok':True,'plan':plan()})
        self.assertEqual(len(self.processes),2);self.assertNotIn('configure terminal',''.join(c['stdin'] or '' for c in self.calls))
        self.assertEqual(self.calls[0]['askpass_path'],self.calls[1]['askpass_path'])

    def test_full_static_replacement_preserves_ip_and_other_acl_entry(self):
        result=self.run_probe(self.job(True),self.scripts())
        self.assertEqual(result.get('replacement'),'replaced',result);self.assertEqual(result['ip'],IP);self.assertEqual(result['newMac'],NEW)
        scripts=''.join(c['stdin'] or '' for c in self.calls)
        self.assertNotIn('10.4.86.8',scripts);self.assertNotIn('clear ',scripts)
        self.assertTrue(result['protectionRestored'])

    def test_error_is_not_required_but_one_observed_error_is_recovered(self):
        result=self.run_probe(self.job(True),self.scripts(err=True));self.assertEqual(result.get('replacement'),'replaced',result)
        self.assertEqual(sum(c['stdin']== '\n'.join(p.recovery_commands(PORT))+'\n' for c in self.calls),1)

    def test_nonstatic_never_edits_binding_or_arp_acl(self):
        result=self.run_probe(self.job(True,False),self.scripts(False));self.assertEqual(result.get('replacement'),'replaced',result)
        for c in self.calls:
            if c['stdin'] and 'configure terminal' in c['stdin']:
                self.assertNotIn('source binding',c['stdin']);self.assertNotIn('arp access-list',c['stdin'])

    def test_explicit_old_sticky_blocks_before_writes(self):
        result=self.run_probe(self.job(True),[{'out':diag.VERSION},{'out':transcript(sticky=True)}])
        self.assertEqual(result['error'],'replacement_sticky');self.assertEqual(len(self.processes),2)

    def test_stale_plan_blocks_before_writes(self):
        result=self.run_probe({**self.job(True),'planHash':'a'*64},[{'out':diag.VERSION},{'out':transcript()}])
        self.assertEqual(result['error'],'replacement_changed');self.assertEqual(len(self.processes),2)

    def test_failed_learning_closes_port_and_never_announces_success(self):
        value=plan();steps=self.scripts()[:5]+[{'out':transcript(protected=False,bound=False)}]*4+[
            {'out':echo(r.commands(value,'quarantine'))},{'out':transcript(shutdown=True,state='disabled')}]
        with mock.patch.object(r.time,'sleep'):
            result=self.run_probe(self.job(True),steps)
        self.assertEqual(result,{'ok':False,'error':'replacement_quarantined'})
        self.assertNotIn('no shutdown',self.calls[-2]['stdin'])

    def test_disconnect_and_failed_cleanup_is_uncertain_not_retry(self):
        steps=self.scripts()[:2]+[{'hang':True},{'hang':True}]
        result=self.run_probe(self.job(True),steps)
        self.assertEqual(result,{'ok':False,'error':'replacement_uncertain'});self.assertEqual(len(self.processes),4)
        self.assertNotIn('no shutdown',self.calls[-2]['stdin'] or '')

    def test_multiple_new_macs_and_unverified_write_close_without_reopen(self):
        value=plan()
        ambiguous=transcript(protected=False,bound=False,mac=NEW,seen=True,sticky=True).replace(CAM,CAM+f'100 0004.4444.4444 DYNAMIC {PORT}\n')
        scripts=self.scripts()[:5]+[{'out':ambiguous},{'out':echo(r.commands(value,'quarantine',NEW))},{'out':transcript(shutdown=True,mac=NEW,seen=True,sticky=True,state='disabled')}]
        result=self.run_probe(self.job(True),scripts)
        # New MAC has not been accepted, so cleanup cannot confirm that sticky;
        # it must report uncertainty rather than false success.
        self.assertEqual(result['error'],'replacement_uncertain')
        self.assertNotIn('no shutdown',self.calls[-2]['stdin'])
        self.calls.clear()
        scripts=self.scripts()[:2]+[{'out':'% Invalid input detected\n'},{'out':echo(r.commands(value,'quarantine'))},{'out':transcript(shutdown=True,state='disabled')}]
        result=self.run_probe(self.job(True),scripts)
        self.assertEqual(result['error'],'replacement_quarantined')
        self.assertFalse(any('no shutdown' in (c['stdin'] or '') for c in self.calls))

    def test_unsupported_platform_never_writes(self):
        result=self.run_probe(self.job(True),[{'out':diag.VERSION.replace('WS-C2960-24TT-L','WS-C2960X-24TS-L')}])
        self.assertEqual(result['error'],'unsupported_platform');self.assertEqual(len(self.processes),1)

    def test_input_extra_ip_and_commands_never_reach_ssh(self):
        for fields in [{'ip':'10.1.1.9'},{'commands':['reload']},{'interface':'Gi0/1'},{'staticIp':1},{'host':'8.8.8.8'},{'host':167838211}]:
            result=self.run_probe({**self.job(),**fields},[]);self.assertEqual(result['error'],'invalid_request')
        self.assertEqual(self.processes,[])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.SecurityFixes();self.f.setUp();self.addCleanup(self.f.doCleanups);self.jobs=[]
        self.body={**fixtures.JOB,'interface':PORT,'staticIp':True}
        def execute(job):
            self.jobs.append(job)
            if job['operation']=='replacement-plan':return {'ok':True,'plan':plan()}
            return {'ok':True,'replacement':'replaced','interface':PORT,'staticIp':True,'ip':IP,'oldMac':OLD,'newMac':NEW,'protectionRestored':True}
        self.f.app.config['EQUIPMENT_EXECUTOR']=execute
    def post(self,path,body):return self.f.post('equipment/replacement/'+path,body)
    def prepared(self):
        response=self.post('plan',self.body);self.assertEqual(response.status_code,200,response.json)
        return {**self.body,'ticket':response.json['ticket'],'planHash':response.json['plan']['planHash']}

    def test_plan_and_one_use_apply_no_results_or_credentials_in_database(self):
        value=self.prepared();response=self.post('apply',value);self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['ip'],IP);self.assertEqual(self.post('apply',value).status_code,409)
        with sqlite3.connect(self.f.config['DB_PATH']) as db:dump='\n'.join(db.iterdump())
        for text in [IP,OLD,NEW,fixtures.JOB['password'],value['ticket']]:self.assertNotIn(text,dump)

    def test_ticket_binds_operation_static_flag_port_and_snapshot(self):
        value=self.prepared()
        for changes in [{'staticIp':False},{'interface':'Fa0/8'},{'planHash':'b'*64},{'host':'10.1.1.2'}]:
            self.assertEqual(self.post('apply',{**value,**changes}).status_code,409)
        self.assertEqual(self.f.post('equipment/recover',{**fixtures.JOB,'interface':PORT,'ticket':value['ticket']}).status_code,409)
        self.assertEqual(len(self.jobs),1)

    def test_unknown_helper_fields_and_partial_success_are_not_released(self):
        value=self.prepared();self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'replacement':'replaced','raw':fixtures.JOB['password']}
        response=self.post('apply',value);self.assertEqual(response.status_code,502);self.assertEqual(response.json['code'],'replacement_uncertain');self.assertNotIn(fixtures.JOB['password'],response.get_data(as_text=True))

    def test_bad_inputs_origins_and_csrf_stop_before_executor(self):
        for changes in [{'ip':IP},{'staticIp':'true'},{'interface':'Fa0/7\nreload'},{'host':'8.8.8.8'},{'host':167838211}]:self.assertEqual(self.post('plan',{**self.body,**changes}).status_code,400)
        endpoint='/api/equipment/replacement/plan'
        self.assertEqual(self.f.app.test_client().post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,401)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,403)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':'https://other.invalid','X-FAM-CSRF':self.f.client.review_csrf}).status_code,403)
        self.assertEqual(self.jobs,[])

    def test_each_permission_and_scope_is_required_on_plan_and_apply(self):
        body=self.prepared()
        for suffix,permissions,scope in [
            ('scan',['equipment-operations','equipment-scan'],{k:['*'] for k in fixtures.DEFAULT_INVENTORY['catalog']}),
            ('repair',['equipment-operations','equipment-repair'],{k:['*'] for k in fixtures.DEFAULT_INVENTORY['catalog']}),
            *[(k,['equipment-operations','equipment-scan','equipment-repair'],{f:([] if f==k else ['*']) for f in fixtures.DEFAULT_INVENTORY['catalog']}) for k in fixtures.DEFAULT_INVENTORY['catalog']]]:
            users=self.f.client.get('/api/users').json
            username='replacement-'+suffix.lower()
            users['users'].append({'id':str(uuid.uuid4()),'username':username,'name':'Fixture','enabled':True,'categories':[],'permissions':permissions,'regions':[],'sheets':[],'password':fixtures.BOOT,'equipmentScope':scope})
            self.assertEqual(self.f.post('users',users).status_code,200)
            worker=self.f.login(username)
            self.assertEqual(self.f.post('equipment/replacement/plan',self.body,worker).status_code,403)
            self.assertEqual(self.f.post('equipment/replacement/apply',body,worker).status_code,403)
        self.assertEqual(len(self.jobs),1)

    def test_busy_lock_and_uncertain_result_require_manual_recheck(self):
        value=self.prepared()
        with self.f.app.extensions['equipment_guard'].admit(self.body['host']):self.assertEqual(self.post('apply',value).status_code,429)
        self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':False,'error':'replacement_uncertain'}
        response=self.post('apply',value);self.assertEqual(response.status_code,502);self.assertTrue(response.json['requiresRecheck'])
        self.assertEqual(self.post('apply',value).status_code,409)

if __name__=='__main__':unittest.main()
