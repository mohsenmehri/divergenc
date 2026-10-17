import copy
import uuid
from server.tests import test_api as api
from server.equipment_inventory import DEFAULT_INVENTORY

class EquipmentInventoryTests(api.CentralTests):
    # Reuse authentication helpers but do not duplicate all inherited API tests.
    def eq(self,client=None):return (client or self.a).get('/api/equipment/state')
    def write(self,client,envelope,kind='inventory',value=None,rid=None):
        return self.post(client,'equipment/state',{'revision':envelope['revision'],'requestId':rid or str(uuid.uuid4()),'kind':kind,'value':value if value is not None else envelope['inventory']})
    def populated(self):
        p=self.eq().json
        p['inventory']['nodes']=[{'id':'node-one','name':'Visible','host':'10.44.0.1','typeId':'type-switch','modelId':'model-2960','regionId':'region-1','siteKindId':'kind-building','siteId':'building-0'},{'id':'node-two','name':'Hidden','host':'10.44.0.2','typeId':'type-router','modelId':'model-1841','regionId':'region-2','siteKindId':'kind-building','siteId':'building-0'}]
        self.assertEqual(self.write(self.a,p).status_code,200)
        return self.eq().json
    def worker(self,permissions,scope=None):
        p=self.a.get('/api/users').json
        p['users'].append({'id':str(uuid.uuid4()),'username':'eq-worker','name':'Eq worker','enabled':True,'categories':[],'permissions':['equipment-operations']+permissions,'regions':[],'sheets':[],'password':'1109','equipmentScope':scope or {k:['*'] for k in DEFAULT_INVENTORY['catalog']}})
        r=self.post(self.a,'users',p);self.assertEqual(r.status_code,200,r.json);return self.login('eq-worker')
    def test_building_shared_range_roundtrip_import_and_scope_enforcement(self):
        p=self.populated()
        p['inventory']['nodes'][0]['host']='100.100.1.22'
        p['inventory']['nodes'][1]['host']='100.108.1.22'
        self.assertEqual(self.write(self.a,p,kind='import').status_code,200)
        p=self.eq().json
        self.assertEqual([n['host'] for n in p['inventory']['nodes']],['100.100.1.22','100.108.1.22'])
        p['inventory']['nodes'][1]['host']='100.107.1.22'
        self.assertEqual(self.write(self.a,p).status_code,200)
        for host in ['100.63.255.255','100.128.0.0','100.1.1.22','8.8.8.8','::1','100.100.1.256']:
            p=self.eq().json;p['inventory']['nodes'][0]['host']=host
            self.assertEqual(self.write(self.a,p).status_code,400)
        scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['regions']=['region-1']
        worker=self.worker(['equipment-scan'],scope);calls=[]
        self.app.config.update(EQUIPMENT_OPS_ENABLED=True,EQUIPMENT_EXECUTOR=lambda job:(calls.append(job['host']) or {'ok':True,'ports':[]}))
        body={'host':'100.107.1.22','username':'fixture','password':'synthetic-only'}
        for path in ['check','inspect','descriptions']:
            self.assertEqual(self.post(worker,'equipment/'+path,body).status_code,403)
        self.assertEqual(calls,[])
        self.assertEqual(self.post(worker,'equipment/check',{**body,'host':'100.100.1.22'}).status_code,200)
        self.assertEqual(calls,['100.100.1.22'])

    def test_equipment_roundtrip_restart_revision_and_replay(self):
        p=self.populated();self.app=__import__('server.app',fromlist=['create_app']).create_app(self.config);self.a=self.login('admin');self.assertEqual(self.eq().json['inventory'],p['inventory'])
        rid=str(uuid.uuid4());p['inventory']['nodes'][0]['name']='Edited';r=self.write(self.a,p,rid=rid);self.assertEqual(r.status_code,200);self.assertEqual(self.write(self.a,p,rid=rid).status_code,200);self.assertEqual(self.write(self.a,p).status_code,409)
    def test_server_scope_hides_nodes_and_merges_only_visible_records(self):
        self.populated();scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['regions']=['region-1'];w=self.worker(['equipment-edit'],scope);p=self.eq(w).json;self.assertEqual([n['id'] for n in p['inventory']['nodes']],['node-one']);self.assertEqual(len(p['inventory']['catalog']['regions']),1)
        p['inventory']['nodes'][0]['name']='Scoped edit';self.assertEqual(self.write(w,p).status_code,200);whole=self.eq().json['inventory'];self.assertEqual(len(whole['nodes']),2);self.assertEqual(next(n['name'] for n in whole['nodes'] if n['id']=='node-two'),'Hidden');self.assertEqual(len(whole['catalog']['regions']),4)
    def test_api_rejects_denied_crud_unknown_fields_formula_like_credentials_and_origin(self):
        self.populated();w=self.worker([]);p=self.eq(w).json;p['inventory']['nodes'][0]['name']='No';self.assertEqual(self.write(w,p).status_code,403);p=self.eq().json;p['inventory']['nodes'][0]['password']='NEVER-PERSIST';self.assertEqual(self.write(self.a,p).status_code,400);self.assertNotIn('NEVER-PERSIST',str(self.eq().json));self.assertEqual(self.a.post('/api/equipment/state',json={}).status_code,403)
    def test_global_duplicate_ip_and_hidden_category_dependencies_are_atomic(self):
        self.populated();scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['regions']=['region-1'];w=self.worker(['equipment-edit','equipment-delete','equipment-catalog'],scope);p=self.eq(w).json;p['inventory']['nodes'][0]['host']='10.44.0.2';self.assertEqual(self.write(w,p).status_code,400);p=self.eq(w).json;p['inventory']['nodes']=[];p['inventory']['catalog']['sites']=[s for s in p['inventory']['catalog']['sites'] if s['id']!='building-0'];self.assertEqual(self.write(w,p).status_code,400);self.assertEqual(len(self.eq().json['inventory']['nodes']),2)
    def test_atomic_import_rejects_two_new_nodes_with_the_same_private_ip(self):
        p=self.populated();p['inventory']['nodes'][1]['host']=p['inventory']['nodes'][0]['host'];self.assertEqual(self.write(self.a,p,kind='import').status_code,400);self.assertEqual(len({n['host'] for n in self.eq().json['inventory']['nodes']}),2)
    def test_import_requires_import_and_underlying_node_write_capabilities(self):
        self.populated();w=self.worker(['equipment-edit']);p=self.eq(w).json;p['inventory']['nodes'][0]['name']='No import';self.assertEqual(self.write(w,p,kind='import').status_code,403)
    def test_standards_are_validated_and_hidden_standard_ids_cannot_be_overwritten(self):
        self.populated();p=self.eq().json;s={'version':1,'items':[{'id':'policy-one','name':'NTP','modelId':'model-1841','siteKindId':None,'siteId':None,'checks':[{'id':'check-one','name':'NTP enabled','operator':'contains','pattern':'ntp server 10.0.0.1'}]}]};self.assertEqual(self.write(self.a,p,'standards',s).status_code,200)
        p=self.eq().json;s['items'][0]['checks'][0]['pattern']='username demo secret DONT-PERSIST';self.assertEqual(self.write(self.a,p,'standards',s).status_code,400)
    def test_equipment_scope_change_revokes_an_existing_session(self):
        self.populated();w=self.worker(['equipment-edit']);p=self.a.get('/api/users').json
        next(u for u in p['users'] if u['username']=='eq-worker')['equipmentScope']['regions']=[]
        self.assertEqual(self.post(self.a,'users',p).status_code,200);self.assertEqual(self.eq(w).status_code,401)
        self.assertEqual(self.eq(self.login('eq-worker')).json['inventory']['nodes'],[])
    def test_hidden_parent_types_hide_standards_and_category_removal_preserves_dependencies(self):
        self.populated();p=self.eq().json;s={'version':1,'items':[{'id':'policy-one','name':'NTP','modelId':'model-2960','siteKindId':None,'siteId':None,'checks':[{'id':'check-one','name':'NTP enabled','operator':'contains','pattern':'ntp server 10.0.0.1'}]}]}
        self.assertEqual(self.write(self.a,p,'standards',s).status_code,200)
        scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['types']=['type-router'];w=self.worker(['equipment-standards'],scope)
        self.assertEqual(self.eq(w).json['standards']['items'],[]);self.assertEqual(self.write(w,self.eq(w).json,'standards',s).status_code,403)
        p=self.eq().json;p['inventory']['nodes']=[n for n in p['inventory']['nodes'] if n['modelId']!='model-2960'];p['inventory']['catalog']['models']=[m for m in p['inventory']['catalog']['models'] if m['id']!='model-2960']
        self.assertEqual(self.write(self.a,p).status_code,400)
    def test_real_ssh_entrypoints_deny_out_of_scope_hosts_before_executor(self):
        self.populated();scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['regions']=['region-1'];w=self.worker(['equipment-scan'],scope)
        calls=[]
        self.app.config.update(EQUIPMENT_OPS_ENABLED=True,EQUIPMENT_EXECUTOR=lambda job:(calls.append(job['host']) or {'ok':True,'ports':[]}))
        value={'host':'10.44.0.2','username':'fixture','password':'synthetic'}
        self.assertEqual(self.post(w,'equipment/check',value).status_code,403);self.assertEqual(self.post(w,'equipment/inspect',value).status_code,403);self.assertEqual(calls,[])
        value['host']='10.44.0.1';self.assertEqual(self.post(w,'equipment/check',value).status_code,200);self.assertEqual(calls,['10.44.0.1'])

    def test_description_read_requires_operation_and_scoped_host(self):
        from server.tests.test_equipment_probe import DESCRIPTION_TABLE
        self.populated();scope={k:['*'] for k in DEFAULT_INVENTORY['catalog']};scope['regions']=['region-1'];w=self.worker(['equipment-scan'],scope);calls=[]
        self.app.config.update(EQUIPMENT_OPS_ENABLED=True,EQUIPMENT_EXECUTOR=lambda job:(calls.append(job['host']) or {'ok':True,'output':DESCRIPTION_TABLE}))
        body={'host':'10.44.0.2','username':'fixture','password':'synthetic'}
        self.assertEqual(self.post(w,'equipment/descriptions',body).status_code,403);body['host']='10.99.9.9';self.assertEqual(self.post(w,'equipment/descriptions',body).status_code,403);self.assertEqual(calls,[])
        body['host']='10.44.0.1';self.assertEqual(self.post(w,'equipment/descriptions',body).status_code,200);self.assertEqual(calls,['10.44.0.1'])
        p=self.a.get('/api/users').json;worker=next(u for u in p['users'] if u['username']=='eq-worker');worker['permissions'].remove('equipment-scan');self.assertEqual(self.post(self.a,'users',p).status_code,200)
        self.assertEqual(self.post(self.login('eq-worker'),'equipment/descriptions',body).status_code,403);self.assertEqual(calls,['10.44.0.1'])

    def test_history_clear_rechecks_authority_and_preserves_other_data_and_undo_snapshots(self):
        before=self.state()['state'];self.assertTrue(len(before['sheets']['CHANGE_LOG']['rows'])>1);w=self.worker([]);self.assertEqual(self.post(w,'history/clear',{'confirm':True}).status_code,403);self.assertEqual(self.post(self.a,'history/clear',{'confirm':True}).status_code,200);after=self.state()['state'];self.assertEqual(self.a.get('/api/status').json['historyFloor'],self.state()['historyFloor']);self.assertEqual(len(after['sheets']['CHANGE_LOG']['rows']),1);self.assertEqual(before['sheets']['Network'],after['sheets']['Network'])

# Inherited cases already run in test_api.py. Keep this class focused.
for _name in list(dir(EquipmentInventoryTests)):
    if _name.startswith('test_') and _name not in EquipmentInventoryTests.__dict__:setattr(EquipmentInventoryTests,_name,None)
