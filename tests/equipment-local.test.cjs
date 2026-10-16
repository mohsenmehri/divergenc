/* Full standalone FAM login and equipment preview, opened as a local file. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
let browser,page;const errors=[],requests=[];
before(async()=>{
  if(!process.env.CHROMIUM_PATH){
    const libs=path.resolve('.cache/chromium-libs');fs.mkdirSync(libs,{recursive:true});
    const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
    execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
    process.env.LD_LIBRARY_PATH=[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>a!=='--disable-web-security'),headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(path.resolve('FAM.html')).href);
  await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');
  await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>Access.current()&&document.documentElement.dataset.famReady==='true');
  if(!await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await page.locator('[data-act="toggle-sidebar"]').click();
  await page.locator('.tab-btn[data-view="equipment"]').click();
});
after(async()=>{await browser?.close();});
const workspace=()=>page.locator('#equipment-workspace');
async function radius(){
  await page.locator('#equipment-radius-user').fill('fake-radius-user-987');
  await page.locator('#equipment-radius-password').fill('fake-radius-secret-987');
  await page.getByRole('button',{name:'ورود به فضای تجهیزات',exact:true}).click();
}
async function openEquipment(){
  if(!await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await page.locator('[data-act="toggle-sidebar"]').click();
  await page.locator('.tab-btn[data-view="equipment"]').click();
}
async function clearFilters(){const b=workspace().getByRole('button',{name:'پاک‌کردن فیلترها',exact:true});if(await b.count())await b.click();}
async function openNodeForm(){await workspace().getByRole('button',{name:'＋ افزودن نود',exact:true}).click();}
async function specify(){
  await page.locator('#eq-node-type').selectOption('type-router');await page.locator('#eq-node-model').selectOption('model-1841');await page.locator('#eq-node-region').selectOption('region-1');await page.locator('#eq-node-site-kind').selectOption('kind-building');await page.locator('#eq-node-site').selectOption('building-0');
}
const table=()=>workspace().locator('.eq-table');
async function viewFacet(name){await workspace().getByRole('navigation',{name:'روش دسته‌بندی'}).getByRole('button',{name,exact:true}).click();}
async function chooseGroup(name){await workspace().locator('.eq-smart-groups .eq-card-main').filter({has:page.locator('strong',{hasText:new RegExp('^'+name+'$')})}).click();}
async function nodeSubmit(){await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره نود',exact:true}).click();}
test('RADIUS gate precedes six independent classification axes',async()=>{
  assert.ok(await page.locator('#equipment-radius-password').isVisible());await radius();
  assert.equal(await workspace().locator('.eq-smart-cards .eq-card-main').count(),6);
  assert.match(await workspace().innerText(),/یک نود؛ چند دسته/);
});
test('node form asks all metadata; saves a single canonical node with automatic memberships',async()=>{
  await openNodeForm();
  for(const id of ['eq-node-type','eq-node-model','eq-node-region','eq-node-site-kind','eq-node-site'])assert.ok(await page.locator('#'+id).isVisible());
  await page.locator('#eq-edit-name').fill('روتر رضوان');await page.locator('#eq-edit-host').fill('8.8.8.8');await specify();await nodeSubmit();
  assert.match(await page.locator('.eq-dialog').innerText(),/فقط IPv4 خصوصی/);
  await page.locator('#eq-edit-host').fill('10.2.35.2');await nodeSubmit();
  assert.equal(await page.locator('.eq-dialog').count(),0);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')));assert.equal(data.nodes.length,1);
  const node=data.nodes[0];assert.equal(node.typeId,'type-router');assert.equal(node.modelId,'model-1841');assert.equal(node.regionId,'region-1');assert.equal(node.siteId,'building-0');
  assert.match(await table().innerText(),/روتر رضوان/);assert.match(await table().innerText(),/ساختمان مرکزی رضوان/);
});
test('type/model/region/location filters intersect and all facets see the same node',async()=>{
  await page.locator('#eq-filter-typeId').selectOption('type-router');await page.locator('#eq-filter-modelId').selectOption('model-1841');await page.locator('#eq-filter-regionId').selectOption('region-2');
  assert.equal(await table().locator('.eq-node-link').count(),0);
  await page.locator('#eq-filter-regionId').selectOption('region-1');assert.equal(await table().locator('.eq-node-link').count(),1);
  for(const [facet,group]of [['نوع تجهیز','روتر'],['مدل تجهیز','1841'],['منطقه','منطقه 1'],['ساختمان‌ها','ساختمان مرکزی رضوان']]){
    await clearFilters();await viewFacet(facet);await chooseGroup(group);assert.match(await table().innerText(),/روتر رضوان/);
  }
  await page.screenshot({path:'/tmp/fam-smart-groups.png',fullPage:true});
});
test('add from a category preselects its metadata; branch/model can be defined inline',async()=>{
  await clearFilters();await viewFacet('دیتا سنتر');
  const card=workspace().locator('.eq-smart-groups .eq-card').filter({has:page.locator('strong',{hasText:'سمنان'})});await card.getByRole('button',{name:'＋ نود در این دسته',exact:true}).click();
  assert.equal(await page.locator('#eq-node-site-kind').inputValue(),'kind-datacenter');assert.equal(await page.locator('#eq-node-site').inputValue(),'datacenter-1');
  await page.locator('#eq-edit-name').fill('روتر سمنان');await page.locator('#eq-edit-host').fill('10.0.0.2');await page.locator('#eq-node-type').selectOption('type-router');await page.locator('#eq-node-model').selectOption('model-1300');await page.locator('#eq-node-region').selectOption('region-2');await nodeSubmit();
  assert.match(await table().innerText(),/روتر سمنان/);
  await clearFilters();await openNodeForm();await page.locator('#eq-edit-name').fill('سوئیچ شعبه تست');await page.locator('#eq-edit-host').fill('192.168.1.10');
  await page.locator('#eq-node-type').selectOption('type-switch');await page.locator('#eq-node-model').selectOption('__new__');await page.locator('#eq-node-new-model').fill('مدل آزمایشی جدید');
  await page.locator('#eq-node-region').selectOption('region-4');await page.locator('#eq-node-site-kind').selectOption('kind-branch');await page.locator('#eq-node-site').selectOption('__new__');await page.locator('#eq-node-new-site').fill('شعبه آزمایشی');await nodeSubmit();
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')));assert.equal(data.nodes.length,3);assert.ok(data.catalog.sites.some(s=>s.name==='شعبه آزمایشی'));assert.ok(data.catalog.models.some(m=>m.name==='مدل آزمایشی جدید'));
});
test('catalog CRUD is user managed and in-use category deletion is blocked',async()=>{
  await workspace().getByRole('button',{name:'مدیریت دسته‌ها',exact:true}).click();
  await page.locator('#eq-catalog-dimension').selectOption('regions');await page.locator('#eq-catalog-name').fill('منطقه آزمایشی');await page.locator('.eq-dialog').getByRole('button',{name:'افزودن دسته',exact:true}).click();
  const row=page.locator('.eq-catalog-row').filter({has:page.locator('strong',{hasText:'منطقه آزمایشی'})});await row.getByRole('button',{name:'ویرایش منطقه آزمایشی',exact:true}).click();
  await page.locator('#eq-catalog-name').fill('منطقه جدید');await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره تغییرات',exact:true}).click();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'حذف منطقه جدید',exact:true}).click();assert.equal(await page.getByRole('button',{name:'حذف منطقه جدید',exact:true}).count(),0);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'حذف منطقه 1',exact:true}).click();assert.match(await page.locator('.eq-dialog').innerText(),/در نودها استفاده شده/);
  await page.locator('.eq-dialog').getByRole('button',{name:'بستن',exact:true}).click();
});
test('removing membership keeps node for completion; editing moves it to new groups',async()=>{
  await clearFilters();await page.locator('#eq-filter-regionId').selectOption('region-1');
  const row=table().getByRole('row').filter({hasText:'روتر رضوان'});page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'حذف از دسته',exact:true}).click();
  assert.equal(await table().locator('.eq-node-link').count(),0);
  await workspace().getByRole('button',{name:/^نیازمند تکمیل/}).click();assert.match(await table().innerText(),/روتر رضوان/);
  await table().getByRole('button',{name:'ویرایش',exact:true}).click();await page.locator('#eq-node-region').selectOption('region-3');await nodeSubmit();
  await clearFilters();await page.locator('#eq-filter-regionId').selectOption('region-3');assert.match(await table().innerText(),/روتر رضوان/);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')));assert.equal(data.nodes.length,3);
});
test('global node deletion requires confirmation and removes only the selected canonical node',async()=>{
  await clearFilters();const row=table().getByRole('row').filter({hasText:'روتر سمنان'});
  page.once('dialog',d=>d.dismiss());await row.getByRole('button',{name:'حذف نود',exact:true}).click();
  assert.equal(await table().locator('.eq-node-link').count(),3);
  page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'حذف نود',exact:true}).click();
  assert.equal(await table().locator('.eq-node-link').count(),2);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')));
  assert.equal(data.nodes.length,2);assert.ok(!data.nodes.some(n=>n.name==='روتر سمنان'));
  await viewFacet('دیتا سنتر');const card=workspace().locator('.eq-smart-groups .eq-card').filter({has:page.locator('strong',{hasText:'سمنان'})});assert.match(await card.innerText(),/0 نود/);
  await page.locator('#eq-filter-regionId').selectOption('region-3');
});
test('clicking a node still auto-checks; RADIUS survives dashboard but main logout resets it',async()=>{
  await table().getByRole('button',{name:'روتر رضوان',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#equipment-check-submit').disabled);assert.match(await page.locator('#equipment-status').innerText(),/وضعیت پاک/);
  await page.getByRole('button',{name:'← داشبورد FAM',exact:true}).click();await openEquipment();assert.equal(await page.locator('#equipment-radius-password').count(),0);
  const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));for(const secret of ['fake-radius-user-987','fake-radius-secret-987'])assert.ok(!storage.includes(secret));
  await page.locator('#stat-line').click();await page.locator('#account-logout').click();await page.locator('#auth-username').waitFor();await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();assert.ok(await page.locator('#equipment-radius-password').isVisible());await radius();
});
test('v2 inventory is migrated without rewriting original; incomplete metadata is explicit',async()=>{
  const old={version:2,types:[{id:'old-type',name:'روتر',kind:'router',categories:[{id:'old-cat',name:'ساختمان‌ها',nodes:[],sections:[{id:'old-section',name:'ساختمان مرکزی رضوان',nodes:[{id:'old-node',name:'روتر قدیمی',host:'10.0.0.55'}]}]}]}]};
  await page.evaluate(value=>{localStorage.removeItem('fam.equipment.inventory.v3');localStorage.setItem('fam.equipment.inventory.v2',JSON.stringify(value));},old);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.match(await workspace().innerText(),/بدون حذف منتقل شد/);assert.match(await table().innerText(),/روتر قدیمی/);assert.match(await table().innerText(),/نیازمند تکمیل/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v2')),JSON.stringify(old));
  const next=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')));assert.equal(next.nodes[0].id,'old-node');assert.equal(next.nodes[0].regionId,null);
  await page.setViewportSize({width:390,height:844});for(const theme of ['original','light']){await page.evaluate(t=>FamTheme.set(t),theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('malformed v3 is visibly read-only and never overwritten or replaced with stale v2',async()=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>localStorage.setItem('fam.equipment.inventory.v3','{invalid-json'));
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.match(await workspace().innerText(),/تغییرات غیرفعال است/);
  await openNodeForm();assert.equal(await page.locator('.eq-dialog').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),'{invalid-json');
  assert.ok(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v2')));
});
test('failed migration write keeps legacy data and exposes a read-only preview without network',async()=>{
  await page.evaluate(()=>localStorage.removeItem('fam.equipment.inventory.v3'));
  const old=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v2'));
  await page.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='fam.equipment.inventory.v3')throw new DOMException('Test quota','QuotaExceededError');return set.call(this,key,value);};});
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.match(await workspace().innerText(),/تغییرات غیرفعال است/);assert.match(await table().innerText(),/روتر قدیمی/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v2')),old);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
