import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import uuid
from server.app import create_app, REGIONS

ORIGIN='http://localhost'
class CentralTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'fam.sqlite3')
        self.config={'DB_PATH':self.path,'PUBLIC_ORIGIN':ORIGIN,'TESTING':True,'COOKIE_SECURE':False}
        self.app=create_app(self.config);self.a=self.login('admin');self.seed()
    def tearDown(self):self.tmp.cleanup()
    def login(self,name,password='1109'):
        c=self.app.test_client();r=c.post('/api/login',json={'username':name,'password':password},headers={'Origin':ORIGIN});self.assertEqual(r.status_code,200,r.json);c.csrf=r.json['csrf'];return c
    def post(self,c,path,body):return c.post('/api/'+path,json=body,headers={'Origin':ORIGIN,'X-FAM-CSRF':c.csrf})
    def state(self,c=None):return (c or self.a).get('/api/state').json
    def save(self,c,p,**kw):return self.post(c,'state',{'state':p['state'],'revision':p['revision'],'epoch':p['epoch'],'requestId':str(uuid.uuid4()),**kw})
    def seed(self):
        p=self.state();p['state']['order']=['Network','تهران','فارس']
        p['state']['sheets']={n:{'rows':[['ID','Name'],[1,n+' A']],'merges':[]} for n in p['state']['order']}
        self.assertEqual(self.save(self.a,p).status_code,200)
    def user(self,role,name=None,regions=None,sheets=None):
        p=self.a.get('/api/users').json
        p['users'].append({'id':str(uuid.uuid4()),'username':name or 'user'+str(role),'name':'User '+str(role),'role':role,'enabled':True,'regions':regions or [],'sheets':sheets or [],'password':'1109'})
        r=self.post(self.a,'users',p);self.assertEqual(r.status_code,200,r.json)
        return self.login(name or 'user'+str(role))
    def test_two_clients_and_restart(self):
        b=self.login('admin');p=self.state();p['state']['sheets']['Network']['rows'][1][1]='CENTRAL'
        self.assertEqual(self.save(self.a,p).status_code,200)
        self.assertEqual(self.state(b)['state']['sheets']['Network']['rows'][1][1],'CENTRAL')
        self.app=create_app(self.config);c=self.login('admin')
        self.assertEqual(self.state(c)['state']['sheets']['Network']['rows'][1][1],'CENTRAL')
    def test_live_status_reports_new_revision_without_leaking_restricted_actor(self):
        other=self.login('admin');before=other.get('/api/status').json
        p=self.state();p['state']['sheets']['Network']['rows'][1][1]='LIVE'
        self.assertEqual(self.save(self.a,p).status_code,200)
        notice=other.get('/api/status').json
        self.assertEqual(notice['revision'],before['revision']+1)
        self.assertEqual(notice['change']['revision'],notice['revision'])
        self.assertEqual(notice['change']['actor'],'admin')
        self.assertIsInstance(notice['change']['at'],int)
        viewer=self.user(4,regions=['2'],sheets=['Network'])
        self.assertNotIn('actor',viewer.get('/api/status').json['change'])

    def test_manual_server_backups_are_admin_only_timestamped_and_retained(self):
        first=self.post(self.a,'backups',{})
        self.assertEqual(first.status_code,200,first.json)
        self.assertRegex(first.json['filename'],r'^FAM-manual-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}-[a-f0-9]{6}\.sqlite3$')
        second=self.post(self.a,'backups',{})
        self.assertEqual(second.status_code,200,second.json)
        self.assertNotEqual(first.json['filename'],second.json['filename'])
        backups=Path(self.tmp.name)/'backups'
        files=sorted(backups.glob('FAM-manual-*.sqlite3'))
        self.assertEqual([f.name for f in files],sorted([first.json['filename'],second.json['filename']]))
        with sqlite3.connect(files[0]) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)
        operator=self.user(2)
        self.assertEqual(self.post(operator,'backups',{}).status_code,200)
        scoped=self.user(3,regions=['2'])
        self.assertEqual(self.post(scoped,'backups',{}).status_code,200)
        viewer=self.user(4,regions=['2'])
        self.assertEqual(self.post(viewer,'backups',{}).status_code,403)

    def test_stale_and_epoch_conflicts_no_overwrite(self):
        stale=self.state();p=copy.deepcopy(stale);p['state']['sheets']['Network']['rows'][1][1]='FIRST'
        self.assertEqual(self.save(self.a,p).status_code,200)
        stale['state']['sheets']['Network']['rows'][1][1]='STALE'
        self.assertEqual(self.save(self.a,stale).status_code,409)
        p=self.state();p['epoch']='wrong';self.assertEqual(self.save(self.a,p).status_code,409)
        self.assertEqual(self.state()['state']['sheets']['Network']['rows'][1][1],'FIRST')
    def test_idempotent_lost_ack_and_altered_replay(self):
        p=self.state();p['state']['sheets']['Network']['rows'].append([2,'ONCE']);rid=str(uuid.uuid4())
        first=self.save(self.a,p,requestId=rid);again=self.save(self.a,p,requestId=rid)
        self.assertEqual(first.status_code,200);self.assertEqual(first.json,again.json)
        p['state']['sheets']['Network']['rows'].append([3,'BAD']);self.assertEqual(self.save(self.a,p,requestId=rid).status_code,409)
        self.assertEqual(len(self.state()['state']['sheets']['Network']['rows']),3)
    def test_server_role3_rules(self):
        c=self.user(3,regions=['2']);p=self.state(c)
        self.assertEqual(set(p['state']['order']),{'تهران'})
        p['state']['sheets']['تهران']['rows'][1][1]='EDITED'
        self.assertEqual(self.save(c,p).status_code,200)
        p=self.state(c);p['state']['sheets']['تهران']['rows'].append([2,'ADDED'])
        self.assertEqual(self.save(c,p).status_code,403)
        p=self.state(c);p['state']['sheets']['تهران']['rows'].pop()
        self.assertEqual(self.save(c,p).status_code,403)
        p=self.state(c);p['state']['regionConfig']={'invalid':True};self.assertIn(self.save(c,p).status_code,[400,403])
        p=self.state(c);p['state']['sheets']['تهران']['rows'][0][0]='HEADER';self.assertEqual(self.save(c,p).status_code,403)
        self.assertEqual(c.get('/api/users').status_code,403)
    def test_role3_atm_template_creation(self):
        c=self.user(3,regions=['2']);p=self.state(c);p['state']['order'].append('خودپرداز تهران');p['state']['sheets']['خودپرداز تهران']={'rows':[['ID','Name'],[2,'ATM']],'merges':[]}
        self.assertEqual(self.save(c,p).status_code,403)
        p=self.state(c);p['state']['order'].append('Arbitrary');p['state']['sheets']['Arbitrary']={'rows':[['ID','Name'],[2,'BAD']],'merges':[]}
        self.assertEqual(self.save(c,p).status_code,403)
    def test_role3_region_scope_hides_other_regions_and_rejects_injection(self):
        c=self.user(3,regions=['2']);p=self.state(c)
        self.assertEqual(set(p['state']['order']),{'تهران'})
        p['state']['order'].append('فارس');p['state']['sheets']['فارس']={'rows':[['ID','Name'],[2,'FORGED']],'merges':[]}
        self.assertEqual(self.save(c,p).status_code,403)
        self.assertEqual(self.state()['state']['sheets']['فارس']['rows'][1][1],'فارس A')
    def test_role4_redaction_and_region_moves(self):
        c=self.user(4,regions=['2'],sheets=['تهران','Network']);p=self.state(c)
        self.assertEqual(set(p['state']['order']),{'تهران','Network'});self.assertNotIn('فارس',p['state']['sheets']);self.assertNotIn('CHANGE_LOG',p['state']['sheets'])
        self.assertEqual(self.save(c,p).status_code,403)
        p=self.state();p['state']['regionConfig']={'version':1,'regions':[{'id':str(i),'name':str(i)} for i in range(1,5)],'assignments':[[f'{r}-{i}','4' if (r,i)==(2,1) else str(r)] for r,ns in enumerate(REGIONS,1) for i,_ in enumerate(ns,1)]}
        self.assertEqual(self.save(self.a,p).status_code,200)
        self.assertEqual(self.state(c)['state']['order'],['Network'])
    def test_role2_cannot_administer_accounts(self):
        c=self.user(2);self.assertEqual(c.get('/api/users').status_code,403);self.assertEqual(self.post(c,'users',{'users':[]}).status_code,403)
        p=self.state(c);p['state']['sheets']['Network']['rows'][1][1]='LEVEL2';self.assertEqual(self.save(c,p).status_code,200)
    def test_logical_section_metadata_survives_server_commit_without_sheet_mutation(self):
        # A logical title/assignment is server-persisted metadata. It must not
        # rename, drop, or rewrite the real worksheet it classifies.
        p=self.state();before=copy.deepcopy(p['state']['sheets']['Network'])
        p['state']['categoryConfig']={
            'version':1,
            'categories':[{'id':'datacenters','name':'مراکز داده','sub':'Data centers','color':'#5b93ff','icon':'server'}],
            'assignments':[['Network','datacenters']],
            'sections':[{'id':'section-primary','category':'datacenters','name':'مرکزهای اصلی'}],
            'sectionAssignments':[['Network','section-primary']],
            'sectionInitialized':['datacenters']}
        self.assertEqual(self.save(self.a,p).status_code,200)
        saved=self.state()['state']
        self.assertEqual(saved['categoryConfig']['sections'][0]['name'],'مرکزهای اصلی')
        self.assertEqual(saved['categoryConfig']['sectionAssignments'],[['Network','section-primary']])
        self.assertEqual(saved['categoryConfig']['sectionInitialized'],['datacenters'])
        self.assertIn('Network',saved['order']);self.assertEqual(saved['sheets']['Network'],before)
        # Level 2 is an authorised central manager, while a scoped account
        # cannot forge a logical-title or assignment change.
        operator=self.user(2);operator_state=self.state(operator)
        operator_state['state']['categoryConfig']['sections'][0]['name']='مرکزهای عملیاتی'
        self.assertEqual(self.save(operator,operator_state).status_code,200)
        scoped=self.user(3,regions=['2'],sheets=['Network']);attempt=self.state(scoped)
        attempt['state']['categoryConfig']['sections'][0]['name']='تغییر غیرمجاز'
        self.assertEqual(self.save(scoped,attempt).status_code,403)
        self.assertEqual(self.state()['state']['categoryConfig']['sections'][0]['name'],'مرکزهای عملیاتی')
        malformed=self.state();malformed['state']['categoryConfig']['sections'][0]['id']='invalid section id'
        self.assertEqual(self.save(self.a,malformed).status_code,400)
        malformed=self.state();malformed['state']['categoryConfig']['assignments']=[['Network','other']]
        self.assertEqual(self.save(self.a,malformed).status_code,400)
    def test_disable_revokes_session_and_preserves_last_admin(self):
        c=self.user(3);p=self.a.get('/api/users').json
        next(x for x in p['users'] if x['role']==3)['enabled']=False
        self.assertEqual(self.post(self.a,'users',p).status_code,200);self.assertEqual(c.get('/api/state').status_code,401)
        p=self.a.get('/api/users').json;next(x for x in p['users'] if x['role']==1)['enabled']=False
        self.assertEqual(self.post(self.a,'users',p).status_code,400)
    def test_password_owner_only_and_other_sessions_revoked(self):
        c=self.user(3);other=self.login('user3');before=self.state(c)['user']
        bad={'currentPassword':'1109','newPassword':'new-pass','role':1}
        self.assertEqual(self.post(c,'password',bad).status_code,400)
        self.assertEqual(self.post(c,'password',{'currentPassword':'1109','newPassword':'new-pass'}).status_code,200)
        self.assertEqual(other.get('/api/state').status_code,401)
        after=self.state(c)['user'];self.assertEqual(before['role'],after['role']);self.assertEqual(before['name'],after['name'])
        self.login('user3','new-pass')
    def test_users_revision_and_no_credential_disclosure(self):
        p=self.a.get('/api/users').json;stale=copy.deepcopy(p)
        p['users'][0]['name']='Changed';self.assertEqual(self.post(self.a,'users',p).status_code,200)
        self.assertEqual(self.post(self.a,'users',stale).status_code,409)
        result=json.dumps(self.a.get('/api/users').json);self.assertNotIn('hash',result);self.assertNotIn('salt',result);self.assertNotIn('password',result)
    def test_csrf_origin_and_unauthenticated_access(self):
        self.assertEqual(self.app.test_client().get('/api/state').status_code,401)
        self.assertEqual(self.a.post('/api/state',json={},headers={'Origin':ORIGIN}).status_code,403)
        self.assertEqual(self.a.post('/api/state',json={},headers={'Origin':'https://evil.invalid','X-FAM-CSRF':self.a.csrf}).status_code,403)
        self.assertEqual(self.a.get('/private/fam.sqlite3').status_code,404)
    def test_rate_limit(self):
        c=self.app.test_client()
        for _ in range(10):self.assertEqual(c.post('/api/login',json={'username':'absent','password':'xxxx'},headers={'Origin':ORIGIN}).status_code,401)
        self.assertEqual(c.post('/api/login',json={'username':'absent','password':'xxxx'},headers={'Origin':ORIGIN}).status_code,429)
    def test_invalid_state_and_locked_sheet(self):
        before=self.state();p=copy.deepcopy(before);p['state']['__proto__']={}
        self.assertEqual(self.save(self.a,p).status_code,400)
        p=self.state();p['state']['lockedSheets']={'Network':True};self.assertEqual(self.save(self.a,p).status_code,200)
        p=self.state();p['state']['sheets']['Network']['rows'][1][1]='LOCKED';self.assertEqual(self.save(self.a,p).status_code,403)
        p['state']['lockedSheets']['Network']=False;self.assertEqual(self.save(self.a,p).status_code,200)
    def test_racing_commits_only_one_wins(self):
        # Independent clients, same revision; database transaction serialises CAS.
        clients=[self.login('admin') for _ in range(5)];p=self.state();barrier=threading.Barrier(5);codes=[]
        def worker(i):
            body=copy.deepcopy(p);body['state']['sheets']['Network']['rows'][1][1]=str(i);barrier.wait();codes.append(self.save(clients[i],body).status_code)
        threads=[threading.Thread(target=worker,args=(i,)) for i in range(5)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(sorted(codes),[200,409,409,409,409])

    def test_bad_types_and_nonfinite_numbers(self):
        p=self.state();p['state']['order']=[[]];self.assertEqual(self.save(self.a,p).status_code,400)
        p=self.state();p['state']['regionConfig']={'version':1,'regions':[],'assignments':[[[],[]]]};self.assertEqual(self.save(self.a,p).status_code,400)
        p=self.state();p['state']['sheets']['Network']['rows'][1][1]=float('nan');self.assertEqual(self.save(self.a,p).status_code,400)
    def test_level3_cannot_edit_merges_or_change_record_count(self):
        p=self.state();p['state']['sheets']['تهران']={'rows':[['ID','Name'],[1,'A'],[None,'B'],[3,'C']],'merges':[{'r1':2,'r2':3,'c1':1,'c2':1}]}
        self.assertEqual(self.save(self.a,p).status_code,200)
        c=self.user(3,regions=['2']);p=self.state(c);p['state']['sheets']['تهران']['merges']=[]
        self.assertEqual(self.save(c,p).status_code,403)
        p=self.state(c);sh=p['state']['sheets']['تهران'];del sh['rows'][1:3];sh['merges']=[{'r1':2,'r2':2,'c1':1,'c2':1}]
        self.assertEqual(self.save(c,p).status_code,403)
    def test_trusted_global_undo_and_stale_undo_protection(self):
        before=self.state();c=self.user(2);p=self.state(c);p['state']['sheets']['Network']['rows'].pop()
        # Forged client Undo buffers are NEVER trusted or returned to an admin.
        self.assertEqual(self.save(c,p,undo={'valid':True,'blocks':[{'forged':'bad'}]}).status_code,200)
        self.assertEqual(c.get('/api/undo-state').status_code,200)
        undo=self.a.get('/api/undo-state').json
        self.assertEqual(undo['state']['sheets']['Network'],before['state']['sheets']['Network'])
        self.assertTrue(self.state()['state']['undo']['valid'])
        self.assertEqual(self.save(self.a,undo).status_code,200)
        self.assertEqual(self.save(self.a,undo).status_code,409)
    def test_backup_restore_rotates_epoch_revokes_sessions_and_keeps_safety_copy(self):
        from server.manage import backup,restore
        snapshot=self.state();out=Path(self.tmp.name)/'backup.sqlite3';backup(self.path,out)
        p=self.state();p['state']['sheets']['Network']['rows'][1][1]='AFTER BACKUP';self.assertEqual(self.save(self.a,p).status_code,200)
        with self.assertRaises(ValueError):restore(out,self.path)
        safety=restore(out,self.path,server_stopped=True);self.assertTrue(safety.is_file())
        self.assertEqual(self.a.get('/api/state').status_code,401)
        self.a=self.login('admin');now=self.state();self.assertNotEqual(now['epoch'],snapshot['epoch'])
        self.assertEqual(now['state']['sheets']['Network'],snapshot['state']['sheets']['Network'])
        with self.assertRaises(ValueError):backup(self.path,out)

    def test_damaged_existing_database_never_reseeds_accounts(self):
        with sqlite3.connect(self.path) as db:db.execute('DELETE FROM state')
        with self.assertRaises(RuntimeError):create_app(self.config)
        with sqlite3.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0],1)
    def test_production_requires_https_and_private_database(self):
        with self.assertRaises(RuntimeError):create_app({'PUBLIC_ORIGIN':'http://localhost','DB_PATH':self.path})
        with self.assertRaises(RuntimeError):create_app({'PUBLIC_ORIGIN':'https://fam.example','DB_PATH':str(Path(__file__).resolve().parents[1]/'www'/'bad.sqlite3')})

    def test_level3_may_edit_cells_but_cannot_create_empty_atm(self):
        c=self.user(3,regions=['2']);p=self.state(c);p['state']['sheets']['تهران']['rows'][1][0]=True
        self.assertEqual(self.save(c,p).status_code,200)
        p=self.state(c);p['state']['order'].append('خودپرداز تهران');p['state']['sheets']['خودپرداز تهران']={'rows':[['ID','Name'],['','  ']],'merges':[]}
        self.assertEqual(self.save(c,p).status_code,403)


    def custom_user(self, permissions, categories, regions=None, name='custom-user'):
        """Create a central explicit-access account without a numeric role."""
        payload=self.a.get('/api/users').json
        payload['users'].append({'id':str(uuid.uuid4()),'username':name,'name':'Custom '+name,
          'enabled':True,'regions':regions or [],'sheets':[],
          'categories':categories,'permissions':permissions,'password':'1109'})
        result=self.post(self.a,'users',payload)
        self.assertEqual(result.status_code,200,result.json)
        return self.login(name)

    def test_custom_permission_accounts_migrate_and_use_category_region_scope(self):
        # New installations persist both explicit arrays and expose them, while
        # the retained numeric role field is no longer an authority boundary.
        with sqlite3.connect(self.path) as db:
            fields={row[1] for row in db.execute('PRAGMA table_info(users)')}
        self.assertTrue({'categories','permissions'}<=fields)
        scoped=self.custom_user(['view-sheets','edit-cells'],['other'],name='service-editor')
        envelope=self.state(scoped)
        self.assertEqual(envelope['user']['categories'],['other'])
        self.assertEqual(envelope['user']['permissions'],['view-sheets','edit-cells'])
        self.assertEqual(envelope['state']['order'],['Network'])
        envelope['state']['sheets']['Network']['rows'][1][1]='SCOPED'
        self.assertEqual(self.save(scoped,envelope).status_code,200)
        # A browser that acquired a broader old snapshot still cannot write a
        # provincial worksheet outside the selected category/region scope.
        forged=self.state();forged['state']['sheets']['تهران']['rows'][1][1]='FORGED'
        self.assertEqual(self.save(scoped,forged).status_code,403)
        # Import is intentionally a full-workbook capability, so a full-scope
        # importer can add a sheet without being granted unrelated cell edits.
        importer=self.custom_user(['import-data'],['provinces','datacenters','services','carriers','equipment','costs','other'],
          regions=[str(index) for index in range(1,len(REGIONS)+1)],name='full-importer')
        imported=self.state(importer);imported['state']['order'].append('Imported')
        imported['state']['sheets']['Imported']={'rows':[['ID'],['NEW']],'merges':[]}
        self.assertEqual(self.save(importer,imported).status_code,200)

    def test_custom_permissions_not_legacy_role_enforce_every_sensitive_route(self):
        no_edit=self.custom_user(['view-sheets'],['other'],name='viewer-with-role')
        payload=self.a.get('/api/users').json
        row=next(user for user in payload['users'] if user['username']=='viewer-with-role')
        # A crafted legacy role value does not elevate an explicit-access row.
        row['role']=1
        self.assertEqual(self.post(self.a,'users',payload).status_code,200)
        self.assertEqual(no_edit.get('/api/users').status_code,403)
        downgrade=self.a.get('/api/users').json
        account=next(user for user in downgrade['users'] if user['username']=='viewer-with-role')
        account.pop('categories');account.pop('permissions')
        self.assertEqual(self.post(self.a,'users',downgrade).status_code,400)
        snapshot=self.state(no_edit);snapshot['state']['sheets']['Network']['rows'][1][1]='DENIED'
        self.assertEqual(self.save(no_edit,snapshot).status_code,403)

        users_manager=self.custom_user(['manage-users'],[],name='access-manager')
        self.assertEqual(users_manager.get('/api/users').status_code,200)
        manager_state=self.state(users_manager)
        self.assertEqual(manager_state['state']['order'],[])
        self.assertEqual(users_manager.post('/api/backups',json={},headers={'Origin':ORIGIN,'X-FAM-CSRF':users_manager.csrf}).status_code,403)

    def test_custom_metadata_and_data_permissions_are_independently_server_checked(self):
        category_manager=self.custom_user(['manage-categories'],[],name='category-manager')
        proposal=self.state(category_manager)
        # Category managers get a name-only worksheet catalog, never cells.
        self.assertEqual(proposal['state']['order'],['Network','تهران','فارس'])
        self.assertEqual(proposal['state']['sheets']['Network'],{'rows':[],'merges':[]})
        proposal['state']['categoryConfig']={'version':1,'categories':[
          {'id':'services','name':'سرویس‌ها','sub':'Services','color':'#a78bfa','icon':'globe'}],
          'assignments':[['Network','services']],'sections':[],'sectionAssignments':[],'sectionInitialized':[]}
        self.assertEqual(self.save(category_manager,proposal).status_code,200)
        self.assertEqual(self.state()['state']['categoryConfig']['assignments'],[['Network','services']])

        viewer=self.custom_user(['view-sheets'],['services'],name='metadata-forger')
        forged=self.state(viewer);forged['state']['categoryConfig']['categories'][0]['name']='دستکاری'
        self.assertEqual(self.save(viewer,forged).status_code,403)

if __name__=='__main__':unittest.main()
