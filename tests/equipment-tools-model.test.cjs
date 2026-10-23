const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({crypto:require('node:crypto').webcrypto,structuredClone});for(const file of ['equipment-inventory','equipment-tools-model'])vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),context);
const M=context.FamEquipmentInventory,T=context.FamEquipmentToolsModel,plain=v=>JSON.parse(JSON.stringify(v));
const row=(extra=[])=>{const r=['Router demo','10.2.0.1','روتر','router','1841','منطقه 2','ساختمان اداره','building','ساختمان مرکزی رضوان',''];for(const [i,v]of extra)r[i]=v;return r;};
const rows=(...r)=>[plain(T.columns),...r];
const node=(id,extra={})=>({id,name:id,host:'10.2.0.1',typeId:'type-router',modelId:'model-1841',regionId:'region-2',siteKindId:'kind-building',siteId:'building-0',...extra});
function inventory(){const d=M.defaults();d.nodes=[node('router'),node('switch',{host:'10.2.0.2',typeId:'type-switch',modelId:'model-2960'})];return d;}
function standards(){return {version:1,items:[{id:'standard',name:'Clock checklist',modelId:'model-1841',siteKindId:'kind-building',siteId:'building-0',checks:[{id:'c-1',name:'NTP line',operator:'exact-line',pattern:'ntp server 10.0.0.8'},{id:'c-2',name:'No HTTP',operator:'not-contains',pattern:'ip http server'}]}]};}
test('Excel import creates canonical memberships and preserves the original inventory before explicit commit',()=>{
 const d=M.defaults(),before=JSON.stringify(d),p=T.prepareImport(d,rows(row()));assert.equal(p.errors.length,0);assert.equal(p.counts.added,1);assert.equal(p.next.nodes[0].regionId,'region-2');assert.equal(p.next.nodes[0].siteId,'building-0');assert.equal(JSON.stringify(d),before);
});
test('unknown categories cannot be created by Excel, even with the retired opt-in flag',()=>{
 const r=row([[4,'new model'],[8,'new building']]);assert.equal(T.prepareImport(M.defaults(),rows(r)).next,null);
 const d=M.defaults(),before=JSON.stringify(d),p=T.prepareImport(d,rows(r),{createCategories:true});assert.equal(p.next,null);assert.ok(p.errors.length);assert.equal(p.counts.categories,0);assert.equal(JSON.stringify(d),before);
});
test('updates require explicit mode and preserve IDs; identifier/IP conflicts fail closed',()=>{
 const d=inventory(),r=row([[0,'new name']]);assert.equal(T.prepareImport(d,rows(r)).next,null);
 const p=T.prepareImport(d,rows(r),{update:true});assert.equal(p.next.nodes[0].id,'router');assert.equal(p.next.nodes[0].name,'new name');assert.equal(p.counts.updated,1);
 assert.equal(T.prepareImport(d,rows(row([[9,'switch']])),{update:true}).next,null);
 const duplicateTarget=rows(row([[1,'10.2.0.9'],[9,'router']]),row());assert.equal(T.prepareImport(d,duplicateTarget,{update:true}).next,null);
});
test('invalid rows, duplicate file IPs and invalid type kinds reject the whole batch, never partial changes',()=>{
 for(const bad of [row([[1,'8.8.8.8']]),row([[3,'unknown']]),row([[7,'datacenter']]),row([[0,'bad\nname']])])assert.equal(T.prepareImport(M.defaults(),rows(row(),bad),{createCategories:true}).next,null);
 assert.equal(T.prepareImport(M.defaults(),rows(row(),row())).next,null);assert.throws(()=>T.prepareImport(M.defaults(),[['wrong'],row()]));
});
test('metadata Excel round-trips with IDs, literal strings, and no lost node memberships',()=>{
 const d=inventory();d.nodes[0].name='=literal text';const out=T.inventoryRows(d);assert.equal(out[1][0],'=literal text');const p=T.prepareImport(d,out,{update:true});assert.equal(p.errors.length,0);assert.deepEqual(plain(p.next),plain(M.validate(d)));
});
test('standards apply by model and kind/site; absent standards are not a passing audit',()=>{
 const d=inventory(),s=standards();assert.equal(T.applicable(d.nodes[0],s).length,1);assert.equal(T.applicable(d.nodes[1],s).length,0);
 d.nodes[0].siteKindId='kind-datacenter';d.nodes[0].siteId='datacenter-0';assert.equal(T.audit(d,s,'router','ntp server 10.0.0.8').rows.length,0);
});
test('checklist returns deterministic pass/fail/unknown without exposing observed configuration in report',()=>{
 const d=inventory(),s=standards(),r=T.audit(d,s,'router','ntp server 10.0.0.8\nip http server\n! OBSERVED-PRIVATE-DEMO');assert.deepEqual(plain(r.rows.map(x=>x.status)),['ok','fail']);assert.ok(!JSON.stringify(r).includes('OBSERVED-PRIVATE-DEMO'));
 assert.ok(T.audit(d,s,'router','').rows.every(x=>x.status==='unknown'));assert.throws(()=>T.audit(d,s,'missing','x'));
});
test('persistable standards reject sensitive patterns, controls and malformed definitions; harmless encryption policy is allowed',()=>{
 const s=standards();s.items[0].checks[0].pattern='username demo secret 0 DO-NOT-SAVE';assert.throws(()=>T.validateStandards(s),/حساس/);
 s.items[0].checks[0].pattern='service password-encryption';assert.equal(T.validateStandards(s).items.length,1);
 s.items[0].checks[0].pattern='bad\nline';assert.throws(()=>T.validateStandards(s));s.items[0].checks=[];assert.throws(()=>T.validateStandards(s));
});
test('switch-only targeting follows stable type kind, not displayed name; routers cannot enter a switch job',()=>{
 const d=inventory();d.catalog.types[1].name='Access devices';d.nodes[0].name='سوئیچ fake router';assert.deepEqual(plain(T.switches(d).map(n=>n.id)),['switch']);assert.throws(()=>T.simulateErr(d,['router'],{}),/فقط سوئیچ/);
});
test('Err-disabled requires explicit demo scenarios; auth, timeout and missing scenario are unknown, never clean',()=>{
 const d=inventory();for(const scenario of ['unknown','auth','timeout','connection'])assert.equal(T.simulateErr(d,['switch'],{switch:scenario})[0].status,'unknown');assert.equal(T.simulateErr(d,['switch'],{})[0].status,'unknown');
 assert.equal(T.simulateErr(d,['switch'],{switch:'errdisabled'})[0].status,'error');assert.equal(T.simulateErr(d,['switch'],{switch:'clean'})[0].status,'ok');assert.throws(()=>T.simulateErr(d,['switch','switch'],{}));
 d.nodes.push(node('duplicate',{host:'10.2.0.2'}));assert.throws(()=>T.simulateErr(d,['switch'],{}),/تکراری/);
});

