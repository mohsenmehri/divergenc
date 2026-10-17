/* Real standalone-file browser tests; all node names/IPs/commands are synthetic. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
let browser,page,inventoryBefore;const errors=[],requests=[],marker='FAM-DRY-ONLY-MARKER-5541';
before(async()=>{
 if(!process.env.CHROMIUM_PATH){const libs=path.resolve('.cache/chromium-libs');fs.mkdirSync(libs,{recursive:true});const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});process.env.LD_LIBRARY_PATH=[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>a!=='--disable-web-security'),headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 await page.goto(pathToFileURL(path.resolve('FAM.html')).href);await page.locator('#auth-username').waitFor();
 await page.evaluate(()=>{
   const M=FamEquipmentInventory,data=M.defaults(),node=(id,extra={})=>({id:'config-node-'+id,name:'Synthetic node '+id,host:'10.88.0.'+id,typeId:'type-router',modelId:'model-1300',regionId:'region-2',siteKindId:'kind-building',siteId:'building-0',...extra});
   data.nodes=[node(1),node(2,{modelId:'model-1841',regionId:'region-1'}),node(3,{modelId:'model-1841'}),node(4,{typeId:'type-switch',modelId:'model-2960',regionId:'region-3'}),node(5,{regionId:'region-4'}),node(6,{modelId:null}),...Array.from({length:26},(_,i)=>node(i+10))];
   localStorage.setItem('fam.equipment.inventory.v3',JSON.stringify(M.validate(data)));
 });
 await page.reload();await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await page.locator('#workspace-enter-equipment').click();await radius();
 inventoryBefore=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3'));
});
after(async()=>{await browser?.close();});
async function radius(){} // Inventory no longer requires device credentials.

const targets=()=>page.locator('#eq-config-targets');
const field=(index,key)=>page.locator('#eq-config-rule-'+index+'-'+key);
async function commands(){await page.locator('#eq-config-commands').fill('interface GigabitEthernet0/1\n description '+marker);}
test('configuration tab has a command editor and blocks empty target selection or empty commands',async()=>{
 await page.locator('#equipment-tab-configuration').click();assert.ok(await page.locator('#eq-config-commands').isVisible());assert.ok(await page.locator('#eq-config-commands').evaluate(n=>n.getBoundingClientRect().height>=235));
 assert.ok(await page.locator('#eq-config-review').isDisabled());assert.match(await targets().innerText(),/حداقل یک شرط/);
 await commands();assert.ok(await page.locator('#eq-config-review').isDisabled());
 await field(0,'typeId').selectOption('type-router');await field(0,'regionId').selectOption('region-2');
 assert.match(await targets().innerText(),/28 تجهیز یکتا/);assert.match(await targets().innerText(),/1 تجهیز نیازمند تکمیل/);assert.ok(await page.locator('#eq-config-review').isEnabled());
});
test('multiple target groups union AND filters and deduplicate models shared with region groups',async()=>{
 await page.locator('#eq-config-add-rule').click();assert.ok(await page.locator('#eq-config-review').isDisabled());
 await field(1,'modelId').selectOption('model-1841');assert.equal(await field(1,'typeId').inputValue(),'type-router');
 await page.locator('#eq-config-add-rule').click();await field(2,'typeId').selectOption('type-switch');await field(2,'modelId').selectOption('model-2960');
 assert.match(await targets().innerText(),/30 تجهیز یکتا/);assert.equal(await targets().locator('tbody tr').count(),25);
 await targets().getByRole('button',{name:'بعدی',exact:true}).click();assert.equal(await targets().locator('tbody tr').count(),5);await targets().getByRole('button',{name:'قبلی',exact:true}).click();
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/fam-config-targets.png',fullPage:true,animations:'disabled',timeout:30000});
});
test('review lists exact destinations, requires acknowledgment, and cancel does not simulate or change inventory',async()=>{
 await page.locator('#eq-config-review').click();assert.equal(await page.locator('#eq-config-confirm .eq-config-review-list > div').count(),30);
 assert.ok(await page.locator('#eq-config-confirm-submit').isDisabled());assert.match(await page.locator('#eq-config-confirm').innerText(),/هیچ SSH/);
 await page.locator('#eq-config-confirm').getByRole('button',{name:'انصراف',exact:true}).click();assert.doesNotMatch(await targets().innerText(),/شبیه‌سازی برای/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),inventoryBefore);
});
test('confirmed deployment is explicitly dry-run only, never changes inventory or persists command text',async()=>{
 await page.locator('#eq-config-review').click();await page.locator('#eq-config-ack').check();await page.locator('#eq-config-confirm-submit').click();
 assert.equal(await page.locator('#eq-config-confirm').count(),0);assert.match(await targets().innerText(),/شبیه‌سازی برای 30 تجهیز تکمیل شد/);assert.match(await targets().innerText(),/شبیه‌سازی شد · بدون ارسال/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),inventoryBefore);
 const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));for(const text of [marker,'fake-config-radius-secret','fake-config-radius-user'])assert.ok(!storage.includes(text));
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
test('editing commands invalidates old outcomes; drafts survive tab/database navigation but not main logout',async()=>{
 await page.locator('#eq-config-commands').fill('description '+marker+'-EDITED');assert.doesNotMatch(await targets().innerText(),/شبیه‌سازی برای/);
 await page.locator('#equipment-tab-inventory').click();await page.locator('#equipment-tab-configuration').click();assert.equal(await page.locator('#eq-config-commands').inputValue(),'description '+marker+'-EDITED');
 await page.locator('#workspace-to-database').click();await page.locator('#workspace-to-equipment').click();assert.equal(await page.locator('#eq-config-commands').inputValue(),'description '+marker+'-EDITED');
 await page.locator('#stat-line').click();await page.locator('#account-logout').click();await page.locator('#auth-username').waitFor();await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await page.locator('#workspace-enter-equipment').click();assert.equal(await page.locator('#equipment-radius-password').count(),0);await radius();
 await page.locator('#equipment-tab-configuration').click();assert.equal(await page.locator('#eq-config-commands').inputValue(),'');assert.equal(await field(0,'regionId').inputValue(),'');
});
test('inventory category selection can prefill a configuration target; mobile themes do not overflow',async()=>{
 await page.locator('#equipment-tab-inventory').click();await page.locator('#eq-filter-toggle').click();await page.locator('#eq-filter-typeId').selectOption('type-router');await page.locator('#eq-filter-regionId').selectOption('region-2');
 await page.getByRole('button',{name:'پیکربندی این انتخاب',exact:true}).click();assert.equal(await field(0,'typeId').inputValue(),'type-router');assert.equal(await field(0,'regionId').inputValue(),'region-2');assert.match(await targets().innerText(),/28 تجهیز یکتا/);
 await commands();await page.setViewportSize({width:390,height:844});for(const theme of ['light','original']){await page.evaluate(value=>FamTheme.set(value),theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.ok(await page.locator('#eq-config-commands').evaluate(n=>n.getBoundingClientRect().height>=210));await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/fam-config-mobile.png',fullPage:true,animations:'disabled',timeout:30000});
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');await page.locator('#workspace-enter-equipment').click();await radius();await page.locator('#equipment-tab-configuration').click();assert.equal(await page.locator('#eq-config-commands').inputValue(),'');
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
