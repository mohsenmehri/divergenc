const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({console,Buffer,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto,structuredClone});
const lib=[...fs.readFileSync('FAM.html','utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(x=>x[1].includes('function make_xlsx_lib'))[1];vm.runInContext(lib,c);
for(const file of ['equipment-inventory','equipment-tools-model','equipment-excel'])vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),c);
const M=c.FamEquipmentInventory,T=c.FamEquipmentToolsModel,E=c.FamEquipmentExcel,X=c.XLSX,plain=v=>JSON.parse(JSON.stringify(v));
const read=bytes=>X.read(bytes,{type:'array'}),rows=(book,sheet)=>X.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:'',raw:true});
function latest(){const d=M.defaults();d.catalog.types[0].name='Router NEW';d.catalog.models[0].name='Model NEW';d.catalog.regions=d.catalog.regions.filter(x=>x.id!=='region-4');d.catalog.regions.push({id:'region-new',name:'منطقه تازه'});d.catalog.sites=d.catalog.sites.filter(x=>x.id!=='building-1');d.catalog.sites.push({id:'site-new',name:'ساختمان تازه',siteKindId:'kind-building'});return d;}
test('dynamic XLSX contains current category names, additions/deletions, dependent dropdowns and hidden metadata',()=>{
 const d=latest(),bytes=E.encode(d,{generatedAt:'2026-10-16T00:00:00Z'}),book=read(bytes);const text=JSON.stringify(rows(book,'دسته‌ها'));
 for(const value of ['Router NEW','Model NEW','منطقه تازه','ساختمان تازه'])assert.ok(text.includes(value));for(const value of ['منطقه 4','ساختمان 68 شرقی فام'])assert.ok(!text.includes(value));
 assert.deepEqual(plain(E.read(bytes).rows[0]),plain(T.columns));assert.doesNotThrow(()=>T.assertCatalogSnapshot(d,E.read(bytes).snapshot));
 const zip=X.CFB.read(bytes,{type:'array'}),xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);assert.match(xml,/<dataValidations count="7">/);assert.match(xml,/INDIRECT\(IFERROR\(VLOOKUP/);assert.match(xml,/sqref="E2:E4001"/);assert.match(xml,/sqref="I2:I4001"/);
 assert.ok(book.Workbook.Names.some(n=>n.Name==='FamModel_0'));assert.ok(book.Workbook.Sheets.filter(x=>x.Hidden===1).length>=2);
});
test('each generated file takes a fresh catalog snapshot; stale forms reject rename/add/remove even with auto-create',()=>{
 const d=M.defaults(),old=E.encode(d);d.catalog.regions[0].name='Renamed';assert.throws(()=>T.assertCatalogSnapshot(d,E.read(old).snapshot),/تغییر کرده/);assert.doesNotThrow(()=>T.assertCatalogSnapshot(d,E.read(E.encode(d)).snapshot));
 d.catalog.regions.push({id:'new-r',name:'New'});assert.throws(()=>T.assertCatalogSnapshot(d,E.read(old).snapshot));assert.throws(()=>T.assertCatalogSnapshot(d,undefined),/فرم پویای/);
});
test('editing nodes alone does not make a catalog template stale; inventory export is re-importable with stable IDs',()=>{
 const d=M.defaults(),bytes=E.encode(d);d.nodes.push({id:'node-example',name:'=literal text',host:'10.20.0.1',typeId:'type-router',modelId:'model-1841',regionId:'region-1',siteKindId:'kind-building',siteId:'building-0'});
 assert.doesNotThrow(()=>T.assertCatalogSnapshot(d,E.read(bytes).snapshot));const out=E.read(E.encode(d,{includeNodes:true}));T.assertCatalogSnapshot(d,out.snapshot);const p=T.prepareImport(d,out.rows,{update:true});assert.equal(p.errors.length,0);assert.equal(p.next.nodes[0].id,'node-example');assert.equal(read(E.encode(d,{includeNodes:true})).Sheets['تجهیزات'].A2.f,undefined);
});
test('deleted defaults never leak back through examples; empty catalogs produce an empty template rather than guessed values',()=>{
 const d=M.defaults();for(const key of Object.keys(d.catalog))d.catalog[key]=[];const book=read(E.encode(d));assert.equal(rows(book,'دسته‌ها').length,1);assert.equal(rows(book,'مثال').length,1);assert.equal(rows(book,'تجهیزات').length,1);
});
test('formula-bearing import cells are rejected; missing snapshot is distinguishable from corrupt Excel',()=>{
 const d=M.defaults(),{book}=E.build(d);X.utils.sheet_add_aoa(book.Sheets['تجهیزات'],[['demo',2]],{origin:'A2'});book.Sheets['تجهیزات'].B2.f='1+1';assert.throws(()=>E.read(new Uint8Array(X.write(book,{type:'array',bookType:'xlsx'}))),/فایل قابل ورود نیست/);
});