test('port recovery plans bind each explicit err-disabled port to its scanned switch; unknown/clean/router/forged ports are refused',()=>{
 const d=inventory(),r=T.simulateErr(d,['switch'],{switch:'errdisabled'}),before=JSON.stringify(d);assert.deepEqual(plain(r[0].ports),['Gi0/1','Gi0/2']);const p=T.errRecoveryPlan(d,r,['switch:Gi0/2']);assert.equal(p.targets.length,1);assert.equal(p.targets[0].host,'10.2.0.2');assert.equal(p.targets[0].nodeId,'switch');assert.equal(JSON.stringify(d),before);
 for(const keys of [[],['switch:Gi0/9'],['router:Gi0/1'],['switch:Gi0/1','switch:Gi0/1']])assert.throws(()=>T.errRecoveryPlan(d,r,keys));
 for(const scenario of ['unknown','clean','auth','timeout','connection'])assert.throws(()=>T.errRecoveryPlan(d,T.simulateErr(d,['switch'],{switch:scenario}),['switch:Gi0/1']));
 const stale=structuredClone(d);stale.nodes[1].host='10.2.0.99';assert.throws(()=>T.errRecoveryPlan(stale,r,['switch:Gi0/1']));const forged=structuredClone(r);forged[0].ports.push('Gi0/9');assert.throws(()=>T.errRecoveryPlan(d,forged,['switch:Gi0/9']));
});

test('same port names on different switches never alias in recovery targets',()=>{
 const d=inventory();d.nodes.push(node('switch-b',{host:'10.2.0.3',typeId:'type-switch',modelId:'model-2960'}));const results=T.simulateErr(d,['switch','switch-b'],{switch:'errdisabled','switch-b':'errdisabled'});const p=T.errRecoveryPlan(d,results,['switch-b:Gi0/1']);assert.equal(p.targets.length,1);assert.equal(p.targets[0].name,'switch-b');assert.equal(p.targets[0].host,'10.2.0.3');
});
