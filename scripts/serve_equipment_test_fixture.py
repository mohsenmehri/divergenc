"""Disposable synthetic-only live-UI fixture. NEVER deploy as the FAM service.
Requires explicit FAM_EQUIPMENT_FIXTURE=SYNTHETIC_ONLY. No real SSH is opened.
"""
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.app import create_app
from waitress import serve

if os.environ.get('FAM_EQUIPMENT_FIXTURE')!='SYNTHETIC_ONLY':
    raise SystemExit('Explicit disposable synthetic fixture flag required')
with tempfile.TemporaryDirectory() as directory:
    layout=os.environ.get('FAM_LAYOUT_PREVIEW')=='1'
    repaired=set()
    def executor(job):
        if layout:return {'ok':False,'error':'equipment_ops_disabled'}
        if job['operation'] in {'group-plan','group-apply'}:
            from server.tests.test_equipment_group import preflight,NEW,TARGETS
            if job['interfaces']!=TARGETS:return {'ok':False,'error':'group_preflight'}
            plan=preflight(job['mode'],job['staticIp'])
            if job['operation']=='group-plan':return {'ok':True,'plan':plan}
            repaired.add((job['host'],'group'))
            return {'ok':True,'mode':job['mode'],'interfaces':TARGETS,'protectionRestored':True,'removed':plan['removals'],'rows':[{**row,'state':'replaced' if job['mode']=='replace' else 'recovered','newMac':NEW[row['interface']] if job['mode']=='replace' else ''} for row in plan['items']]}
        if job['operation'] in {'replacement-plan','replacement-apply'}:
            from server.tests.test_equipment_replacement import plan,IP,OLD,NEW
            if job['operation']=='replacement-plan':return {'ok':True,'plan':plan(job['staticIp'])}
            return {'ok':True,'replacement':'replaced','interface':job['interface'],'staticIp':job['staticIp'],'ip':IP if job['staticIp'] else '', 'oldMac':OLD if job['staticIp'] else '', 'newMac':NEW,'protectionRestored':True}
        if job['operation']=='diagnose':
            from server import equipment_diagnostics as diagnosis
            from server.tests.test_equipment_diagnostics import VERSION,transcript
            return {'ok':True,'report':diagnosis.assess(diagnosis.profile(VERSION),diagnosis.client(job['clientIp'],job['clientMac']),transcript())}
        if job['host']=='10.53.0.3':return {'ok':False,'error':'connection_timeout'}
        if job['operation']=='descriptions':return {'ok':True,'output':'Interface                      Status         Protocol Description\nGi0/1                          up             up       Fixture uplink\nGi0/7                          down           down     <img src=x onerror=alert(1)>\n'}
        if job['operation']=='recover':
            repaired.add((job['host'],job['interface']))
            return {'ok':True,'recovery':'recovered'}
        ports=[{'interface':'Fa0/6','description':'Fixture 6'},{'interface':'Fa0/10','description':'Fixture 10'}] if job['host'] in {'10.53.0.1','10.53.0.9'} and (job['host'],'Gi0/7') not in repaired and (job['host'],'group') not in repaired else []
        result={'ok':True,'ports':ports}
        if job['operation']=='inspect':result.update(descriptions=executor({**job,'operation':'descriptions'}),timings={'preparationMs':10,'sshMs':20})
        return result
    origin=os.environ.get('FAM_EQUIPMENT_FIXTURE_ORIGIN','http://localhost:8765')
    app=create_app({'TESTING':True,'COOKIE_SECURE':False,'PUBLIC_ORIGIN':origin,'DB_PATH':str(Path(directory)/'synthetic.sqlite3'),'EQUIPMENT_OPS_ENABLED':True,'EQUIPMENT_EXECUTOR':executor})
    # Only this disposable fixture marks its UI as synthetic. Production files,
    # host/origin/CSRF policy and packaged service are not modified.
    from flask import request,make_response,redirect
    @app.after_request
    def mark_fixture(response):
        if layout:
            # Embeddable only for this explicit, synthetic, no-SSH layout preview.
            response.headers.pop('X-Frame-Options',None)
            policy=response.headers.get('Content-Security-Policy','')
            if policy:response.headers['Content-Security-Policy']=policy.replace("frame-ancestors 'none'",'frame-ancestors *')
        if response.status_code==200 and response.mimetype=='text/html' and request.path in {'/app','/FAM.html'}:
            response.direct_passthrough=False
            text=response.get_data(as_text=True)
            if layout:
                banner='<aside style="padding:10px 18px;text-align:center;background:#fff8dc;color:#765b16;font:12px/1.9 sans-serif;position:relative;z-index:100">پیش‌نمایش چیدمان · داده‌ها آزمایشی‌اند · اتصال به تجهیزات غیرفعال است · رمز واقعی وارد نکنید</aside>'
                boot="""<script>document.documentElement.dataset.uiTheme='light';window.addEventListener('load',()=>{const timer=setInterval(()=>{if(typeof Access==='undefined'||!Access.current()||document.querySelector('#shared-block'))return;clearInterval(timer);document.getElementById('workspace-enter-equipment')?.click();const u=document.getElementById('eq-session-username'),p=document.getElementById('eq-session-password');if(u&&p){u.value='demo';p.value='demo';document.getElementById('eq-session-submit').click();}setTimeout(()=>document.getElementById('equipment-tab-ports')?.click(),100);},150);setTimeout(()=>clearInterval(timer),20000);});</script>"""
                before,after=text.rsplit('</body>',1);text=before+boot+'</body>'+after
                import re
                text=re.sub(r'(<body[^>]*>)',lambda m:m[1]+banner,text,count=1)
            response.set_data(text)
        return response
    if layout:
        def layout_entry():
            with app.test_client() as entry_client:
                signed=entry_client.post('/api/login',json={'username':'admin','password':'1109'},headers={'Origin':origin})
                response=make_response(redirect('/app'));response.headers['Cache-Control']='no-store'
                for cookie in signed.headers.getlist('Set-Cookie'):response.headers.add('Set-Cookie',cookie.replace('SameSite=Strict','SameSite=None')+'; Secure; Partitioned')
                return response
        app.view_functions['root']=layout_entry
    client=app.test_client();login=client.post('/api/login',json={'username':'admin','password':'1109'},headers={'Origin':origin}).json
    env=client.get('/api/equipment/state').json
    env['inventory']['nodes']=[{'id':'fixture-'+str(i),'name':'Fixture switch '+str(i),'host':'10.53.0.'+str(i),'typeId':'type-switch','modelId':'model-2960','regionId':'region-1','siteKindId':'kind-building','siteId':'building-0'} for i in (1,2,3)]
    if layout:
        next(r for r in env['inventory']['catalog']['regions'] if r['id']=='region-1')['name']='خراسان'
        next(r for r in env['inventory']['catalog']['regions'] if r['id']=='region-2')['name']='تهران'
        env['inventory']['catalog']['sites'].extend([{'id':'review-mashhad','name':'مشهد','siteKindId':'kind-branch'},{'id':'review-neyshabur','name':'نیشابور','siteKindId':'kind-branch'}])
        env['inventory']['nodes']=[{'id':'review-'+str(i),'name':name,'host':'100.100.'+str(1+i//200)+'.'+str(1+i%200),'typeId':'type-switch','modelId':'model-2960','regionId':region,'siteKindId':'kind-branch','siteId':site} for i,(name,region,site) in enumerate([('تجهیز ۲۳۵ · شعبه مشهد','region-1','review-mashhad'),('تجهیز ۲۳۶ · شعبه نیشابور','region-1','review-neyshabur'),('تجهیز ۲۳۷ · مشهد مرکزی','region-1','review-mashhad'),('تجهیز ۱۰۸ · تهران','region-2','review-mashhad')])]
    import uuid
    response=client.post('/api/equipment/state',json={'revision':env['revision'],'requestId':str(uuid.uuid4()),'kind':'inventory','value':env['inventory']},headers={'Origin':origin,'X-FAM-CSRF':login['csrf']})
    assert response.status_code==200
    serve(app,host='0.0.0.0',port=int(os.environ.get('FAM_EQUIPMENT_FIXTURE_PORT','8765')),threads=8)
