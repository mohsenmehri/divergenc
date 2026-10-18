"""Synthetic IOS and mocked SSH only; no real switches, credentials or database."""
import copy
import json
import sqlite3
import unittest
import uuid
from unittest import mock
from server import equipment_group as g
from server.tests import test_equipment_probe as transport, test_equipment_diagnostics as diag, test_review_fixes as fixtures

TARGETS=['Fa0/6','Fa0/10'];OLDPORT='Fa0/3'
OLD={'Fa0/6':'0001.1111.1111','Fa0/10':'0001.2222.2222'}
NEW={'Fa0/6':'0002.1111.1111','Fa0/10':'0002.2222.2222'}
IPS={'Fa0/6':'10.4.86.193','Fa0/10':'10.4.86.194'}


def rows(mode='recover',stage='initial',foreign=True):
    secure=[]
    if foreign and stage in ('initial','closed'):secure.append({'interface':OLDPORT,'mac':NEW['Fa0/6'],'vlan':100,'kind':'securesticky'})
    if mode=='replace' and stage in ('initial','closed'):
        secure += [{'interface':port,'mac':OLD[port],'vlan':100,'kind':'securesticky'} for port in TARGETS]
    if stage in ('learned','protected','final'):
        secure += [{'interface':port,'mac':NEW[port],'vlan':100,'kind':'securesticky'} for port in TARGETS]
    return secure


def transcript(ports,mode='recover',stage='initial',static=False,foreign=True,old_active=False,extra_cam=False):
    secure=rows(mode,stage,foreign);allports=sorted(set(TARGETS+[OLDPORT]),key=lambda p:int(p[4:]));states={p:('connected' if old_active else 'notconnect') if p==OLDPORT else 'err-disabled' if stage=='initial' else 'disabled' if stage in ('closed','cleaned','protected') else 'connected' for p in allports}
    binding=[];acl=[]
    if static and stage not in ('cleaned','learned'):
        addresses=NEW if stage in ('protected','final') else OLD
        for port in TARGETS:binding.append(f'{addresses[port]} {IPS[port]} infinite static 100 {port}')
        acl=[f' permit ip host {IPS[port]} mac host {addresses[port]}' for port in TARGETS]
    table='Port Name Status Vlan Duplex Speed Type\n'+''.join(f'{p} fixture {states[p]} 100 a-full a-100 10/100BaseTX\n' for p in allports)
    secure_text='Vlan Mac Address Type Ports Remaining Age (mins)\n'+''.join(f"100 {x['mac']} { {'securesticky':'SecureSticky','securedynamic':'SecureDynamic','secureconfigured':'SecureConfigured'}[x['kind']]} {x['interface']} -\n" for x in secure)
    texts=[table,secure_text,'MacAddress IpAddress Lease(sec) Type VLAN Interface\n'+'\n'.join(binding)+'\n']
    if static:texts+=['arp access-list Inspection\n'+'\n'.join(acl)+'\n' if acl else '']
    for port in g.interfaces(ports):
        shutdown=port in TARGETS and stage in ('closed','cleaned','protected')
        protected=mode=='recover' or stage not in ('cleaned','learned') or port==OLDPORT
        cfg=f'interface FastEthernet{port[2:]}\n switchport access vlan 100\n switchport mode access\n switchport port-security\n switchport port-security mac-address sticky\n'
        for row in secure:
            if row['interface']==port:cfg+=' switchport port-security mac-address sticky '+row['mac']+'\n'
        if protected:cfg+=' ip verify source port-security\n'
        if shutdown:cfg+=' shutdown\n'
        cfg+='end\n'
        stat='Port Security : Enabled\nPort Status : '+('Secure-shutdown' if stage=='initial' and port in TARGETS else 'Secure-up' if states[port]=='connected' else 'Secure-down')+'\nViolation Mode : Shutdown\nLast Source Address:Vlan : '+NEW.get(port,NEW['Fa0/6'])+':100\nSecurity Violation Count : 3\n'
        cam='Vlan Mac Address Type Ports\n'
        if stage in ('learned','protected','final') and port in TARGETS:cam+=f'100 {NEW[port]} STATIC {port}\n'
        if extra_cam and port=='Fa0/6':cam+='100 0004.4444.4444 DYNAMIC Fa0/6\n'
        texts += [cfg,stat,cam]
    return ''.join('Switch#'+cmd+'\n'+text for cmd,text in zip(g.read_commands(ports,static),texts))+'Switch#exit\n'


