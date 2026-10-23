/* SERVER controller with synthetic API data only; no SSH/network. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {launch,equipmentLogin}=require('./helpers/equipment-browser.cjs');let browser,page;const errors=[];
before(async()=>{browser=await launch();});after(async()=>{await browser?.close();assert.deepEqual(errors,[]);});
const report=()=>({profile:{model:'WS-C2960-24TT-L',ios:'12.2(55)SE12',image:'c2960-lanbasek9-mz.122-55.SE12.bin'},client:{ip:'10.4.86.7',mac:''},sources:['secure','bindings','mac','dai'].map(id=>({id,state:'parsed',count:1})),candidates:[{interface:'Fa0/7',observedMac:'0002.2222.2222',recordedPorts:['Fa0/12'],reasons:['mac_table_seen','binding_port_conflict','secure_mac_conflict'],confidence:'medium',historical:false}],assessment:'evidence',readOnly:true,movementConfirmed:false,vlan:100});
async function setup(value=report(),permitted=true){
 if(page)await page.close();page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="mount"></div>');
 await page.evaluate(({value,permitted})=>{
  window.calls=[];window.Access={can:()=>permitted,current:()=>({equipmentScope:Object.fromEntries(['types','models','regions','siteKinds','sites'].map(k=>[k,['*']]))}),equipmentView:v=>v};
  const data={catalog:{types:[{id:'switch',kind:'switch'}]},nodes:[{id:'test',name:'Synthetic branch',host:'100.100.1.22',typeId:'switch'}]};
  window.FamEquipmentInventory={privateIP:v=>/^100\.100\.1\.22$/.test(v)};window.FamEquipmentServer={inventory:()=>data,blocked:()=>false};window.FamShared={api:async(path,job)=>{calls.push({path,...job});if(value.error)throw Error(value.error);return {host:job.host,source:'server-ssh',checkedAt:Date.now(),report:value};}};
 },{value,permitted});
 await page.addScriptTag({content:fs.readFileSync('src/equipment-session.js','utf8')});await page.addScriptTag({content:fs.readFileSync('src/equipment-switch-picker.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('src/equipment-live-server.js','utf8')});await page.evaluate(()=>FamEquipmentLive.mount(document.getElementById('mount')));
}
async function credentials(){await page.locator('#eq-live-search').fill('100.100.1.22');await page.locator('#eq-live-search').press('Enter');await page.locator('#eq-client-diagnosis-details').evaluate(n=>n.open=true);await equipmentLogin(page);}
async function run(){await credentials();await page.locator('#eq-client-ip').fill('10.4.86.7');await page.locator('#eq-client-diagnose').click();}
test('diagnosis is opt-in and requires client identity but never a port number',async()=>{
 await setup();await credentials();assert.equal(await page.evaluate(()=>calls.length),0);await page.locator('#eq-client-diagnose').click();assert.equal(await page.evaluate(()=>calls.length),0);
 assert.match(await page.locator('#eq-live-report').textContent(),/IP یا MAC کلاینت/);assert.equal(await page.locator('#eq-client-diagnosis input').count(),2);
});
test('read-only evidence shows candidate, recorded port, source availability and bounded confidence',async()=>{
 await setup();await run();const root=page.locator('#eq-client-diagnosis-report');await root.getByText(/Fa0\/7.*0002\.2222\.2222/).waitFor();
 assert.match(await root.textContent(),/Fa0\/12/);assert.match(await root.textContent(),/متوسط/);assert.match(await root.textContent(),/جابه‌جایی قطعی تأیید نشده/);
 assert.equal(await root.locator('button,input').count(),0);assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.path)),['equipment/diagnose']);
 assert.doesNotMatch(fs.readFileSync('src/equipment-live-server.js','utf8'),/localStorage|sessionStorage/);
 await page.locator('#eq-client-ip').fill('10.4.86.8');assert.equal(await root.locator('article').count(),0);
});
test('historical-only evidence remains low and an empty result remains unknown, never healthy',async()=>{
 const r=report();r.candidates[0].reasons=['dai_denied_historical'];r.candidates[0].confidence='low';r.candidates[0].historical=true;
 await setup(r);await run();assert.match(await page.locator('#eq-client-diagnosis-report').textContent(),/کم؛ شواهد تاریخی/);
 r.candidates=[];r.assessment='unknown';r.sources.forEach(s=>{s.state='unavailable';s.count=0;});await setup(r);await run();
 assert.match(await page.locator('#eq-client-diagnosis-report').textContent(),/پورت کلاینت مشخص نشد/);assert.match(await page.locator('#eq-client-diagnosis-report').textContent(),/غیرقابل‌تأیید/);
});
test('confirmed-move or malformed success is rejected; failures do not retry or configure',async()=>{
 for(const value of [{...report(),movementConfirmed:true},{...report(),candidates:[{interface:'Fa0/7;reload'}]},{error:'Synthetic timeout; unknown'}]){
  await setup(value);await run();assert.match(await page.locator('#eq-client-diagnosis-report').textContent(),/تشخیص نامشخص/);assert.equal(await page.evaluate(()=>calls.length),1);
 }
});
test('scan permission is required and RAM identity survives navigation but clears on logout',async()=>{
 await setup(report(),false);assert.equal(await page.locator('#eq-client-diagnose').isDisabled(),true);
 await setup();await run();await page.evaluate(()=>{FamEquipmentLive.suspend();document.getElementById('mount').replaceChildren();FamEquipmentLive.mount(document.getElementById('mount'));});
 assert.equal(await page.locator('#eq-client-ip').inputValue(),'10.4.86.7');assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),true);assert.equal(await page.locator('#eq-live-username,#eq-live-password').count(),0);
 await page.evaluate(()=>{FamEquipmentSession.clear();FamEquipmentLive.clear();});assert.equal(await page.locator('#eq-client-ip').inputValue(),'');assert.equal(await page.evaluate(()=>FamEquipmentSession.ready()),false);assert.equal(await page.locator('#eq-client-diagnosis-report article').count(),0);
});
