"""Synthetic classic-2960 diagnosis fixtures; no device or real credentials."""
import copy
import json
from pathlib import Path
import sqlite3
import unittest
import uuid
from unittest import mock

from server import equipment_diagnostics as d, equipment_probe as probe
from server.tests import test_review_fixes as fixtures, test_equipment_probe as transport

VERSION='''Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 12.2(55)SE12, RELEASE SOFTWARE
System image file is "flash:c2960-lanbasek9-mz.122-55.SE12.bin"
Model number : WS-C2960-24TT-L
Processor board ID PRIVATE-SERIAL-NOT-FOR-API
'''
TABLES={
 'secure':'Vlan Mac Address Type Ports Remaining Age\n100 0003.3333.3333 SecureSticky Fa0/7 -\n',
 'bindings':'MacAddress IpAddress Lease(sec) Type VLAN Interface\n0001.1111.1111 10.4.86.7 infinite static 100 FastEthernet0/12\n',
 'mac':'Mac Address Table\nVlan Mac Address Type Ports\n100 0002.2222.2222 DYNAMIC Fa0/7\nTotal Mac Addresses for this criterion: 1\n',
 'dai':'Total Log Buffer Size : 32\nSyslog rate : 5 entries per 1 seconds.\nInterface Vlan Sender MAC Sender IP Num Pkts Reason Time\nFa0/7 100 0002.2222.2222 10.4.86.7 5 DHCP Deny 19:39:01 UTC Mon Mar 1 1993\n',
}
TARGET={'ip':'10.4.86.7','mac':''}

def transcript(tables=None):
    tables=TABLES if tables is None else tables
    return ''.join('Switch#'+command+'\n'+tables[kind] for command,kind in zip(d.READS,d.SOURCE_IDS))+'Switch#exit\n'

def report(tables=None):return d.assess(d.profile(VERSION),TARGET,transcript(tables))


class DiagnosisParserTests(unittest.TestCase):
    def test_model_version_image_only_no_serial(self):
        self.assertEqual(d.profile(VERSION)['model'],d.MODEL)
        directory_image=VERSION.replace('flash:c2960-lanbasek9-mz.122-55.SE12.bin','flash:/c2960-lanbasek9-mz.122-55.SE12/c2960-lanbasek9-mz.122-55.SE12.bin')
        self.assertEqual(d.profile(directory_image)['image'],d.profile(VERSION)['image'])
        self.assertNotIn('PRIVATE',json.dumps(report()))
        for text in [VERSION.replace(d.MODEL,'WS-C2960X-24TS-L'),VERSION.replace('12.2(55)SE12','17.9(1)'),VERSION.replace('flash:c2960-','flash:other-')]:
            with self.assertRaises(ValueError):d.profile(text)

    def test_compares_observation_with_records_without_confirming_move(self):
        value=d.validate_report(report());self.assertFalse(value['movementConfirmed']);self.assertTrue(value['readOnly'])
        row=value['candidates'][0]
        self.assertEqual((row['interface'],row['observedMac'],row['confidence']),('Fa0/7','0002.2222.2222','medium'))
        self.assertEqual(row['recordedPorts'],['Fa0/12'])
        self.assertEqual(set(row['reasons']),d.REASONS)

    def test_historical_dai_alone_has_only_low_confidence(self):
        tables=dict(TABLES,mac='Vlan Mac Address Type Ports\n')
        row=report(tables)['candidates'][0]
        self.assertEqual(row['confidence'],'low');self.assertTrue(row['historical'])

    def test_binding_alone_never_claims_current_port_or_health(self):
        tables=dict(TABLES,mac='Vlan Mac Address Type Ports\n',dai='Interface Vlan Sender MAC Sender IP Num Pkts Reason Time\n')
        value=report(tables);self.assertEqual(value['candidates'],[]);self.assertEqual(value['assessment'],'unknown')

    def test_invalid_or_unsupported_table_is_unavailable_not_clean(self):
        tables=dict(TABLES,mac='% Invalid input detected\n',dai=TABLES['dai']+'Fa0/8 100 malformed truncated\n')
        value=report(tables);self.assertEqual(value['assessment'],'unknown')
        self.assertEqual([x['state'] for x in value['sources']],['parsed','parsed','unavailable','unavailable'])

    def test_exact_boundaries_pagination_controls_and_size_fail_closed(self):
        for text in [transcript().replace('Switch#exit',''),transcript()+'\x00',transcript().replace('Switch#show ip source binding',''),transcript()+'--More--','x'*524289]:
            with self.assertRaises(ValueError):d.sections(text)

    def test_only_vlan100_and_no_uplink_as_client_candidate(self):
        tables={k:v.replace('100 ','200 ') for k,v in TABLES.items()}
        self.assertEqual(report(tables)['candidates'],[])
        tables={k:v.replace('Fa0/7','Gi0/1') for k,v in TABLES.items()}
        self.assertEqual(report(tables)['candidates'],[])

    def test_api_schema_rejects_arbitrary_text_high_confidence_and_confirmed_move(self):
        for mutate in [lambda r:r.update(raw=VERSION),lambda r:r.update(movementConfirmed=True),lambda r:r['candidates'][0].update(confidence='high'),lambda r:r['profile'].update(image='<img onerror=x>'),lambda r:r['candidates'][0].update(interface='Fa0/7;reload')]:
            value=report();mutate(value)
            with self.assertRaises((ValueError,TypeError)):d.validate_report(value)

    def test_client_input_is_data_not_a_command(self):
        self.assertEqual(d.client('','00:01:08:F1:31:A6')['mac'],'0001.08f1.31a6')
        for ip,mac in [('',''),('10.1.1.2;reload',''),('','0001.08f1.31a6\nreload'),([],None)]:
            with self.assertRaises((ValueError,TypeError)):d.client(ip,mac)


