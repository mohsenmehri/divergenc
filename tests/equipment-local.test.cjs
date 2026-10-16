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
async function card(name){await workspace().locator('.eq-card-main').filter({has:page.locator('strong',{hasText:new RegExp('^'+name+'$')})}).click();}
async function add(kind,name,host){
  await workspace().getByRole('button',{name:'＋ افزودن '+kind,exact:true}).click();
  await page.locator('#eq-edit-name').fill(name);
  if(host)await page.locator('#eq-edit-host').fill(host);
  await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره',exact:true}).click();
}
async function cleanCheck(){
  await page.waitForFunction(()=>document.querySelector('#equipment-check-submit')&&!document.querySelector('#equipment-check-submit').disabled);
}
test('clicking Equipment requires transient RADIUS before showing inventory',async()=>{
  assert.ok(await page.locator('#equipment-radius-password').isVisible());
  assert.equal(await workspace().locator('.eq-card-main').count(),0);
  assert.match(await workspace().innerText(),/این مرحله احراز هویت واقعی RADIUS نیست/);
  await radius();
  assert.equal(await workspace().locator('.eq-card-main').count(),2);
  assert.equal(await page.locator('#equipment-radius-password').count(),0);
  assert.match(await workspace().innerText(),/RADIUS آماده است/);
  await page.screenshot({path:'/tmp/fam-equipment-home-redesign.png',fullPage:true});
});
test('router and switch each have requested editable geographic hierarchy',async()=>{
  for(const type of ['روتر','سوئیچ']){
    await card(type);
    if(type==='سوئیچ')await page.screenshot({path:'/tmp/fam-equipment-groups-redesign.png',fullPage:true});
    for(const name of ['شعبه و حوزه','ساختمان‌ها','دیتا سنتر'])assert.ok((await workspace().innerText()).includes(name));
    await card('ساختمان‌ها');
    assert.equal(await workspace().locator('.eq-card-main').count(),6);
    for(const name of ['ساختمان مرکزی رضوان','ساختمان 68 شرقی فام','ساختمان 68 شرقی ملل','ساختمان 68 شرقی شرکت ها','ساختمان مرکزی فام','ساختمان ملاصدرا فام'])assert.ok((await workspace().innerText()).includes(name));
    await workspace().locator('.eq-breadcrumbs').getByRole('button',{name:type,exact:true}).click();
    await card('دیتا سنتر');assert.equal(await workspace().locator('.eq-card-main').count(),2);
    assert.ok((await workspace().innerText()).includes('تهران'));assert.ok((await workspace().innerText()).includes('سمنان'));
    await workspace().locator('.eq-breadcrumbs').getByRole('button',{name:type,exact:true}).click();
    await card('شعبه و حوزه');
    for(const name of ['شعبه','حوزه','انبار و غیره'])assert.ok((await workspace().innerText()).includes(name));
    await workspace().locator('.eq-breadcrumbs').getByRole('button',{name:'تجهیزات',exact:true}).click();
  }
});
test('add a node by name/IP, then click its name for automatic simulated check and Device 360',async()=>{
  await card('سوئیچ');await card('شعبه و حوزه');await card('شعبه');
  await add('نود','سوئیچ شعبه آزمایشی','10.2.35.2');
  assert.equal(await page.locator('.eq-dialog').count(),0);
  await page.screenshot({path:'/tmp/fam-equipment-inventory.png',fullPage:true});
  await page.getByRole('button',{name:'سوئیچ شعبه آزمایشی',exact:true}).click();
  await cleanCheck();
  assert.match(await page.locator('#equipment-status').innerText(),/وضعیت پاک \(نمایشی\)/);
  assert.match(await workspace().innerText(),/DEVICE 360/);
  assert.match(await workspace().innerText(),/10.2.35.2/);
  await page.getByRole('tab',{name:'دستورهای موردعلاقه',exact:true}).click();
  assert.match(await workspace().innerText(),/در مرحلهٔ بعد/);
});
test('RADIUS error does not auto-detect local account or execute Enable; recovery needs confirmation',async()=>{
  await page.getByRole('tab',{name:'پورت‌ها و خطاها',exact:true}).click();
  await page.locator('#equipment-demo-scenario').selectOption('auth');
  await page.locator('#equipment-check-submit').click();await cleanCheck();
  assert.match(await page.locator('#equipment-status').innerText(),/ثابت نمی‌کند حساب تجهیز Local است/);
  assert.match(await workspace().innerText(),/فعلاً غیرفعال است/);
  assert.equal(await workspace().locator('input[type=password]').count(),0);
  await page.locator('#equipment-demo-scenario').selectOption('errdisabled');
  await page.locator('#equipment-check-submit').click();await cleanCheck();
  page.once('dialog',async d=>{assert.match(d.message(),/Gi0\/1/);assert.match(d.message(),/سوئیچ شعبه آزمایشی/);await d.dismiss();});
  await page.getByRole('button',{name:'تأیید بازیابی Gi0/1',exact:true}).click();
  assert.match(await page.locator('#equipment-status').innerText(),/Err-disabled یافت شد/);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'تأیید بازیابی Gi0/1',exact:true}).click();
  assert.match(await page.locator('#equipment-status').innerText(),/هیچ دستور واقعی اجرا نشد/);
});
test('inventory CRUD, validation, search and safe rendering work without storing credentials',async()=>{
  await workspace().locator('.eq-breadcrumbs').getByRole('button',{name:'شعبه',exact:true}).click();
  await add('نود','IP نامعتبر','8.8.8.8');
  assert.match(await page.locator('.eq-dialog').innerText(),/فقط IPv4 خصوصی/);
  await page.locator('.eq-dialog').getByRole('button',{name:'انصراف',exact:true}).click();
  await add('نود','IP تکراری','10.2.35.2');assert.match(await page.locator('.eq-dialog').innerText(),/IP در همین نوع تجهیز ثبت شده/);
  await page.locator('.eq-dialog').getByRole('button',{name:'انصراف',exact:true}).click();
  await page.locator('#equipment-node-search').fill('missing');assert.equal(await workspace().locator('.eq-node-link').count(),0);
  await page.locator('#equipment-node-search').fill('10.2.35');assert.equal(await workspace().locator('.eq-node-link').count(),1);
  await page.locator('#equipment-node-search').fill('');
  await workspace().locator('.eq-table').getByRole('button',{name:'ویرایش',exact:true}).click();
  await page.locator('#eq-edit-name').fill('<img src=x onerror=alert(1)>');
  await page.locator('.eq-dialog').getByRole('button',{name:'ذخیره',exact:true}).click();
  assert.equal(await workspace().locator('.eq-table img').count(),0);
  page.once('dialog',d=>d.accept());await workspace().locator('.eq-table').getByRole('button',{name:'حذف',exact:true}).click();
  assert.equal(await workspace().locator('.eq-node-link').count(),0);
  await workspace().locator('.eq-breadcrumbs').getByRole('button',{name:'تجهیزات',exact:true}).click();
  await add('نوع تجهیز','فایروال');await card('فایروال');
  await add('دسته','سایت آزمایشی');await card('سایت آزمایشی');
  await add('زیر‌بخش','اتاق شبکه');await card('اتاق شبکه');
  await add('نود','نود تست فایروال','192.168.1.10');
  const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
  assert.ok(storage.includes('نود تست فایروال'));
  for(const secret of ['fake-radius-user-987','fake-radius-secret-987'])assert.ok(!storage.includes(secret));
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
async function openEquipment(){
  if(!await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await page.locator('[data-act="toggle-sidebar"]').click();
  await page.locator('.tab-btn[data-view="equipment"]').click();
}
test('RADIUS stays active across dashboard, other tabs and repeated equipment clicks',async()=>{
  await page.getByRole('button',{name:'← داشبورد FAM',exact:true}).click();
  await openEquipment();
  assert.equal(await page.locator('#equipment-radius-password').count(),0);
  assert.match(await workspace().innerText(),/RADIUS آماده است/);
  assert.match(await workspace().innerText(),/نود تست فایروال/);
  await page.locator('.tab-btn[data-view="equipment"]').click();
  assert.equal(await page.locator('#equipment-radius-password').count(),0);
  await page.locator('.tab-btn[data-view="log"]').click();await openEquipment();
  assert.equal(await page.locator('#equipment-radius-password').count(),0);
  const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
  for(const secret of ['fake-radius-user-987','fake-radius-secret-987'])assert.ok(!storage.includes(secret));
});
test('main FAM logout ends RADIUS; inventory survives a fresh main login',async()=>{
  await page.locator('#stat-line').click();
  await page.locator('#account-logout').click();
  await page.locator('#auth-username').waitFor();
  await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>Access.current()&&document.documentElement.dataset.famReady==='true');await openEquipment();
  assert.ok(await page.locator('#equipment-radius-password').isVisible());
  assert.equal(await workspace().locator('.eq-card-main').count(),0);
  await radius();assert.ok((await workspace().innerText()).includes('فایروال'));
});
test('refresh forgets RAM-only credentials; dark and light mobile layouts fit',async()=>{
  await page.reload();await page.waitForFunction(()=>Access.current()&&document.documentElement.dataset.famReady==='true');await openEquipment();
  assert.ok(await page.locator('#equipment-radius-password').isVisible());await radius();
  assert.ok((await workspace().innerText()).includes('فایروال'));
  await page.setViewportSize({width:390,height:844});
  for(const theme of ['original','light']){
    await page.evaluate(theme=>FamTheme.set(theme),theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('#equipment-radius-password').count(),0);
  }
  await page.screenshot({path:'/tmp/fam-equipment-mobile-light.png',fullPage:true});
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
