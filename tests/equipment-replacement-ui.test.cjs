/* Synthetic API and browser only: no equipment access. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {launch}=require('./helpers/equipment-browser.cjs');let browser,page;const errors=[];
before(async()=>{browser=await launch();});after(async()=>{await browser?.close();assert.deepEqual(errors,[]);});
async function setup(options={}){
 if(page)await page.close();page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="mount"></div>');
 await page.evaluate(options=>{
  window.calls=[];window.Access={can:op=>!(options.noRepair&&op==='equipment-repair'),current:()=>({equipmentScope:Object.fromEntries(['types','models','regions','siteKinds','sites'].map(k=>[k,['*']]))}),equipmentView:v=>v};
  const data={catalog:{types:[{id:'switch',kind:'switch'}]},nodes:[{id:'a',name:'Branch A',host:'100.100.1.22',typeId:'switch'},{id:'b',name:'Branch B',host:'100.108.1.22',typeId:'switch'}]};
  window.FamEquipmentServer={inventory:()=>data,blocked:()=>false};window.FamShared={api:async(path,job)=>{calls.push({path,...job});
   if(path.endsWith('/plan')){const plan={interface:job.interface,staticIp:job.staticIp,ip:job.staticIp?'10.4.86.193':'',oldMac:'0001.08f1.31a6',planHash:'a'.repeat(64),vlan:100,acl:job.staticIp?'Inspection':''};if(options.badPlan)plan.interface='Gi0/1';return {host:job.host,source:'server-ssh',plan,ticket:'synthetic-ticket'};}
   if(path.endsWith('/apply')){if(options.fail)throw Error('وضعیت حفاظت نامشخص؛ بررسی فوری');return {host:job.host,interface:job.interface,replacement:'replaced',staticIp:job.staticIp,ip:job.staticIp?'10.4.86.193':'',oldMac:'0001.08f1.31a6',newMac:'0002.2222.2222',protectionRestored:!options.badSuccess};}
   return {host:job.host,source:'server-ssh',checkedAt:Date.now(),errDisabledPorts:[{interface:'Fa0/8',description:'fixture'}],recoveryTickets:{'Fa0/8':'old-recovery'},descriptions:{output:'Interface Status Protocol Description\nFa0/8 down down fixture\n'}};
  }};
 },options);
 await page.addScriptTag({content:fs.readFileSync('src/equipment-live-server.js','utf8')});await page.evaluate(()=>FamEquipmentLive.mount(document.getElementById('mount')));
 await page.locator('#eq-live-node-a').check();await page.locator('#eq-live-username').fill('synthetic-user');await page.locator('#eq-live-password').fill('synthetic-secret');
}
async function prepare(staticIp=true){await page.locator('#eq-live-port-a').fill('7');if(staticIp)await page.locator('#eq-live-static-a').check();await page.locator('#eq-live-scan').click();await page.getByRole('button',{name:'تأیید و تعویض MAC همین پورت'}).waitFor();}
async function apply(){await page.getByRole('button',{name:'تأیید و تعویض MAC همین پورت'}).click();assert.equal(await page.locator('#eq-live-replacement-apply').isDisabled(),true);await page.locator('#eq-live-replacement-approve').check();await page.locator('#eq-live-replacement-apply').click();}
test('blank optional port preserves current inspect/error recovery workflow',async()=>{
 await setup();assert.equal(await page.locator('#eq-live-static-a').isDisabled(),true);await page.locator('#eq-live-scan').click();await page.getByText('Fa0/8 · fixture',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.path)),['equipment/inspect']);assert.equal(await page.getByRole('button',{name:'تأیید و تعویض MAC همین پورت'}).count(),0);
});
test('per-branch port selects replacement only for that branch; IP is read not derived from 7',async()=>{
 await setup();await page.locator('#eq-live-node-b').check();await prepare();
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>[c.path,c.host,c.interface,c.staticIp])),[['equipment/replacement/plan','100.100.1.22','Fa0/7',true],['equipment/inspect','100.108.1.22',undefined,undefined]]);
 assert.match(await page.locator('#eq-live-report').textContent(),/10\.4\.86\.193/);assert.equal(await page.evaluate(()=>calls.some(c=>'ip' in c||'newMac' in c)),false);
});
test('explicit confirmation applies exactly one plan then invalidates all previous tickets',async()=>{
 await setup();await prepare();assert.equal(await page.evaluate(()=>calls.length),1);await apply();await page.getByText(/MAC جدید: 0002\.2222\.2222/).waitFor();
 const jobs=await page.evaluate(()=>calls);assert.equal(jobs.length,2);assert.equal(jobs[1].path,'equipment/replacement/apply');assert.equal(jobs[1].interface,'Fa0/7');assert.equal(jobs[1].planHash,'a'.repeat(64));assert.equal(jobs[1].staticIp,true);
 assert.match(await page.locator('#eq-live-report').textContent(),/IP بدون تغییر: 10\.4\.86\.193/);assert.equal(await page.getByRole('button',{name:'تأیید و تعویض MAC همین پورت'}).count(),0);
});
test('without static checkbox request does not supply IP or ACL changes',async()=>{
 await setup();await prepare(false);await apply();await page.getByText(/MAC جدید: 0002\.2222\.2222/).waitFor();const jobs=await page.evaluate(()=>calls);assert.equal(jobs[1].staticIp,false);assert.equal('ip' in jobs[1],false);
});
test('malformed plan or uncertain success cannot be shown as completed, no retry',async()=>{
 await setup({badPlan:true});await page.locator('#eq-live-port-a').fill('7');await page.locator('#eq-live-scan').click();await page.getByText(/پیش‌نمایش تعویض MAC معتبر نیست/).waitFor();assert.equal(await page.evaluate(()=>calls.length),1);
 for(const options of [{fail:true},{badSuccess:true}]){await setup(options);await prepare();await apply();await page.getByText(/موفقیت تأیید نشد؛ تکرار نکنید/).waitFor();assert.equal(await page.evaluate(()=>calls.length),2);}
});
test('scan-only user cannot use replacement; changes invalidate plan and logout clears RAM options',async()=>{
 await setup({noRepair:true});await page.locator('#eq-live-port-a').fill('7');await page.locator('#eq-live-scan').click();assert.equal(await page.evaluate(()=>calls.length),0);
 await setup();await prepare();await page.locator('#eq-live-port-a').fill('8');assert.equal(await page.getByRole('button',{name:'تأیید و تعویض MAC همین پورت'}).count(),0);
 await page.evaluate(()=>{FamEquipmentLive.suspend();document.getElementById('mount').replaceChildren();FamEquipmentLive.mount(document.getElementById('mount'));});assert.equal(await page.locator('#eq-live-port-a').inputValue(),'8');assert.equal(await page.locator('#eq-live-password').inputValue(),'synthetic-secret');
 await page.evaluate(()=>FamEquipmentLive.clear());assert.equal(await page.locator('#eq-live-port-a').inputValue(),'');assert.equal(await page.locator('#eq-live-password').inputValue(),'');
 assert.doesNotMatch(fs.readFileSync('src/equipment-live-server.js','utf8'),/localStorage|sessionStorage/);
});
