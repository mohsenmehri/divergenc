const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({crypto:require('node:crypto').webcrypto,structuredClone});
vm.runInContext(fs.readFileSync('src/equipment-inventory.js','utf8'),context);
const M=context.FamEquipmentInventory;
const plain=v=>JSON.parse(JSON.stringify(v));
function node(extra={}){return {id:'node-1',name:'روتر شعبه تست',host:'10.2.35.2',typeId:'type-router',modelId:'model-1841',regionId:'region-1',siteKindId:'kind-building',siteId:'building-0',...extra};}
function old(){return {version:2,types:[{id:'old-type',name:'روتر',kind:'router',categories:[{id:'old-category',name:'ساختمان‌ها',nodes:[],sections:[{id:'old-section',name:'ساختمان مرکزی رضوان',nodes:[{id:'old-node',name:'old-router',host:'10.0.0.1'}]}]}]}]};}
test('catalog defaults contain requested types/models, four regions, six buildings and two datacenters',()=>{
 const data=M.validate(M.defaults());assert.equal(data.catalog.types.length,2);assert.equal(data.catalog.regions.length,4);assert.equal(data.catalog.sites.filter(s=>s.siteKindId==='kind-building').length,6);assert.equal(data.catalog.sites.filter(s=>s.siteKindId==='kind-datacenter').length,2);
 assert.deepEqual(plain(data.catalog.models.map(m=>m.name)),['1841','1300','2960']);
});
test('one node belongs to every relevant facet without copies; filters combine with AND',()=>{
 const data=M.upsertNode(M.defaults(),node());assert.equal(data.nodes.length,1);
 for(const field of M.fields)assert.equal(M.matches(data.nodes[0],{[field]:node()[field]}),true);
 assert.equal(M.matches(data.nodes[0],{typeId:'type-router',modelId:'model-1841',regionId:'region-1',siteId:'building-0'}),true);
 assert.equal(M.matches(data.nodes[0],{typeId:'type-router',regionId:'region-2'}),false);
});
test('all classification fields required on new/edited node and parent relationships validated',()=>{
 for(const field of M.fields)assert.throws(()=>M.upsertNode(M.defaults(),node({[field]:null})),/مشخص کنید/);
 assert.throws(()=>M.upsertNode(M.defaults(),node({modelId:'model-2960'})),/مدل/);
 assert.throws(()=>M.upsertNode(M.defaults(),node({siteKindId:'kind-datacenter'})),/محل/);
 assert.throws(()=>M.upsertNode(M.defaults(),node({regionId:'missing'})),/ارجاع/);
});
test('RFC1918 validation and duplicate-IP rejection apply across all types',()=>{
 for(const host of ['8.8.8.8','127.0.0.1','169.254.1.1','172.32.0.1','10.01.2.3','10.0.0.999','::1'])assert.equal(M.privateIP(host),false);
 let data=M.upsertNode(M.defaults(),node());assert.throws(()=>M.upsertNode(data,node({id:'node-2',typeId:'type-switch',modelId:'model-2960'})),/IP/);
});
test('editing specifications reclassifies the same ID without duplication',()=>{
 let data=M.upsertNode(M.defaults(),node());data=M.upsertNode(data,node({modelId:'model-1300',regionId:'region-3',siteKindId:'kind-datacenter',siteId:'datacenter-1'}));
 assert.equal(data.nodes.length,1);assert.equal(M.matches(data.nodes[0],{regionId:'region-1'}),false);assert.equal(M.matches(data.nodes[0],{siteId:'datacenter-1',regionId:'region-3'}),true);
});
test('catalog renames are reflected through stable IDs; in-use deletion is blocked',()=>{
 let data=M.upsertNode(M.defaults(),node());data.catalog.regions[0].name='منطقه تست';data=M.validate(data);assert.equal(data.nodes[0].regionId,data.catalog.regions[0].id);
 assert.throws(()=>M.removeCategory(data,'regions','region-1'),/استفاده/);assert.throws(()=>M.removeCategory(data,'types','type-switch'),/مدل/);
 assert.equal(M.removeCategory(data,'regions','region-4').catalog.regions.length,3);
});
test('remove from one category retains node and other assignments; removing type clears dependent model',()=>{
 let data=M.upsertNode(M.defaults(),node());data=M.unassign(data,'node-1','regionId');assert.equal(data.nodes.length,1);assert.equal(data.nodes[0].regionId,null);assert.equal(data.nodes[0].siteId,'building-0');assert.equal(M.incomplete(data.nodes[0]),true);
 data=M.unassign(data,'node-1','typeId');assert.equal(data.nodes[0].modelId,null);assert.equal(data.nodes[0].siteId,'building-0');
});
test('v2 migration preserves node ID/name/IP/location and old object; no guessed model/region',()=>{
 const value=old(),snapshot=JSON.stringify(value),data=M.migrateV2(value);assert.equal(JSON.stringify(value),snapshot);assert.equal(data.nodes.length,1);const n=data.nodes[0];assert.equal(n.id,'old-node');assert.equal(n.host,'10.0.0.1');assert.equal(n.name,'old-router');assert.equal(n.siteId,'building-0');assert.equal(n.regionId,null);assert.equal(n.modelId,null);assert.equal(M.incomplete(n),true);assert.match(n.legacyPath,/ساختمان/);
});
test('v2 duplicate IP nodes are preserved, not silently merged or deleted',()=>{
 const value=old();value.types[0].categories[0].sections[0].nodes.push({id:'another-node',name:'legacy-duplicate',host:'10.0.0.1'});
 const data=M.migrateV2(value);assert.equal(data.nodes.length,2);assert.ok(data.nodes.every(M.incomplete));
});
test('malformed inventory, unknown references, duplicate names and control characters are rejected',()=>{
 const data=M.defaults();data.catalog.models[0].typeId='missing';assert.throws(()=>M.validate(data));
 const duplicate=M.defaults();duplicate.catalog.regions.push({...duplicate.catalog.regions[0],id:'duplicate-region'});assert.throws(()=>M.validate(duplicate),/تکراری/);
 assert.throws(()=>M.migrateV2({version:2,types:'bad'}));assert.equal(M.validName('bad\nname'),false);
});
test('shortcut defaults and validation are independent from the canonical inventory',()=>{
 const inventory=M.upsertNode(M.defaults(),node()),before=JSON.stringify(inventory);
 const prefs=M.validateCards(M.defaultCards());assert.equal(prefs.cards.length,6);
 prefs.cards[0].name='تجهیزات شبکه';prefs.cards.push({id:'custom-region',name:'منطقه من',facet:'regions',refId:'region-1'});prefs.cards.splice(1,1);
 assert.equal(M.validateCards(prefs).cards.length,6);assert.equal(JSON.stringify(inventory),before);
 assert.equal(M.validateCards({version:1,cards:[]}).cards.length,0);
});
test('shortcut validation rejects malformed/oversized preferences and strips unrelated fields',()=>{
 const data=M.defaultCards();data.cards[0].password='fake-only';data.username='fake-only';
 assert.ok(!JSON.stringify(M.validateCards(data)).includes('fake-only'));
 for(const change of [{facet:['types']},{facet:'__proto__'},{facet:'anything'},{id:'bad id'},{name:'bad\nname'},{refId:'bad ref'}]){
  const bad=M.defaultCards();Object.assign(bad.cards[0],change);assert.throws(()=>M.validateCards(bad));
 }
 const duplicate=M.defaultCards();duplicate.cards.push({...duplicate.cards[0]});assert.throws(()=>M.validateCards(duplicate));
 assert.throws(()=>M.validateCards({version:1,cards:Array.from({length:61},(_,i)=>({id:'v-'+i,name:'x',facet:'regions',refId:null}))}));
});
test('stale shortcut references are retained for repair, not silently discarded',()=>{
 const data=M.defaultCards();data.cards[0].refId='deleted-category';const clean=M.validateCards(data);
 assert.equal(clean.cards[0].refId,'deleted-category');
});
test('building/shared 100.64/10 is accepted without allowing all 100/8, public, malformed or IPv6 targets',()=>{
 for(const host of ['100.100.1.22','100.108.1.22','100.107.1.22','100.64.0.0','100.127.255.255','10.2.35.2','172.16.1.1','192.168.1.1']){assert.equal(M.privateIP(host),true,host);assert.equal(M.upsertNode(M.defaults(),node({host})).nodes[0].host,host);}
 for(const host of ['100.63.255.255','100.128.0.0','100.1.1.22','8.8.8.8','127.0.0.1','169.254.1.1','224.0.0.1','100.100.1.256','100.100.1','100.100.01.22','100.100.1.22:22','::1','::ffff:100.100.1.22','example.test']){assert.equal(M.privateIP(host),false,host);assert.throws(()=>M.upsertNode(M.defaults(),node({host})),undefined,host);}
});
