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
  await page.locator('#workspace-launcher[open]').waitFor();
});
after(async()=>{await browser?.close();});
const workspace=()=>page.locator('#equipment-workspace');
async function radius(){
  await page.locator('#equipment-radius-user').fill('fake-radius-user-987');
  await page.locator('#equipment-radius-password').fill('fake-radius-secret-987');
  await page.getByRole('button',{name:'ورود به فضای تجهیزات',exact:true}).click();
}
async function openEquipment(){
  if(await page.locator('#workspace-launcher[open]').count()){await page.locator('#workspace-enter-equipment').click();return;}
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
test('login opens an animated two-workspace chooser; each choice routes to the existing section',async()=>{
  assert.ok(await page.locator('#workspace-launcher').isVisible());
  assert.equal(await page.locator('.workspace-option').count(),2);
  await page.keyboard.press('Escape');assert.ok(await page.locator('#workspace-launcher').isVisible());
  await page.locator('#workspace-logout').focus();await page.locator('#workspace-enter-equipment').hover();
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#workspace-enter-equipment')).transform.split('(')[1].split(',')[0])>1.04);
  await page.screenshot({path:'/tmp/fam-workspace-choice-dark.png',fullPage:false});
  await page.evaluate(()=>FamTheme.set('light'));await page.screenshot({path:'/tmp/fam-workspace-choice-light.png',fullPage:false});
  await page.evaluate(()=>FamTheme.set('original'));
  await page.locator('#workspace-enter-panel').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#workspace-launcher[open]').count(),0);assert.ok(await page.locator('#view-panel').evaluate(n=>n.classList.contains('active')));
  assert.ok(await page.locator('#fold-ops').isVisible());await page.locator('#workspace-to-equipment').click();
  assert.ok(await page.locator('#view-equipment').evaluate(n=>n.classList.contains('active')));
  if(!await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await page.locator('[data-act="toggle-sidebar"]').click();
});
test('RADIUS gate precedes six independent classification axes',async()=>{
  assert.ok(await page.locator('#equipment-radius-password').isVisible());await radius();
  assert.equal(await workspace().locator('.eq-smart-cards .eq-card-main').count(),6);
  assert.match(await workspace().innerText(),/یک نود؛ چند دسته/);
  await page.waitForFunction(()=>document.querySelector('#equipment-workspace').getBoundingClientRect().width<1150);
  const boxes=await workspace().locator('.eq-smart-cards .eq-card').evaluateAll(cards=>cards.map(card=>({width:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height})));
  assert.ok(boxes.every(box=>box.height<=115&&box.width<=200),JSON.stringify(boxes));
  await page.screenshot({path:'/tmp/fam-compact-cards.png',fullPage:true});
});
test('compact subcategory cards have direct add/edit/delete with stable IDs and safe parent protection',async()=>{
  await viewFacet('نوع تجهیز');
  const sizes=await workspace().locator('.eq-smart-groups .eq-card').evaluateAll(cards=>cards.map(c=>c.getBoundingClientRect().height));assert.ok(sizes.every(h=>h<=90),JSON.stringify(sizes));
  await page.screenshot({path:'/tmp/fam-compact-subcategories.png',fullPage:true});
  page.once('dialog',d=>d.accept());await workspace().getByRole('button',{name:'حذف دسته روتر',exact:true}).click();assert.match(await workspace().innerText(),/مدل‌های وابسته/);
  await workspace().getByRole('button',{name:'＋ افزودن زیرمجموعه',exact:true}).click();
  assert.equal(await page.locator('#eq-catalog-dimension').inputValue(),'types');await page.locator('#eq-catalog-name').fill('تجهیز آزمایشی');
  await page.locator('.eq-dialog').getByRole('button',{name:'افزودن دسته',exact:true}).click();await page.locator('.eq-dialog').getByRole('button',{name:'بستن',exact:true}).click();
  const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')).catalog.types.find(t=>t.name==='تجهیز آزمایشی').id);
  await workspace().getByRole('button',{name:'ویرایش دسته تجهیز آزمایشی',exact:true}).click();assert.equal(await page.locator('#eq-catalog-name').inputValue(),'تجهیز آزمایشی');
  await page.locator('#eq-catalog-name').fill('تجهیز ویرایش‌شده');await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره تغییرات',exact:true}).click();await page.locator('.eq-dialog').getByRole('button',{name:'بستن',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.equipment.inventory.v3')).catalog.types.find(t=>t.name==='تجهیز ویرایش‌شده').id),id);
  page.once('dialog',d=>d.dismiss());await workspace().getByRole('button',{name:'حذف دسته تجهیز ویرایش‌شده',exact:true}).click();assert.equal(await workspace().locator('.eq-smart-groups .eq-card').count(),3);
  page.once('dialog',d=>d.accept());await workspace().getByRole('button',{name:'حذف دسته تجهیز ویرایش‌شده',exact:true}).click();assert.equal(await workspace().locator('.eq-smart-groups .eq-card').count(),2);
  await viewFacet('همهٔ نودها');
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
test('the same inline subcategory CRUD works for models, regions, location kinds, buildings and datacenters',async()=>{
  for(const [facet,key,parent]of [['مدل تجهیز','models','type-router'],['منطقه','regions',null],['نوع محل','siteKinds',null],['ساختمان‌ها','sites','kind-building'],['دیتا سنتر','sites','kind-datacenter']]){
    await clearFilters();await viewFacet(facet);const count=await workspace().locator('.eq-smart-groups .eq-card').count();
    await workspace().getByRole('button',{name:'＋ افزودن زیرمجموعه',exact:true}).click();
    assert.equal(await page.locator('#eq-catalog-dimension').inputValue(),key);
    if(key==='models')await page.locator('#eq-catalog-parent').selectOption(parent);
    if(key==='sites')assert.equal(await page.locator('#eq-catalog-parent').inputValue(),parent);
    await page.locator('#eq-catalog-name').fill('زیرمجموعه تست');await page.locator('.eq-dialog').getByRole('button',{name:'افزودن دسته',exact:true}).click();await page.locator('.eq-dialog').getByRole('button',{name:'بستن',exact:true}).click();
    assert.equal(await workspace().locator('.eq-smart-groups .eq-card').count(),count+1);
    await workspace().getByRole('button',{name:'ویرایش دسته زیرمجموعه تست',exact:true}).click();await page.locator('#eq-catalog-name').fill('زیرمجموعه جدید');await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره تغییرات',exact:true}).click();await page.locator('.eq-dialog').getByRole('button',{name:'بستن',exact:true}).click();
    page.once('dialog',d=>d.accept());await workspace().getByRole('button',{name:'حذف دسته زیرمجموعه جدید',exact:true}).click();assert.equal(await workspace().locator('.eq-smart-groups .eq-card').count(),count);
  }
  await viewFacet('همهٔ نودها');
});
test('overview cards can be renamed, added for a category, deleted and persisted without changing inventory',async()=>{
  const snapshot=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3'));
  await workspace().getByRole('button',{name:'ویرایش کارت نوع تجهیز',exact:true}).click();
  await page.locator('#eq-card-name').fill('تجهیزات شبکه');await page.locator('.eq-card-editor').getByRole('button',{name:'ذخیره کارت',exact:true}).click();
  await workspace().getByRole('button',{name:'＋ افزودن کارت',exact:true}).click();
  await page.locator('#eq-card-name').fill('تجهیزات منطقه یک');await page.locator('#eq-card-axis').selectOption('regions');await page.locator('#eq-card-target').selectOption('region-1');
  await page.locator('.eq-card-editor').getByRole('button',{name:'ذخیره کارت',exact:true}).click();
  assert.equal(await workspace().locator('.eq-smart-cards .eq-card').count(),7);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.equal(await workspace().getByRole('button',{name:'باز کردن تجهیزات شبکه',exact:true}).count(),1);
  await workspace().getByRole('button',{name:'باز کردن تجهیزات منطقه یک',exact:true}).click();
  assert.equal(await page.locator('#eq-filter-regionId').inputValue(),'region-1');assert.match(await table().innerText(),/روتر رضوان/);
  await viewFacet('همهٔ نودها');
  page.once('dialog',d=>d.dismiss());await workspace().getByRole('button',{name:'حذف کارت تجهیزات منطقه یک',exact:true}).click();assert.equal(await workspace().locator('.eq-smart-cards .eq-card').count(),7);
  page.once('dialog',d=>d.accept());await workspace().getByRole('button',{name:'حذف کارت تجهیزات منطقه یک',exact:true}).click();
  page.once('dialog',d=>d.accept());await workspace().getByRole('button',{name:'حذف کارت تجهیزات شبکه',exact:true}).click();
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.equal(await workspace().locator('.eq-smart-cards .eq-card').count(),5);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),snapshot);
  await workspace().getByRole('button',{name:'＋ افزودن کارت',exact:true}).click();await page.locator('#eq-card-name').fill('نوع تجهیز');
  await page.locator('.eq-card-editor').getByRole('button',{name:'ذخیره کارت',exact:true}).click();assert.equal(await workspace().locator('.eq-smart-cards .eq-card').count(),6);
});
test('a card storage failure keeps the previous cards and inventory unchanged',async()=>{
  const before=await page.evaluate(()=>[localStorage.getItem('fam.equipment.cards.v1'),localStorage.getItem('fam.equipment.inventory.v3')]);
  await workspace().getByRole('button',{name:'＋ افزودن کارت',exact:true}).click();await page.locator('#eq-card-name').fill('ذخیره ناموفق');
  await page.evaluate(()=>{window.__testSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='fam.equipment.cards.v1')throw new DOMException('Fake quota','QuotaExceededError');return window.__testSetItem.call(this,key,value);};});
  await page.locator('.eq-card-editor').getByRole('button',{name:'ذخیره کارت',exact:true}).click();assert.match(await page.locator('.eq-card-editor .eq-error').innerText(),/ذخیره نشد/);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('fam.equipment.cards.v1'),localStorage.getItem('fam.equipment.inventory.v3')]),before);
  await page.evaluate(()=>{Storage.prototype.setItem=window.__testSetItem;delete window.__testSetItem;});await page.locator('.eq-card-editor').getByRole('button',{name:'انصراف',exact:true}).click();
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
  await page.locator('#workspace-to-database').click();await page.locator('#workspace-to-equipment').click();assert.equal(await page.locator('#equipment-radius-password').count(),0);
  await page.locator('#view-equipment [data-workspace-picker]').click();assert.ok(await page.locator('#workspace-launcher').isVisible());
  await page.locator('#workspace-enter-panel').click();await page.locator('#workspace-to-equipment').click();assert.equal(await page.locator('#equipment-radius-password').count(),0);
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

