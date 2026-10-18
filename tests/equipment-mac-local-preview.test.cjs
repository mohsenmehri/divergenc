const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {launch,login}=require('./helpers/equipment-browser.cjs');let browser,page;const requests=[],errors=[];
before(async()=>{browser=await launch();page=await browser.newPage({viewport:{width:1440,height:1080}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.goto(pathToFileURL(path.resolve('releases/FAM-Client-MAC-LOCAL-Preview.html')).href);await login(page);await page.locator('#equipment-tab-ports').click();});
after(async()=>{await browser?.close();assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
test('local preview keeps existing workspace and never requests equipment credentials or a connection',async()=>{
 assert.equal(await page.locator('.eq-primary-nav .eq-nav-item').count(),6);assert.equal(await page.locator('#eq-local-mac-preview').count(),1);assert.match(await page.locator('#eq-local-mac-preview').textContent(),/هیچ اتصال/);assert.equal(await page.locator('input[type=password],#eq-live-scan').count(),0);
});
test('temporary switch is RAM-only; blank port describes existing recovery without fake outcome',async()=>{
 const old=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3'));
 await page.locator('#eq-local-mac-host').fill('100.100.1.22');await page.locator('#eq-local-mac-add').click();assert.equal(await page.locator('#eq-local-mac-switches input[data-static]').isDisabled(),true);
 await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output').textContent(),/پورت خالی.*Err-disabled/);assert.match(await page.locator('#eq-local-mac-output').textContent(),/نه نتیجهٔ بررسی/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),old);
});
test('port 7 with static checkbox shows unchanged-IP new-MAC flow, without allocating or reading any IP',async()=>{
 await page.locator('#eq-local-mac-switches input[data-port]').fill('7');await page.locator('#eq-local-mac-switches input[data-static]').check();await page.locator('#eq-local-mac-review').click();
 const text=await page.locator('#eq-local-mac-output').textContent();assert.match(text,/Fa0\/7/);assert.match(text,/ثبت همان IP.*MAC جدید/);assert.match(text,/Inspection/);assert.match(text,/هیچ‌یک از این مراحل اجرا نشده/);assert.match(text,/Sticky/);
 await page.locator('#eq-local-mac-switches input[data-port]').fill('25');assert.equal(await page.locator('#eq-local-mac-output article').count(),0);await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output').textContent(),/بین ۱ تا ۲۴/);
 await page.locator('#eq-local-mac-switches input[data-port]').fill('7');await page.locator('#eq-local-mac-switches input[data-static]').uncheck();await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output').textContent(),/هیچ رکورد ثابت.*تغییر نخواهد کرد/);
});
test('responsive preview and refresh clear temporary targets; canonical/server builds do not embed preview',async()=>{
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
 await page.reload();await page.locator('#workspace-enter-equipment').click();await page.locator('#equipment-tab-ports').click();assert.equal(await page.locator('#eq-local-mac-switches input[data-node]').count(),0);assert.equal(await page.locator('#eq-local-mac-output article').count(),0);
 for(const file of ['FAM.html','server/private_ui/FAM.html'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fam-local-mac-preview-js/);
 assert.doesNotMatch(fs.readFileSync('src/equipment-mac-local-preview.js','utf8'),/fetch\(|XMLHttpRequest|FamShared|localStorage|sessionStorage/);
});
