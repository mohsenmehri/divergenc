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
    repaired=set()
    def executor(job):
        if job['operation']=='diagnose':
            from server import equipment_diagnostics as diagnosis
            from server.tests.test_equipment_diagnostics import VERSION,transcript
            return {'ok':True,'report':diagnosis.assess(diagnosis.profile(VERSION),diagnosis.client(job['clientIp'],job['clientMac']),transcript())}
        if job['host']=='10.53.0.3':return {'ok':False,'error':'connection_timeout'}
        if job['operation']=='descriptions':return {'ok':True,'output':'Interface                      Status         Protocol Description\nGi0/1                          up             up       Fixture uplink\nGi0/7                          down           down     <img src=x onerror=alert(1)>\n'}
        if job['operation']=='recover':
            repaired.add((job['host'],job['interface']))
            return {'ok':True,'recovery':'recovered'}
        ports=[{'interface':'Gi0/7','description':'Fixture port'}] if job['host'] in {'10.53.0.1','10.53.0.9'} and (job['host'],'Gi0/7') not in repaired else []
        result={'ok':True,'ports':ports}
        if job['operation']=='inspect':result.update(descriptions=executor({**job,'operation':'descriptions'}),timings={'preparationMs':10,'sshMs':20})
        return result
    origin=os.environ.get('FAM_EQUIPMENT_FIXTURE_ORIGIN','http://localhost:8765')
    app=create_app({'TESTING':True,'COOKIE_SECURE':False,'PUBLIC_ORIGIN':origin,'DB_PATH':str(Path(directory)/'synthetic.sqlite3'),'EQUIPMENT_OPS_ENABLED':True,'EQUIPMENT_EXECUTOR':executor})
    # Only this disposable fixture marks its UI as synthetic. Production files,
    # host/origin/CSRF policy and packaged service are not modified.
    from flask import request
    @app.after_request
    def mark_fixture(response):
        if response.mimetype=='text/html' and request.path in {'/app','/FAM.html'}:
            response.direct_passthrough=False
            response.set_data(response.get_data(as_text=True).replace("central()?'نسخهٔ مرکزی'", "central()?'محیط آزمایشی · نتیجه‌ها ساختگی‌اند'"))
        return response
    client=app.test_client();login=client.post('/api/login',json={'username':'admin','password':'1109'},headers={'Origin':origin}).json
    env=client.get('/api/equipment/state').json
    env['inventory']['nodes']=[{'id':'fixture-'+str(i),'name':'Fixture switch '+str(i),'host':'10.53.0.'+str(i),'typeId':'type-switch','modelId':'model-2960','regionId':'region-1','siteKindId':'kind-building','siteId':'building-0'} for i in (1,2,3)]
    import uuid
    response=client.post('/api/equipment/state',json={'revision':env['revision'],'requestId':str(uuid.uuid4()),'kind':'inventory','value':env['inventory']},headers={'Origin':origin,'X-FAM-CSRF':login['csrf']})
    assert response.status_code==200
    serve(app,host='0.0.0.0',port=8765,threads=8)