test('malformed card preferences are not reset or overwritten; mobile cards remain compact',async()=>{
  await page.setViewportSize({width:1440,height:1000});
  const old=await page.evaluate(()=>localStorage.getItem('fam.equipment.cards.v1'));
  await page.evaluate(()=>localStorage.setItem('fam.equipment.cards.v1','{bad-cards'));
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await openEquipment();await radius();
  assert.match(await workspace().innerText(),/ویرایش کارت‌ها غیرفعال است/);
  assert.ok(await workspace().getByRole('button',{name:'＋ افزودن کارت',exact:true}).isDisabled());
  assert.ok(await workspace().getByRole('button',{name:'ویرایش کارت نوع تجهیز',exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.cards.v1')),'{bad-cards');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok((await workspace().locator('.eq-smart-cards .eq-card').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().height))).every(height=>height<=115));
  await page.evaluate(value=>localStorage.setItem('fam.equipment.cards.v1',value),old);
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

test('workspace chooser is responsive, supports reduced motion, and does not bypass account permissions',async()=>{
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>setSidebarOpen(false));
  await page.locator('#view-equipment [data-workspace-picker]').click();
  assert.equal(await page.locator('#workspace-launcher').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  assert.equal(await page.locator('.workspace-options').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#workspace-enter-equipment').hover();
  assert.equal(await page.locator('#workspace-enter-equipment').evaluate(n=>getComputedStyle(n).transform),'none');
  await page.screenshot({path:'/tmp/fam-workspace-choice-mobile.png',fullPage:false});
  await page.locator('#workspace-enter-equipment').click();await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{const accounts=JSON.parse(localStorage.getItem('fam.accounts.v1')),user={...accounts.users.find(u=>u.username==='admin'),id:crypto.randomUUID(),revision:crypto.randomUUID(),username:'equipment-only',name:'Equipment only',role:4,permissions:['equipment-operations'],categories:[],regions:[],sheets:[]};accounts.users.push(user);localStorage.setItem('fam.accounts.v1',JSON.stringify(accounts));sessionStorage.setItem('fam.session.v1',JSON.stringify({id:user.id,revision:user.revision}));});
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');
  assert.ok(await page.locator('#workspace-enter-panel').isDisabled());assert.ok(await page.locator('#workspace-enter-equipment').isEnabled());
  assert.equal(await page.evaluate(()=>FamWorkspaceLauncher.choose('panel')),false);assert.ok(await page.locator('#workspace-launcher').isVisible());
  await page.locator('#workspace-enter-equipment').click();assert.ok(await page.locator('#view-equipment').evaluate(n=>n.classList.contains('active')));
  assert.ok(await page.locator('#workspace-to-database').evaluate(n=>n.classList.contains('access-hidden')));
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