class DiagnosisTransportTests(transport.ProbeHarness):
    def job(self):return {**self.status_job(),'operation':'diagnose','clientIp':TARGET['ip'],'clientMac':''}

    def test_only_fixed_read_commands_two_phases_one_askpass(self):
        value=self.run_probe(self.job(),[{'out':VERSION},{'out':transcript()}])
        self.assertTrue(value['ok']);self.assertEqual(len(self.calls),2)
        self.assertEqual(self.calls[0]['stdin'],'terminal length 0\nshow version\nexit\n')
        self.assertEqual(self.calls[1]['stdin'],'terminal length 0\n'+'\n'.join((*d.READS,'exit'))+'\n')
        self.assertEqual(self.calls[0]['askpass_path'],self.calls[1]['askpass_path'])
        self.assertFalse(Path(self.calls[0]['askpass_path']).exists())
        for word in ['configure terminal','shutdown','clear ','enable\n','write memory','copy running']:
            self.assertNotIn(word,'\n'.join(c['stdin'] for c in self.calls))
        self.assertLessEqual(sum(c['timeout'] for c in self.calls),probe.HELPER_DEADLINE['diagnose'])

    def test_unknown_ios_stops_before_additional_reads(self):
        value=self.run_probe(self.job(),[{'out':VERSION.replace(d.MODEL,'WS-C2960X-24TS-L')}])
        self.assertEqual(value,{'ok':False,'error':'unsupported_platform'});self.assertEqual(len(self.calls),1)

    def test_timeout_no_retry_no_change(self):
        value=self.run_probe(self.job(),[{'out':VERSION},{'hang':True}])
        self.assertEqual(value,{'ok':False,'error':'connection_timeout'});self.assertEqual(len(self.processes),2)
        self.assertIsNone(self.calls[-1]['stdin'])  # communicate after kill, not a new SSH session

    def test_missing_client_extra_command_and_bad_target_never_run(self):
        for change in [{'clientIp':'','clientMac':''},{'commands':['reload']},{'host':'8.8.8.8'}]:
            job={**self.job(),**change};self.assertEqual(self.run_probe(job,[])['error'],'invalid_request')
        self.assertEqual(self.calls,[])


class DiagnosisApiTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.SecurityFixes();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.body={**fixtures.JOB,'clientIp':TARGET['ip'],'clientMac':''}
        self.jobs=[]
        def executor(job):self.jobs.append(job);return {'ok':True,'report':report()}
        self.f.app.config['EQUIPMENT_EXECUTOR']=executor

    def post(self,body=None):return self.f.post('equipment/diagnose',self.body if body is None else body)

    def test_authenticated_read_only_has_no_tickets_or_persistent_results(self):
        response=self.post();self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['source'],'server-ssh');self.assertNotIn('recoveryTickets',response.json)
        self.assertTrue(response.json['report']['readOnly']);self.assertEqual(self.jobs[0]['operation'],'diagnose')
        with sqlite3.connect(self.f.config['DB_PATH']) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM equipment_used_tickets').fetchone()[0],0)
            dump='\n'.join(db.iterdump())
        for text in ['10.4.86.7','0002.2222.2222','PRIVATE-SERIAL-NOT-FOR-API',fixtures.JOB['password']]:self.assertNotIn(text,dump)

    def test_no_auth_csrf_bad_origin_bad_input_and_public_host_fail_before_executor(self):
        endpoint='/api/equipment/diagnose';client=self.f.app.test_client()
        self.assertEqual(client.post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,401)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':fixtures.ORIGIN}).status_code,403)
        self.assertEqual(self.f.client.post(endpoint,json=self.body,headers={'Origin':'https://other.invalid','X-FAM-CSRF':self.f.client.review_csrf}).status_code,403)
        for body in [{**self.body,'host':'8.8.8.8'},{**self.body,'commands':['reload']},{**self.body,'clientIp':'','clientMac':''}]:self.assertEqual(self.post(body).status_code,400)
        self.assertEqual(self.jobs,[])

    def test_scope_and_scan_permission_cannot_be_bypassed(self):
        # Use the real users endpoint: independent operation + five scopes.
        users=self.f.client.get('/api/users').json
        users['users'].append({'id':str(uuid.uuid4()),'username':'diag-worker','name':'Fixture','enabled':True,'categories':[],'permissions':['equipment-operations','equipment-scan'],'regions':[],'sheets':[],'password':fixtures.BOOT,'equipmentScope':{k:[] for k in fixtures.DEFAULT_INVENTORY['catalog']}})
        self.assertEqual(self.f.post('users',users).status_code,200)
        worker=self.f.login('diag-worker')
        self.assertEqual(self.f.post('equipment/diagnose',self.body,worker).status_code,403)
        self.assertEqual(self.jobs,[])

    def test_scan_permission_is_required_even_with_all_scopes(self):
        users=self.f.client.get('/api/users').json
        users['users'].append({'id':str(uuid.uuid4()),'username':'diag-reader','name':'Fixture','enabled':True,'categories':[],'permissions':['equipment-operations'],'regions':[],'sheets':[],'password':fixtures.BOOT,'equipmentScope':{k:['*'] for k in fixtures.DEFAULT_INVENTORY['catalog']}})
        self.assertEqual(self.f.post('users',users).status_code,200)
        worker=self.f.login('diag-reader')
        self.assertEqual(self.f.post('equipment/diagnose',self.body,worker).status_code,403)
        self.assertEqual(self.jobs,[])

    def test_known_router_is_rejected_before_reading(self):
        data=self.f.client.get('/api/equipment/state').json
        data['inventory']['nodes']=[{'id':'audit-router','name':'Router fixture','host':self.body['host'],'typeId':'type-router','modelId':'model-1841','regionId':'region-1','siteKindId':'kind-building','siteId':'building-0'}]
        self.assertEqual(self.f.post('equipment/state',{'revision':data['revision'],'requestId':str(uuid.uuid4()),'kind':'inventory','value':data['inventory']}).status_code,200)
        self.assertEqual(self.post().status_code,403);self.assertEqual(self.jobs,[])

    def test_busy_guard_and_malformed_helper_report(self):
        with self.f.app.extensions['equipment_guard'].admit(self.body['host']):self.assertEqual(self.post().status_code,429)
        self.assertEqual(self.jobs,[])
        bad=report();bad['raw']=fixtures.JOB['password']
        self.f.app.config['EQUIPMENT_EXECUTOR']=lambda job:{'ok':True,'report':bad}
        response=self.post();self.assertEqual(response.status_code,502);self.assertNotIn(fixtures.JOB['password'],response.get_data(as_text=True))


if __name__=='__main__':unittest.main()
