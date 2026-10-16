/* Isolated equipment-tab interaction checks; no SSH/network or real credentials. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
let browser,page;
const html=fs.readFileSync('server/private_ui/FAM.html','utf8');
const section=html.match(/<section class="view" id="view-equipment">[\s\S]*?<\/section>/)[0];
const script=html.match(/<script id="fam-equipment-management-js">([\s\S]*?)<\/script>/)[1];
before(async()=>{
  if(!process.env.CHROMIUM_PATH){
    const libs=path.resolve('.cache/chromium-libs');fs.mkdirSync(libs,{recursive:true});
    const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
    execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
    process.env.LD_LIBRARY_PATH=[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args,headless:true});
});
after(async()=>{await browser?.close();});
async function setup(result){
  if(!page)page=await browser.newPage();
  await page.setContent(section);
  await page.evaluate(value=>{
    window.calls=[];window.confirmations=[];window.approve=true;
    window.confirm=message=>{confirmations.push(message);return approve;};
    window.FamShared={api:async(endpoint,payload)=>{
      calls.push({endpoint,payload});
      if(value.error)throw new Error(value.error);
      return endpoint==='equipment/check'?value:{recovery:'recovered'};
    }};
  },result);
  await page.addScriptTag({content:script});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.locator('#equipment-host').fill('10.2.35.2');
  await page.locator('#equipment-username').fill('unit-test-user');
  await page.locator('#equipment-password').fill('fake-only-password');
}
test('equipment check starts on submit, shows clean state and clears password',async()=>{
  await setup({errDisabledPorts:[],recoveryTickets:{}});
  await page.locator('#equipment-check-submit').click();
  await page.waitForFunction(()=>document.querySelector('#equipment-status').classList.contains('ok'));
  assert.match(await page.locator('#equipment-status').innerText(),/وضعیت پاک/);
  assert.equal(await page.locator('#equipment-password').inputValue(),'');
  assert.equal(await page.evaluate(()=>calls[0].endpoint),'equipment/check');
  assert.equal(await page.evaluate(()=>calls.length),1);
});
test('recovery requires explicit confirmation of the same interface and fresh password',async()=>{
  await setup({errDisabledPorts:[{interface:'Gi0/1',description:'ATM 17'}],recoveryTickets:{'Gi0/1':'opaque-test-ticket'}});
  await page.locator('#equipment-check-submit').click();
  const recovery=page.getByRole('button',{name:'تأیید رفع خطا'});
  await recovery.waitFor();
  assert.match(await page.locator('#equipment-status').innerText(),/ATM 17/);
  await recovery.click();
  assert.equal(await page.evaluate(()=>calls.length),1); // blank password => no operation
  // A missing-password message replaces the old result; recheck before recovery.
  await page.locator('#equipment-password').fill('fake-only-password');
  await page.locator('#equipment-check-submit').click();
  await recovery.waitFor();
  await page.locator('#equipment-password').fill('fresh-fake-password');
  await page.evaluate(()=>{approve=false;});await recovery.click();
  assert.equal(await page.evaluate(()=>calls.length),2);
  await page.evaluate(()=>{approve=true;});await recovery.click();
  await page.waitForFunction(()=>calls.length===3);
  const call=await page.evaluate(()=>calls[2]);
  assert.equal(call.endpoint,'equipment/recover');
  assert.equal(call.payload.interface,'Gi0/1');
  assert.equal(call.payload.ticket,'opaque-test-ticket');
  assert.equal(call.payload.password,'fresh-fake-password');
  assert.match(await page.evaluate(()=>confirmations.at(-1)),/Gi0\/1/);
  assert.equal(await page.locator('#equipment-password').inputValue(),'');
});
test('failed check clears password and displays only the supplied safe message',async()=>{
  await setup({error:'بررسی تجهیز انجام نشد.'});
  await page.locator('#equipment-check-submit').click();
  await page.waitForFunction(()=>document.querySelector('#equipment-status').classList.contains('error'));
  assert.equal(await page.locator('#equipment-password').inputValue(),'');
  assert.equal(await page.locator('#equipment-status').innerText(),'بررسی تجهیز انجام نشد.');
});
