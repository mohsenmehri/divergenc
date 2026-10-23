/* Actual picker/session/controller; synthetic metadata, never equipment SSH. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {launch,equipmentLogin}=require('./helpers/equipment-browser.cjs');let browser,page;const errors=[];
before(async()=>{browser=await launch();});after(async()=>{await browser?.close();assert.deepEqual(errors,[]);});
async function setup(){
 if(page)await page.close();page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto('about:blank');await page.setContent('<html dir="rtl"><body><button id="workspace-enter-equipment">ورود به تجهیزات</button><button id="account-logout">خروج</button><div id="equipment-workspace"><div id="mount"></div></div></body></html>');
 await page.evaluate(()=>{
  let ids=0;Object.defineProperty(crypto,'randomUUID',{value:()=>String(++ids)});window.entered=0;window.calls=[];window.Access={current:()=>({id:'actor',equipmentScope:Object.fromEntries(['types','models','regions','siteKinds','sites'].map(k=>[k,['*']]))}),can:()=>true,equipmentView:v=>v};
  document.getElementById('workspace-enter-equipment').onclick=()=>entered++;
  const catalog={types:[{id:'switch',kind:'switch',name:'سوئیچ'}],models:[{id:'model',name:'2960'}],regions:[{id:'khorasan',name:'خراسان'},{id:'tehran',name:'تهران'}],siteKinds:[{id:'branch',name:'شعبه'}],sites:[{id:'mashhad',name:'مشهد',regionId:'khorasan'}]};
  const nodes=Array.from({length:62},(_,i)=>({id:'node-'+i,name:'تجهیز '+(i===0?'235':300+i),host:'100.100.1.'+(i+1),regionId:i===61?'tehran':'khorasan',siteKindId:'branch',siteId:i===61?null:'mashhad',typeId:'switch',modelId:'model'}));
  window.FamEquipmentServer={inventory:()=>({catalog,nodes}),blocked:()=>false};window.FamEquipmentInventory={privateIP:v=>/^100\.100\.1\.\d+$/.test(v)};window.FamShared={api:async(path,body)=>{calls.push({path,...body});throw Error('Synthetic UI test: no equipment access');}};
 });
 for(const file of ['equipment-session','equipment-switch-picker','equipment-live-server'])await page.addScriptTag({content:fs.readFileSync('src/'+file+'.js','utf8')});
 await page.addStyleTag({content:':root{--bg-1:#f4f6fa;--glass:white;--glass-2:#f5f7fb;--stroke:#e3e8f0;--txt-0:#1e2e48;--txt-1:#65758c;--cyan:#315edb}body{margin:12px}input{box-sizing:border-box}'});
 for(const file of ['equipment-workspace','equipment-review'])await page.addStyleTag({content:fs.readFileSync('src/'+file+'.css','utf8')});
 await page.evaluate(()=>FamEquipmentLive.mount(document.getElementById('mount')));
}
test('entry is gated once, cancellation never navigates, submit makes no SSH and removes credential DOM',async()=>{
 await setup();await page.locator('#workspace-enter-equipment').click();assert.equal(await page.evaluate(()=>entered),0);await page.locator('#eq-session-password').fill('discarded-fixture');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>entered),0);assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),false);assert.equal(await page.locator('input[type=password]').count(),0);
 await page.locator('#workspace-enter-equipment').click();await equipmentLogin(page);await page.waitForFunction(()=>entered===1);assert.equal(await page.locator('input[type=password],#eq-live-username,#eq-live-password').count(),0);await page.locator('#workspace-enter-equipment').click();assert.equal(await page.evaluate(()=>entered),2);assert.equal(await page.evaluate(()=>calls.length),0);
});
test('235 in either digit script finds equipment, region returns every descendant via progressive results, ticks share selected list',async()=>{
 await setup();for(const query of ['235','۲۳۵','٢٣٥']){await page.locator('#eq-live-search').fill(query);assert.equal(await page.locator('.eq-device-option').count(),1);assert.match(await page.locator('.eq-device-option').textContent(),/تجهیز 235/);}
 await page.locator('#eq-live-node-node-0').check();assert.equal(await page.locator('[data-selected-node]').count(),1);await page.locator('#eq-live-search').fill('خراسان');assert.match(await page.locator('.eq-device-results-head').textContent(),/۶۱/);assert.equal(await page.locator('.eq-device-option').count(),50);await page.locator('#eq-picker-more').click();assert.equal(await page.locator('.eq-device-option').count(),61);assert.equal(await page.locator('#eq-live-node-node-61').count(),0);await page.locator('#eq-live-node-node-60').check();assert.equal(await page.locator('[data-selected-node]').count(),2);assert.equal(await page.evaluate(()=>calls.length),0);
 await page.locator('#eq-live-search').fill('100.100.1.99');await page.locator('#eq-live-search').press('Enter');assert.equal(await page.locator('[data-selected-node]').count(),3);await page.locator('#eq-live-clear-selection').click();assert.equal(await page.locator('[data-selected-node]').count(),0);
});
test('session survives suspend, navigation and canceled replacement, then logout/pagehide clears RAM and password DOM',async()=>{
 await setup();await equipmentLogin(page);await page.evaluate(()=>{FamEquipmentLive.suspend();document.getElementById('mount').replaceChildren();FamEquipmentLive.mount(document.getElementById('mount'));});assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),true);
 await page.evaluate(()=>{void FamEquipmentSession.request({force:true});});await page.locator('#eq-session-password').fill('not-saved');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>FamEquipmentSession.read().username),'synthetic-user');
 await page.locator('#account-logout').click();assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),false);assert.equal(await page.locator('input[type=password]').count(),0);await equipmentLogin(page);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),false);
});
test('layout fits desktop/tablet/mobile and read-only diagnosis stays optional; secrets have no storage APIs',async()=>{
 await setup();await equipmentLogin(page);await page.locator('#eq-live-search').fill('235');await page.locator('#eq-live-node-node-0').check();assert.equal(await page.locator('#eq-client-diagnosis-details').getAttribute('open'),null);assert.equal(await page.locator('#eq-live-scan').isDisabled(),false);
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow '+width);}
 const source=fs.readFileSync('src/equipment-session.js','utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|console\./);assert.equal(await page.evaluate(()=>calls.length),0);
});
