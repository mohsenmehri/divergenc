/* Actual standalone UI, embedded artwork only; no network or real devices. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {launch}=require('./helpers/equipment-browser.cjs');
const TITLE='تجارت الکترونیک و فناوری اطلاعات ملل (فام)';
let browser,page;const errors=[],requests=[];
before(async()=>{
 browser=await launch();page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 await page.goto(pathToFileURL(path.resolve('FAM.html')).href);
});
after(async()=>browser?.close());
const artwork=selector=>page.locator(selector).evaluate(img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0}));
test('login uses the exact offline sidebar logo with the full company name beneath it',async()=>{
 await page.locator('.access-login .fam-brand-art').waitFor();
 await page.waitForFunction(()=>document.querySelector('.access-login .fam-brand-art').naturalWidth>0);
 const logo=await artwork('.access-login .fam-brand-art'),original=await artwork('#sidebar .brand-logo img');
 assert.equal(logo.src,original.src);assert.equal(logo.loaded,true);
 assert.equal(await page.locator('.access-login .fam-brand-caption').textContent(),TITLE);
 assert.match(await page.locator('.access-login .hint').textContent(),/جای امنیت سمت سرور/);
 assert.equal(await page.evaluate(()=>FamTheme.current()),'original');
 fs.mkdirSync('.cache/branding-preview',{recursive:true});await page.screenshot({path:'.cache/branding-preview/login.png'});
 for(const theme of ['light','original']){
  await page.evaluate(t=>FamTheme.set(t),theme);
  assert.equal(await page.locator('.access-login .fam-brand-caption').evaluate(n=>getComputedStyle(n).color),theme==='light'?'rgb(25, 45, 66)':'rgb(244, 238, 225)');
 }
});
test('login automatically opens the branded chooser with both workspaces enabled',async()=>{
 await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
 await page.waitForFunction(()=>document.documentElement.dataset.famReady==='true');
 await page.locator('#workspace-launcher[open]').waitFor();
 assert.equal(await page.locator('#workspace-launcher .fam-brand-caption').textContent(),TITLE);
 assert.equal((await artwork('#workspace-launcher .fam-brand-art')).src,(await artwork('#sidebar .brand-logo img')).src);
 assert.equal(await page.locator('#workspace-enter-panel').isEnabled(),true);assert.equal(await page.locator('#workspace-enter-equipment').isEnabled(),true);
 assert.equal(await page.locator('.workspace-kicker').count(),0);
 await page.screenshot({path:'.cache/branding-preview/chooser.png'});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.locator('#workspace-launcher').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'chooser overflow '+width);
  assert.ok(await page.locator('.fam-brand-workspace').evaluate(n=>n.getBoundingClientRect().width<=innerWidth));
 }
});
test('equipment shares dashboard background and FX without changing the account or inventory',async()=>{
 await page.setViewportSize({width:1440,height:1000});await page.locator('#workspace-enter-panel').click();
 const paint=()=>page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,fx:getComputedStyle(document.getElementById('fx-stage')).display,opacity:getComputedStyle(document.getElementById('fx-stage')).opacity,glow:getComputedStyle(document.body,'::before').opacity}));
 const baseline=await paint(),user=await page.evaluate(()=>Access.current().id),inventory=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3'));
 assert.notEqual(baseline.fx,'none');
 await page.evaluate(()=>FamWorkspaceLauncher.show());await page.locator('#workspace-enter-equipment').click();await page.locator('#equipment-workspace').waitFor();
 assert.deepEqual(await paint(),baseline);
 assert.equal(await page.locator('#view-equipment').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await page.locator('#equipment-workspace').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await page.evaluate(()=>Access.current().id),user);
 assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),inventory);
 await page.screenshot({path:'.cache/branding-preview/equipment.png'});
 await page.evaluate(()=>FamTheme.set('light'));assert.equal((await paint()).opacity,'0');
 await page.evaluate(()=>FamWorkspaceLauncher.show());await page.locator('#workspace-enter-panel').click();const light=await paint();
 await page.evaluate(()=>FamWorkspaceLauncher.show());await page.locator('#workspace-enter-equipment').click();assert.deepEqual(await paint(),light);
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
});
test('branding sources are embedded and the static central login retains its script policy',()=>{
 const html=fs.readFileSync('FAM.html','utf8'),central=fs.readFileSync('server/private_ui/FAM.html','utf8');
 for(const content of [html,central]){
  assert.ok(content.includes(fs.readFileSync('src/fam-brand.js','utf8')));assert.ok(content.includes(fs.readFileSync('src/fam-brand.css','utf8')));
 }
 const login=fs.readFileSync('server/www/login.html','utf8');assert.ok(login.includes(TITLE));assert.match(login,/class="login-brand"/);assert.match(login,/img-src 'self' data:/);assert.match(login,/script-src 'self';/);assert.doesNotMatch(login,/unsafe-inline/);
});