def preflight(mode='recover',static=False,foreign=True):
    snap=g.snapshot(transcript(TARGETS,mode,static=static,foreign=foreign),TARGETS,static,shutdown=False)
    items,removals=g.cleanup_rows(snap,TARGETS,mode,static)
    allports=g.interfaces(TARGETS+([OLDPORT] if foreign else []));baseline=g.snapshot(transcript(allports,mode,static=static,foreign=foreign),allports,static)
    stable={'mode':mode,'staticIp':static,'targets':TARGETS,'relocationPolicy':'idle-access-vlan100','items':baseline['items'],'secure':baseline['secure'],'bindings':baseline['bindings'],'acl':baseline['acl'],'states':{port:baseline['states'][port] for port in allports}}
    digest=g.hashlib.sha256(json.dumps(stable,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return g.validate_plan({'mode':mode,'interfaces':TARGETS,'staticIp':static,'items':items,'removals':removals,'planHash':digest,'relocationPolicy':'idle-access-vlan100'})


def echo(body):return ''.join('Switch#'+c+'\n' for c in ('terminal length 0','configure terminal',*body,'end','exit'))


class ParserTests(unittest.TestCase):
    def test_ranges_exact_members_spacing_compression_and_five_clause_limit(self):
        self.assertEqual(g.ranges(TARGETS),['interface range FastEthernet0/6 , FastEthernet0/10'])
        self.assertEqual(g.ranges(['Fa0/1','Fa0/2','Fa0/3','Fa0/6']),['interface range FastEthernet0/1 - 3 , FastEthernet0/6'])
        self.assertEqual(len(g.ranges(['Fa0/'+str(n) for n in range(1,24,2)])),3)
        for value in [[],['Fa0/6','Fa0/6'],['Fa0/25'],['Gi0/1'],['Fa0/6;reload'],'Fa0/6']:
            with self.assertRaises(ValueError):g.interfaces(value)
    def test_cleanup_is_exact_same_switch_old_port_and_target_previous_identity(self):
        plan=preflight();self.assertEqual(plan['removals'],[{'interface':OLDPORT,'mac':NEW['Fa0/6'],'kind':'securesticky','vlan':100,'reason':'old_port_conflict'}])
        replacement=preflight('replace',True);self.assertEqual(len(replacement['removals']),3)
        self.assertEqual([r['ip'] for r in replacement['items']],[IPS[p] for p in TARGETS])
    def test_no_clear_all_and_each_kind_has_correct_scoped_command(self):
        removal=preflight()['removals'][0]
        self.assertEqual(g.removals_commands([removal]),('interface Fa0/3','no switchport port-security mac-address sticky '+NEW['Fa0/6'],'exit'))
        self.assertEqual(g.removals_commands([{**removal,'kind':'securedynamic'}]),('end','clear port-security dynamic address '+NEW['Fa0/6'],'configure terminal'))
        self.assertEqual(g.removals_commands([{**removal,'kind':'secureconfigured'}]),('interface Fa0/3','no switchport port-security mac-address '+NEW['Fa0/6'],'exit'))
    def test_unknown_historical_stats_and_occupied_target_fail_before_write(self):
        for old,new in [('Security Violation Count : 3','Security Violation Count : 0'),(':100',':200'),('Secure-shutdown','truncated')]:
            text=transcript(TARGETS).replace(old,new)
            with self.assertRaises(ValueError):g.cleanup_rows(g.snapshot(text,TARGETS,False),TARGETS,'recover',False)
        text=transcript(TARGETS,'replace')
        with self.assertRaisesRegex(ValueError,'occupied target'):g.cleanup_rows(g.snapshot(text,TARGETS,False),TARGETS,'recover',False)
    def test_static_reference_of_foreign_mac_is_not_silently_migrated(self):
        text=transcript(TARGETS).replace('MacAddress IpAddress Lease(sec) Type VLAN Interface\n','MacAddress IpAddress Lease(sec) Type VLAN Interface\n'+NEW['Fa0/6']+' 10.4.86.6 infinite static 100 Fa0/3\n')
        with self.assertRaisesRegex(ValueError,'static binding at old port'):g.cleanup_rows(g.snapshot(text,TARGETS,False),TARGETS,'recover',False)
    def test_strict_schema_does_not_accept_uplink_other_vlan_or_unbound_removal(self):
        for change in [{'interface':'Gi0/1'},{'mac':'ffff.ffff.ffff'},{'vlan':200},{'reason':'anything'},{'interface':'Fa0/10'}]:
            plan=copy.deepcopy(preflight());plan['removals'][0].update(change)
            with self.assertRaises(ValueError):g.validate_plan(plan)
    def test_config_boundaries_and_shared_ports_fail_closed(self):
        for text in [transcript(TARGETS).replace('Switch#exit',''),transcript(TARGETS)+'\x00',transcript(TARGETS).replace(' switchport mode access',' switchport mode trunk'),transcript(TARGETS).replace(' switchport mode access',' switchport mode access\n switchport voice vlan 200')]:
            with self.assertRaises(ValueError):g.snapshot(text,TARGETS,False)


class TransportTests(transport.ProbeHarness):
    def job(self,mode='recover',static=False,apply=True,foreign=True):return {**self.status_job(),'operation':'group-apply' if apply else 'group-plan','interfaces':TARGETS,'mode':mode,'staticIp':static,**({'planHash':preflight(mode,static,foreign)['planHash']} if apply else {})}
    def steps(self,mode='recover',static=False,foreign=True):
        plan=preflight(mode,static,foreign);allports=g.interfaces(TARGETS+([OLDPORT] if foreign else []))
        steps=[{'out':diag.VERSION},{'out':transcript(TARGETS,mode,static=static,foreign=foreign)}]
        if foreign:steps += [{'out':transcript(allports,mode,static=static,foreign=foreign)}]
        steps += [{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':transcript(allports,mode,'closed',static,foreign)}]
        if plan['removals']:steps += [{'out':echo(g.removals_commands(plan['removals']))}]
        if mode=='replace':steps += [{'out':echo((*g.port_commands(TARGETS,'no ip verify source'),*g.policy_commands(plan,OLD,True)))}]
        steps += [{'out':transcript(allports,mode,'cleaned',static,foreign)},{'out':echo(g.port_commands(TARGETS,'no shutdown'))}]
        if mode=='replace':steps += [{'out':transcript(allports,mode,'learned',static,foreign)},{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':echo((*g.policy_commands(plan,NEW),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(allports,mode,'protected',static,foreign)},{'out':echo(g.port_commands(TARGETS,'no shutdown'))}]
        steps += [{'out':transcript(allports,mode,'final',static,foreign)}]
        return steps
    def test_read_only_plan_exposes_exact_cleanup_no_config(self):
        steps=self.steps()[:3];result=self.run_probe(self.job(apply=False),steps);self.assertEqual(result,{'ok':True,'plan':preflight()});self.assertNotIn('configure terminal',''.join(c['stdin'] or '' for c in self.calls))
    def test_group_recover_cleans_old_mac_before_one_group_bounce_no_other_ports(self):
        result=self.run_probe(self.job(),self.steps());self.assertTrue(result.get('ok'),result);self.assertTrue(all(r['state']=='recovered' for r in result['rows']))
        scripts=''.join(c['stdin'] or '' for c in self.calls);self.assertLess(scripts.index('no switchport port-security mac-address sticky'),scripts.index('no shutdown'))
        self.assertIn('interface range FastEthernet0/6 , FastEthernet0/10\nshutdown',scripts);self.assertNotIn('clear port-security all',scripts);self.assertNotIn('interface range FastEthernet0/3',scripts)
        self.assertEqual(len({c['askpass_path'] for c in self.calls}),1)
    def test_multi_static_replacement_preserves_both_ips_and_restores_ipsg(self):
        result=self.run_probe(self.job('replace',True),self.steps('replace',True));self.assertTrue(result.get('ok'),result)
        self.assertEqual([(r['ip'],r['newMac']) for r in result['rows']],[(IPS[p],NEW[p]) for p in TARGETS]);scripts=''.join(c['stdin'] or '' for c in self.calls)
        for port in TARGETS:self.assertIn(f'ip source binding {NEW[port]} vlan 100 {IPS[port]} interface {port}',scripts)
        self.assertIn('ip verify source port-security',scripts)
    def test_dynamic_cleanup_requires_same_global_identity_and_disappearance_is_not_widened(self):
        allports=g.interfaces(TARGETS+[OLDPORT]);original=preflight()
        def convert(text):
            return text.replace(f"100 {NEW['Fa0/6']} SecureSticky Fa0/3 -",f"100 {NEW['Fa0/6']} SecureDynamic Fa0/3 -").replace(' switchport port-security mac-address sticky '+NEW['Fa0/6']+'\n','')
        baseline=g.snapshot(convert(transcript(allports)),allports,False);stable={'mode':'recover','staticIp':False,'targets':TARGETS,'relocationPolicy':'idle-access-vlan100','items':baseline['items'],'secure':baseline['secure'],'bindings':baseline['bindings'],'acl':baseline['acl'],'states':{p:baseline['states'][p] for p in allports}}
        digest=g.hashlib.sha256(json.dumps(stable,sort_keys=True,separators=(',',':')).encode()).hexdigest();job={**self.job(),'planHash':digest};dynamic=[{**original['removals'][0],'kind':'securedynamic'}]
        for disappeared,moved in [(False,False),(True,False),(False,True)]:
            self.calls.clear();steps=[{**step,'out':convert(step['out'])} for step in self.steps()]
            if disappeared:steps[4]['out']=steps[4]['out'].replace(f"100 {NEW['Fa0/6']} SecureDynamic Fa0/3 -\n",'');del steps[5]
            elif moved:
                steps[4]['out']=steps[4]['out'].replace(f"100 {NEW['Fa0/6']} SecureDynamic Fa0/3 -",f"100 {NEW['Fa0/6']} SecureDynamic Fa0/4 -")
                steps=steps[:5]+[{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':transcript(TARGETS,'recover','closed',False,False)}]
            else:steps[5]['out']=echo(g.removals_commands(dynamic))
            result=self.run_probe(job,steps);script=''.join(c['stdin'] or '' for c in self.calls)
            if moved:self.assertEqual(result.get('error'),'group_quarantined')
            else:self.assertTrue(result.get('ok'),result)
            self.assertEqual('clear port-security dynamic address '+NEW['Fa0/6'] in script,not disappeared and not moved);self.assertNotIn('clear port-security all',script);self.assertNotIn('clear port-security dynamic interface',script)

    def test_learning_evidence_cannot_be_carried_from_a_previous_round(self):
        plan=preflight('replace',True);steps=self.steps('replace',True);index=next(i for i,step in enumerate(steps) if step['out']==transcript(g.interfaces(TARGETS+[OLDPORT]),'replace','learned',True))
        def missing(port):
            return steps[index]['out'].replace(f"100 {NEW[port]} SecureSticky {port} -\n",'').replace(' switchport port-security mac-address sticky '+NEW[port]+'\n','').replace(f"100 {NEW[port]} STATIC {port}\n",'')
        steps=steps[:index]+[{'out':missing('Fa0/10')},{'out':missing('Fa0/6')},{'out':missing('Fa0/6')},{'out':missing('Fa0/6')},{'out':echo((*g.port_commands(TARGETS,'shutdown'),*g.policy_commands(plan,OLD),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(TARGETS,'replace','closed',True,False)}]
        with mock.patch.object(g.time,'sleep'):result=self.run_probe(self.job('replace',True),steps)
        self.assertEqual(result.get('error'),'group_quarantined');script=''.join(c['stdin'] or '' for c in self.calls)
        for mac in NEW.values():self.assertNotIn('ip source binding '+mac,script)

    def test_no_foreign_mac_no_unnecessary_cleanup_or_old_port_read(self):
        result=self.run_probe(self.job(foreign=False),self.steps(foreign=False));self.assertTrue(result.get('ok'),result);scripts=''.join(c['stdin'] or '' for c in self.calls)
        self.assertNotIn('no switchport port-security mac-address',scripts);self.assertNotIn('clear port-security',scripts)
    def test_connected_old_port_and_stale_plan_stop_before_configuration(self):
        steps=self.steps()[:2]+[{'out':transcript(g.interfaces(TARGETS+[OLDPORT]),old_active=True)}];result=self.run_probe(self.job(),steps);self.assertEqual(result['error'],'group_old_port_active');self.assertNotIn('configure terminal',''.join(c['stdin'] or '' for c in self.calls))
        self.calls.clear();result=self.run_probe({**self.job(),'planHash':'b'*64},self.steps()[:3]);self.assertEqual(result['error'],'group_changed');self.assertNotIn('configure terminal',''.join(c['stdin'] or '' for c in self.calls))
    def test_failed_ssh_cleanup_uncertain_and_no_retry(self):
        result=self.run_probe(self.job(),self.steps()[:3]+[{'hang':True},{'hang':True}]);self.assertEqual(result,{'ok':False,'error':'group_uncertain'});self.assertEqual(len(self.processes),5)
        self.assertNotIn('no shutdown',self.calls[-2]['stdin'] or '')
    def test_failed_learning_quarantines_all_targets_no_automatic_reopen(self):
        mode='replace';steps=self.steps(mode,True);learn_index=next(i for i,s in enumerate(steps) if s.get('out')==transcript(g.interfaces(TARGETS+[OLDPORT]),mode,'learned',True))
        plan=preflight(mode,True);steps=steps[:learn_index]+[{'out':transcript(g.interfaces(TARGETS+[OLDPORT]),mode,'cleaned',True)}]*4
        # cleaned target is still shutdown => no MAC; cleanup rebuilds old policy.
        steps += [{'out':echo((*g.port_commands(TARGETS,'shutdown'),*g.policy_commands(plan,OLD),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(TARGETS,'replace','closed',True,False)}]
        with mock.patch.object(g.time,'sleep'):result=self.run_probe(self.job(mode,True),steps)
        self.assertEqual(result.get('error'),'group_quarantined');self.assertEqual(result.get('affectedOldPorts'),[OLDPORT]);self.assertNotIn('no shutdown',self.calls[-2]['stdin'])
    def late_case(self,old_active=False):
        mode='replace';static=True;allports=g.interfaces(TARGETS+[OLDPORT])
        initial=transcript(TARGETS,mode,static=True).replace('fixture err-disabled','fixture connected').replace('Secure-shutdown','Secure-up').replace('Security Violation Count : 3','Security Violation Count : 0')
        s=g.snapshot(initial,TARGETS,True);items,removals=g.cleanup_rows(s,TARGETS,mode,True)
        stable={'mode':mode,'staticIp':True,'targets':TARGETS,'relocationPolicy':'idle-access-vlan100','items':s['items'],'secure':s['secure'],'bindings':s['bindings'],'acl':s['acl'],'states':{port:s['states'][port] for port in TARGETS}}
        digest=g.hashlib.sha256(json.dumps(stable,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        plan=g.validate_plan({'mode':mode,'interfaces':TARGETS,'staticIp':True,'items':items,'removals':removals,'planHash':digest,'relocationPolicy':'idle-access-vlan100'})
        def err(ports,closed=False,clean=False):
            text=transcript(ports,mode,'learned',True,False)
            text=text.replace(f"100 {NEW['Fa0/6']} SecureSticky Fa0/6 -\n",'').replace(' switchport port-security mac-address sticky '+NEW['Fa0/6']+'\n','').replace(f"100 {NEW['Fa0/6']} STATIC Fa0/6\n",'')
            if not clean:
                text=text.replace('Vlan Mac Address Type Ports Remaining Age (mins)\n','Vlan Mac Address Type Ports Remaining Age (mins)\n'+f"100 {NEW['Fa0/6']} SecureSticky Fa0/3 -\n")
                text=text.replace('interface FastEthernet0/3\n','interface FastEthernet0/3\n switchport port-security mac-address sticky '+NEW['Fa0/6']+'\n')
            text=text.replace('Fa0/6 fixture connected','Fa0/6 fixture '+('disabled' if closed else 'err-disabled'))
            text=text.replace('Switch#show port-security interface Fa0/6\nPort Security : Enabled\nPort Status : Secure-up','Switch#show port-security interface Fa0/6\nPort Security : Enabled\nPort Status : '+('Secure-down' if closed else 'Secure-shutdown'))
            if old_active:text=text.replace('Fa0/3 fixture notconnect','Fa0/3 fixture connected')
            if closed:
                text=text.replace('Fa0/10 fixture connected','Fa0/10 fixture disabled')
                for port in TARGETS:text=text.replace('interface FastEthernet'+port[2:]+'\n','interface FastEthernet'+port[2:]+'\n shutdown\n')
            return text
        discovery={'interface':OLDPORT,'mac':NEW['Fa0/6'],'kind':'securesticky','vlan':100,'reason':'old_port_conflict'}
        steps=[{'out':diag.VERSION},{'out':initial},{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':transcript(TARGETS,mode,'closed',True)},{'out':echo(g.removals_commands(removals))},{'out':echo((*g.port_commands(TARGETS,'no ip verify source'),*g.policy_commands(plan,OLD,True)))},{'out':transcript(TARGETS,mode,'cleaned',True)},{'out':echo(g.port_commands(TARGETS,'no shutdown'))},{'out':err(TARGETS)},{'out':err(allports)}]
        if not old_active:
            steps += [{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':err(allports,closed=True)},{'out':echo(g.removals_commands([discovery]))},{'out':err(allports,closed=True,clean=True)},{'out':echo(g.port_commands(TARGETS,'no shutdown'))},{'out':transcript(allports,mode,'learned',True,False)},{'out':echo(g.port_commands(TARGETS,'shutdown'))},{'out':echo((*g.policy_commands(plan,NEW),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(allports,mode,'protected',True,False)},{'out':echo(g.port_commands(TARGETS,'no shutdown'))},{'out':transcript(allports,mode,'final',True,False)}]
        else:steps += [{'out':echo((*g.port_commands(TARGETS,'shutdown'),*g.policy_commands(plan,OLD),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(TARGETS,mode,'closed',True,False)}]
        return {**self.job(mode,True),'planHash':digest},steps

    def test_fresh_violation_after_open_removes_only_idle_old_mac_then_recovers_group(self):
        job,steps=self.late_case()
        with mock.patch.object(g.time,'sleep'):result=self.run_probe(job,steps)
        self.assertTrue(result.get('ok'),result);self.assertEqual(len(result['removed']),3);self.assertIn(OLDPORT,[row['interface'] for row in result['removed']])
        script=''.join(c['stdin'] or '' for c in self.calls);self.assertEqual(script.count('no switchport port-security mac-address sticky '+NEW['Fa0/6']),1)
        self.assertNotIn('clear port-security all',script)

    def test_late_old_port_active_is_not_cleared_and_group_is_quarantined(self):
        job,steps=self.late_case(True)
        with mock.patch.object(g.time,'sleep'):result=self.run_probe(job,steps)
        self.assertEqual(result.get('error'),'group_quarantined');self.assertNotIn('no switchport port-security mac-address sticky '+NEW['Fa0/6'],''.join(c['stdin'] or '' for c in self.calls))

    def test_no_fresh_counter_increase_cannot_authorize_discovered_cleanup(self):
        job,steps=self.late_case();plan_items=g.cleanup_rows(g.snapshot(steps[1]['out'],TARGETS,True),TARGETS,'replace',True)[0]
        fake={'mode':'replace','interfaces':TARGETS,'staticIp':True,'items':plan_items,'removals':[], 'planHash':job['planHash'],'relocationPolicy':'idle-access-vlan100'}
        steps=steps[:8]+[{'out':steps[8]['out'].replace('Security Violation Count : 3','Security Violation Count : 0')},{'out':echo((*g.port_commands(TARGETS,'shutdown'),*g.policy_commands(fake,OLD),*g.port_commands(TARGETS,'ip verify source port-security')))},{'out':transcript(TARGETS,'replace','closed',True,False)}]
        with mock.patch.object(g.time,'sleep'):result=self.run_probe(job,steps)
        self.assertEqual(result.get('error'),'group_quarantined');self.assertNotIn('no switchport port-security mac-address sticky '+NEW['Fa0/6'],''.join(c['stdin'] or '' for c in self.calls))

    def test_one_member_still_errdisabled_is_reported_per_port_not_retried(self):
        steps=self.steps();steps[-1]['out']=steps[-1]['out'].replace('Fa0/10 fixture connected','Fa0/10 fixture err-disabled')
        result=self.run_probe(self.job(),steps);self.assertTrue(result.get('ok'),result);self.assertEqual([x['state'] for x in result['rows']],['recovered','still_errdisabled'])
        self.assertEqual(sum('no shutdown' in (call['stdin'] or '') for call in self.calls),1)

    def test_invalid_payloads_never_start_ssh(self):
        for changes in [{'interfaces':['Fa0/6;reload']},{'interfaces':['Gi0/1']},{'interfaces':TARGETS+['Fa0/6']},{'commands':['reload']},{'host':'8.8.8.8'},{'staticIp':True},{'mode':'raw'},{'host':167838211},{'mac':NEW['Fa0/6']}]:self.assertEqual(self.run_probe({**self.job(),**changes},[])['error'],'invalid_request')
        self.assertEqual(self.processes,[])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.SecurityFixes();self.f.setUp();self.addCleanup(self.f.doCleanups);self.jobs=[]
        self.body={**fixtures.JOB,'interfaces':TARGETS,'mode':'recover','staticIp':False}
        def execute(job):
            self.jobs.append(job)
            if job['operation']=='group-plan':return {'ok':True,'plan':preflight()}
            return {'ok':True,'mode':'recover','interfaces':TARGETS,'protectionRestored':True,'removed':preflight()['removals'],'rows':[{**row,'newMac':'','state':'recovered'} for row in preflight()['items']]}
        self.f.app.config['EQUIPMENT_EXECUTOR']=execute
    def post(self,path,body=None,client=None):return self.f.post('equipment/group/'+path,self.body if body is None else body,client)
    def prepared(self):
        response=self.post('plan');self.assertEqual(response.status_code,200,response.json);return {**self.body,'planHash':response.json['plan']['planHash'],'ticket':response.json['ticket']}
    def test_one_use_ticket_binds_exact_group_mode_static_user_and_hash(self):
        value=self.prepared()
        for changes in [{'interfaces':['Fa0/6']},{'interfaces':['Fa0/6','Fa0/7']},{'mode':'replace'},{'mode':'replace','staticIp':True},{'planHash':'b'*64},{'host':'10.1.1.2'}]:self.assertEqual(self.post('apply',{**value,**changes}).status_code,409)
        self.assertEqual(self.post('apply',value).status_code,200);self.assertEqual(self.post('apply',value).status_code,409);self.assertEqual(len(self.jobs),2)
    def test_guards_and_database_do_not_store_mac_results_or_raw_ticket(self):
        value=self.prepared()
        with self.f.app.extensions['equipment_guard'].admit(self.body['host']):self.assertEqual(self.post('apply',value).status_code,429)
        self.assertEqual(self.post('apply',value).status_code,200)
        with sqlite3.connect(self.f.config['DB_PATH']) as db:dump='\n'.join(db.iterdump())
        for text in [NEW['Fa0/6'],OLD['Fa0/6'],value['ticket'],fixtures.JOB['password']]:self.assertNotIn(text,dump)
    def test_auth_origin_csrf_and_malformed_inputs_fail_before_executor(self):
        endpoint='/api/equipment/group/plan'
        self.assertEqual(self.f.app.test_client().post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,401)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,403)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':'https://other.invalid','X-FAM-CSRF':self.f.client.review_csrf}).status_code,403)
        for changes in [{'interfaces':['Gi0/1']},{'interfaces':[]},{'interfaces':['Fa0/6','Fa0/6']},{'ip':'10.1.1.6'},{'mac':NEW['Fa0/6']},{'staticIp':True},{'host':'8.8.8.8'}]:self.assertEqual(self.post('plan',{**self.body,**changes}).status_code,400)
        self.assertEqual(self.jobs,[])
    def test_both_operation_permissions_and_every_scope_are_enforced(self):
        for suffix,permissions,scopes in [('scan',['equipment-operations','equipment-scan'],{k:['*'] for k in fixtures.DEFAULT_INVENTORY['catalog']}),('repair',['equipment-operations','equipment-repair'],{k:['*'] for k in fixtures.DEFAULT_INVENTORY['catalog']}),*[(k,['equipment-operations','equipment-scan','equipment-repair'],{f:([] if f==k else ['*']) for f in fixtures.DEFAULT_INVENTORY['catalog']}) for k in fixtures.DEFAULT_INVENTORY['catalog']]]:
            users=self.f.client.get('/api/users').json;username='group-'+suffix.lower();users['users'].append({'id':str(uuid.uuid4()),'username':username,'name':'Fixture','enabled':True,'categories':[],'permissions':permissions,'regions':[],'sheets':[],'password':fixtures.BOOT,'equipmentScope':scopes});self.assertEqual(self.f.post('users',users).status_code,200);worker=self.f.login(username);self.assertEqual(self.post('plan',client=worker).status_code,403)
        self.assertEqual(self.jobs,[])
    def test_failure_metadata_names_only_valid_old_ports_no_secret_or_cli(self):
        value=self.prepared();self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':False,'error':'group_quarantined','affectedOldPorts':[OLDPORT]}
        response=self.post('apply',value);self.assertEqual(response.status_code,502);self.assertEqual(response.json['affectedOldPorts'],[OLDPORT]);self.assertIn(OLDPORT,response.json['error'])
        self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'plan':preflight()}
        value=self.prepared();self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':False,'error':'group_uncertain','affectedOldPorts':[fixtures.JOB['password']]}
        response=self.post('apply',value);self.assertEqual(response.json['affectedOldPorts'],[]);self.assertNotIn(fixtures.JOB['password'],response.get_data(as_text=True))

    def test_malformed_or_partial_helper_cannot_claim_success_or_release_raw(self):
        value=self.prepared();self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'raw':fixtures.JOB['password']};response=self.post('apply',value);self.assertEqual(response.status_code,502);self.assertEqual(response.json['code'],'group_uncertain');self.assertNotIn(fixtures.JOB['password'],response.get_data(as_text=True))

if __name__=='__main__':unittest.main()
