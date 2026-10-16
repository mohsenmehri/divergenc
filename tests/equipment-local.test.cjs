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
  await page.waitForFunction(()=>Access.current()&&!document.documentElement.classList.contains('auth-pending'));
  await page.locator('[data-act="toggle-sidebar"]').click();
  await page.locator('.tab-btn[data-view="equipment"]').click();
});
after(async()=>{await browser?.close();});
async function check(scenario){
  await page.locator('#equipment-demo-scenario').selectOption(scenario);
  await page.locator('#equipment-host').fill('10.2.35.2');
  await page.locator('#equipment-username').fill('fake-only-user');
  await page.locator('#equipment-password').fill('fake-only-password-777');
  await page.locator('#equipment-check-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#equipment-check-submit').disabled);
  assert.equal(await page.locator('#equipment-password').inputValue(),'');
}
test('local file login opens the full FAM and equipment tab without server or workbook',async()=>{
  assert.equal(await page.evaluate(()=>Access.current().username),'admin');
  assert.ok(await page.locator('#view-equipment').isVisible());
  assert.match(await page.locator('.equipment-demo-banner').innerText(),/نسخهٔ محلی/);
  assert.match(await page.locator('.equipment-demo-banner').innerText(),/رمز واقعی/);
  await check('clean');
  assert.match(await page.locator('#equipment-status').innerText(),/وضعیت پاک \(نمایشی\)/);
});
test('sample port requires same-interface confirmation and fresh fake password',async()=>{
  await check('errdisabled');
  const button=page.getByRole('button',{name:'تأیید رفع خطا',exact:true});
  assert.match(await page.locator('.equipment-port').innerText(),/Gi0\/1/);
  assert.match(await page.locator('.equipment-port').innerText(),/ATM 17/);
  page.once('dialog',async d=>{assert.match(d.message(),/Gi0\/1/);await d.accept();});
  await button.click();
  assert.match(await page.locator('#equipment-recovery-note').innerText(),/دوباره وارد کنید/);
  await page.locator('#equipment-password').fill('fake-only-password-777');
  page.once('dialog',d=>d.dismiss());await button.click();
  assert.equal(await page.locator('#equipment-password').inputValue(),'fake-only-password-777');
  page.once('dialog',d=>d.accept());await button.click();
  await page.waitForFunction(()=>!document.querySelector('#equipment-check-submit').disabled);
  assert.match(await page.locator('#equipment-status').innerText(),/نمایشی.*Gi0\/1 بازیابی شد/);
  assert.equal(await page.locator('#equipment-password').inputValue(),'');
});
test('remaining recovery states and all error scenarios are explicitly simulated',async()=>{
  for(const [scenario,text] of [['still','همچنان Err-disabled'],['changed','تغییری اعمال نشد']]){
    await check(scenario);await page.locator('#equipment-password').fill('fake-only-password-777');
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'تأیید رفع خطا',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#equipment-check-submit').disabled);
    assert.ok((await page.locator('#equipment-status').innerText()).includes(text));
    assert.equal(await page.locator('#equipment-password').inputValue(),'');
  }
  for(const scenario of ['auth','timeout','connection']){
    await check(scenario);assert.match(await page.locator('#equipment-status').innerText(),/^نمایشی/);
    assert.ok(await page.locator('#equipment-status').evaluate(e=>e.classList.contains('error')));
  }
});
test('device demo values are never persisted or sent to network; layout works on mobile',async()=>{
  const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
  for(const secret of ['fake-only-user','fake-only-password-777'])assert.ok(!storage.includes(secret));
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok(await page.locator('#equipment-check-submit').isVisible());
});
