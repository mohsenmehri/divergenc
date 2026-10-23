const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({crypto:require('node:crypto').webcrypto,structuredClone});
for(const file of ['equipment-inventory','equipment-configuration'])vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),context);
const M=context.FamEquipmentInventory,C=context.FamEquipmentConfiguration;
const node=(id,extra={})=>({id:'node-'+id,name:'node '+id,host:'10.0.0.'+id,typeId:'type-router',modelId:'model-1841',regionId:'region-1',siteKindId:'kind-building',siteId:'building-0',...extra});
function inventory(){const data=M.defaults();data.nodes=[node(1,{regionId:'region-2'}),node(2),node(3,{typeId:'type-switch',modelId:'model-2960'}),node(4,{modelId:'model-1300',regionId:'region-4'})];return M.validate(data);}
const plain=value=>JSON.parse(JSON.stringify(value));
test('configuration targets AND within a group, OR across groups, never duplicate shared nodes',()=>{
 const plan=C.buildPlan(inventory(),[{typeId:'type-router',regionId:'region-2'},{modelId:'model-1841'},{typeId:'type-switch',modelId:'model-2960'}]);
 assert.deepEqual(plain(plan.targets.map(n=>n.id)),['node-1','node-2','node-3']);assert.equal(plan.matchedCount,3);assert.equal(plan.incompleteCount,0);
 assert.deepEqual(plain(C.buildPlan(inventory(),[{typeId:'type-router',regionId:'region-4'}]).targets.map(n=>n.id)),['node-4']);
});
test('empty, excessive and unknown conditions fail closed instead of selecting the whole fleet',()=>{
 for(const rules of [[],[{}],[{typeId:'type-router'},{}],Array.from({length:13},()=>({regionId:'region-1'})),[{anything:'all'}],[[]],[{regionId:'missing'}],[{regionId:42}],JSON.parse('[{"__proto__":"x"}]')])assert.throws(()=>C.buildPlan(inventory(),rules));
});
test('mismatched parent references and removed categories cannot silently broaden scope',()=>{
 assert.throws(()=>C.buildPlan(inventory(),[{typeId:'type-router',modelId:'model-2960'}]),/سازگار/);
 assert.throws(()=>C.buildPlan(inventory(),[{siteKindId:'kind-datacenter',siteId:'building-0'}]),/سازگار/);
 assert.throws(()=>C.buildPlan(inventory(),[{modelId:'deleted-model'}]),/در دسترس/);
});
test('all five attributes can target categories; only complete nodes are eligible',()=>{
 const data=inventory();data.nodes.push(node(5,{modelId:null,regionId:'region-2'}));
 const plan=C.buildPlan(data,[{typeId:'type-router',regionId:'region-2'}]);assert.equal(plan.targets.length,1);assert.equal(plan.incompleteCount,1);assert.equal(plan.matchedCount,2);
 assert.equal(C.buildPlan(data,[{siteKindId:'kind-building',siteId:'building-0'}]).targets.length,4);
});
test('ambiguous duplicate IP blocks a plan even when the conflicting node is outside the filters',()=>{
 const data=inventory();data.nodes.push(node(5,{host:'10.0.0.1',typeId:'type-switch',modelId:'model-2960',regionId:'region-4'}));
 assert.throws(()=>C.buildPlan(data,[{typeId:'type-router',regionId:'region-2'}]),/IP تکراری/);
});
test('plans are pure snapshots and signature changes when catalog/node metadata changes',()=>{
 const data=inventory(),before=JSON.stringify(data),plan=C.buildPlan(data,[{regionId:'region-2'}]);
 plan.targets[0].name='changed snapshot';assert.equal(JSON.stringify(data),before);
 data.catalog.regions[1].name='new label';assert.notEqual(C.buildPlan(data,[{regionId:'region-2'}]).signature,plan.signature);
 data.nodes[0].regionId='region-3';assert.equal(C.buildPlan(data,[{regionId:'region-2'}]).targets.length,0);
});
test('command text validation bounds length/lines and rejects terminal controls without returning text',()=>{
 const text='interface GigabitEthernet0/1\r\n description DEMO-ONLY\r\n';
 assert.deepEqual(plain(C.validateDraft(text)),{lineCount:2,charCount:text.length});
 for(const text of ['', ' \n\t','a'.repeat(12001),'a'.repeat(513),Array(121).fill('x').join('\n'),'show\u001b[31m','a\u0000b','a\u202eb'])assert.throws(()=>C.validateDraft(text));
 assert.ok(!JSON.stringify(C.validateDraft('description FAKE-PRIVATE-DRAFT')).includes('FAKE-PRIVATE-DRAFT'));
});
test('planner has no network, storage, logging, shell or JavaScript command execution adapter',()=>{
 const source=fs.readFileSync('src/equipment-configuration.js','utf8');
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|eval|Function)\s*\(|\b(?:localStorage|sessionStorage|indexedDB|console)\s*\./);
 assert.match(source,/Intentionally no executor/);
});
