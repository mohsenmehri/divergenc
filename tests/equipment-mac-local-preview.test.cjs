const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {launch,login}=require('./helpers/equipment-browser.cjs');let browser,page;const requests=[],errors=[];
const catalog={regions:[{id:'r1',name:'منطقه یک'},{id:'r2',name:'منطقه دو'}],siteKinds:[{id:'building',name:'ساختمان'},{id:'branch',name:'شعبه'}],sites:[{id:'s1',name:'ساختمان رضوان'},{id:'s2',name:'شعبه آزمایشی'}]};
const nodes=[{id:'a',name:'سوئیچ رضوان',host:'100.100.1.22',regionId:'r1',siteKindId:'building',siteId:'s1'},{id:'b',name:'سوئیچ شعبه',host:'100.108.1.22',regionId:'r2',siteKindId:'branch',siteId:'s2'},{id:'c',name:'سوئیچ رضوان',host:'100.107.1.22',regionId:'r1',siteKindId:'building',siteId:'s1'}];
before(async()=>{browser=await launch();});after(async()=>{await browser?.close();assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
async function setup(data=nodes){if(page)await page.close();page=await browser.newPage({viewport:{width:1100,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.setContent('<main id="mount"></main>');await page.addScriptTag({content:fs.readFileSync('src/equipment-mac-local-preview.js','utf8')});await page.addStyleTag({content:fs.readFileSync('src/equipment-mac-local-preview.css','utf8')});await page.evaluate(({data,catalog})=>{window.FamEquipmentInventory={privateIP:value=>{if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)||value.split('.').some(v=>+v>255))return false;const a=value.split('.').map(Number);return a[0]===10||a[0]===192&&a[1]===168||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===100&&a[1]>=64&&a[1]<=127;}};FamLocalPortPreview.mount(document.getElementById('mount'),data,catalog);},{data,catalog});}
async function select(ip='100.100.1.22'){await page.locator('#eq-local-mac-search').fill(ip);await page.locator('#eq-local-mac-search').press('Enter');}
const chosen=()=>page.locator('#eq-local-mac-switches .eq-live-switch-row');
test('one combo box opens region > building/branch > site > checkboxes; only selected rows appear below',async()=>{
 await setup();assert.equal(await chosen().count(),0);assert.equal(await page.locator('#eq-local-mac-dropdown').isHidden(),true);assert.equal(await page.locator('#eq-local-mac-host').count(),0);
 await page.locator('#eq-local-mac-search').click();await page.locator('[data-level=region][data-group=r1]').click();await page.locator('[data-level=kind][data-group=building]').click();await page.locator('[data-level=site][data-group=s1]').click();
 assert.equal(await page.locator('#eq-local-mac-dropdown input[type=checkbox]').count(),2);assert.doesNotMatch(await page.locator('#eq-local-mac-dropdown').textContent(),/100\.108/);
 await page.locator('[data-choice=a]').check();assert.equal(await chosen().count(),1);await page.locator('[data-choice=c]').check();assert.equal(await chosen().count(),2);
 await page.locator('#eq-local-mac-search').press('Escape');assert.equal(await page.locator('#eq-local-mac-dropdown').isHidden(),true);assert.equal(await page.locator('#eq-local-mac-search').getAttribute('aria-expanded'),'false');
});
test('search by IP or name, duplicate names require explicit tick; direct known IP deduplicates and preserves port',async()=>{
 await setup();await page.locator('#eq-local-mac-search').fill('سوئیچ رضوان');await page.locator('#eq-local-mac-search').press('Enter');assert.equal(await chosen().count(),0);assert.match(await page.locator('#eq-local-mac-feedback').textContent(),/نام مبهم/);
 await page.locator('[data-choice=a]').check();await page.locator('[data-port=a]').fill('7');await select();assert.equal(await chosen().count(),1);assert.equal(await page.locator('[data-port=a]').inputValue(),'7');
 await page.locator('#eq-local-mac-search').fill('100.108.1.22');await page.locator('[data-choice=b]').check();assert.equal(await chosen().count(),2);await page.locator('[data-remove=a]').click();assert.equal(await chosen().count(),1);
});
test('manual IP is in the same combo, private-only, max five, and unselect/remove does not keep history',async()=>{
 await setup([]);await page.locator('#eq-local-mac-search').fill('100.108.1.22');await page.locator('#eq-local-mac-add').click();assert.equal(await chosen().count(),1);
 await page.locator('#eq-local-mac-search').fill('100.108.1.22');await page.locator('#eq-local-mac-dropdown input[type=checkbox]').uncheck();assert.equal(await chosen().count(),0);
 await page.locator('#eq-local-mac-search').fill('100.108.1.22');assert.equal(await page.locator('#eq-local-mac-dropdown input[type=checkbox]').count(),0);
 await select('8.8.8.8');assert.equal(await chosen().count(),0);assert.match(await page.locator('#eq-local-mac-feedback').textContent(),/IP داخلی/);
 for(let n=1;n<=5;n++)await select('100.100.1.'+n);assert.equal(await chosen().count(),5);await select('100.100.1.6');assert.equal(await chosen().count(),5);assert.match(await page.locator('#eq-local-mac-feedback').textContent(),/حداکثر پنج/);
});
test('blank port and diagnosis help explain what is read-only, optional and not implemented',async()=>{
 await setup();await select();await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output').textContent(),/پورت خالی.*Err-disabled/);assert.match(await page.locator('#eq-local-mac-output').textContent(),/interface range/);assert.match(await page.locator('#eq-local-mac-output').textContent(),/نه قابلیت اجراشده/);
 await page.locator('#eq-local-diagnosis-help summary').click();assert.match(await page.locator('#eq-local-diagnosis-help').textContent(),/اگر کارشناس پورت را اعلام کرده/);assert.match(await page.locator('#eq-local-diagnosis-help').textContent(),/هیچ MAC، binding یا ACL را تغییر نمی‌دهد/);
});
test('ports 6 and 10 group on one switch, no extra ports; conflict cleanup precedes recovery and IPs stay unchanged',async()=>{
 await setup();await select();await page.locator('[data-port=a]').fill('۱۰، ۶');await page.locator('[data-static=a]').check();await page.locator('#eq-local-mac-review').click();const text=await page.locator('#eq-local-mac-output').textContent(),pre=await page.locator('#eq-local-mac-output pre').textContent();
 assert.match(pre,/interface range FastEthernet0\/6 , FastEthernet0\/10\nshutdown\nno shutdown/);assert.doesNotMatch(pre,/Ethernet0\/[789](?:,|\n|$)/);assert.match(text,/IPها بدون تغییر/);assert.ok(text.indexOf('حذف فقط همان رکورد')<text.indexOf('پس از رفع تعارض'));assert.match(text,/تأیید جابه‌جایی/);
 await select('100.108.1.22');await page.locator('[data-port=b]').fill('2,4');await page.locator('#eq-local-mac-review').click();const blocks=await page.locator('#eq-local-mac-output pre').allTextContents();assert.equal(blocks.length,2);assert.match(blocks[0],/0\/6 , FastEthernet0\/10/);assert.match(blocks[1],/0\/2 , FastEthernet0\/4/);
});
test('strict port validation, single port uses interface, edits invalidate preview, no static tick means no binding rewrite',async()=>{
 await setup();await select();for(const value of ['25','6-10','6,,10','6;reload','0','']){await page.locator('[data-port=a]').fill(value);await page.locator('#eq-local-mac-review').click();if(value)assert.equal(await page.locator('#eq-local-mac-output article').count(),0);}
 await page.locator('[data-port=a]').fill('7');await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output pre').textContent(),/interface FastEthernet0\/7/);assert.doesNotMatch(await page.locator('#eq-local-mac-output pre').textContent(),/interface range/);assert.match(await page.locator('#eq-local-mac-output').textContent(),/بازنویسی نمی‌شوند/);
 await page.locator('[data-port=a]').fill('6,10');assert.equal(await page.locator('#eq-local-mac-output article').count(),0);
 const parsed=await page.evaluate(()=>FamLocalPortPreview.ports('۱۰,۶,6'));assert.deepEqual(parsed,[6,10]);
});
test('classic range preview compacts only selected consecutive ports, splits over five clauses without filling gaps',async()=>{
 await setup();await select();await page.locator('[data-port=a]').fill('1,2,3,6,8,10,12,14,16');await page.locator('#eq-local-mac-review').click();const code=await page.locator('#eq-local-mac-output pre').textContent();
 assert.match(code,/FastEthernet0\/1 - 3/);const lines=code.split('\n').filter(line=>line.startsWith('interface range '));assert.equal(lines.length,2);const expanded=[];
 for(const line of lines){const clauses=line.replace('interface range ','').split(' , ');assert.ok(clauses.length<=5);for(const clause of clauses){const match=clause.match(/^FastEthernet0\/(\d+)(?: - (\d+))?$/);assert.ok(match);for(let n=+match[1];n<=+(match[2]||match[1]);n++)expanded.push(n);}}
 assert.deepEqual(expanded,[1,2,3,6,8,10,12,14,16]);
});
test('outside click closes picker; plain text prevents inventory names becoming HTML; narrow layout contains overflow',async()=>{
 await setup([{...nodes[0],name:'<img src=x onerror=alert(1)>'}]);await select();assert.equal(await page.locator('#eq-local-mac-preview img').count(),0);await page.locator('#eq-local-mac-search').click();await page.locator('#eq-local-mac-selection-count').click();assert.equal(await page.locator('#eq-local-mac-dropdown').isHidden(),true);
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
});
test('full file:// artifact login works, no credentials or HTTP, temporary selection resets on reload; SERVER untouched',async()=>{
 if(page)await page.close();page=await browser.newPage({viewport:{width:1440,height:1080}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 await page.goto(pathToFileURL(path.resolve('releases/FAM-Client-MAC-LOCAL-Preview.html')).href);await login(page);await page.locator('#equipment-tab-ports').click();assert.equal(await page.locator('input[type=password],#eq-live-scan').count(),0);const old=await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3'));
 await select();await page.locator('#eq-local-mac-switches input[data-port]').fill('6,10');await page.locator('#eq-local-mac-review').click();assert.match(await page.locator('#eq-local-mac-output pre').textContent(),/interface range/);assert.equal(await page.evaluate(()=>localStorage.getItem('fam.equipment.inventory.v3')),old);
 for(const theme of ['original','light'])for(const width of [390,768,1440]){await page.evaluate(t=>document.documentElement.dataset.uiTheme=t,theme);await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
 await page.reload();await page.locator('#workspace-enter-equipment').click();await page.locator('#equipment-tab-ports').click();assert.equal(await chosen().count(),0);assert.equal(await page.locator('#eq-local-mac-output article').count(),0);
 for(const file of ['FAM.html','server/private_ui/FAM.html'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fam-local-mac-preview-js/);
 assert.doesNotMatch(fs.readFileSync('src/equipment-mac-local-preview.js','utf8'),/fetch\(|XMLHttpRequest|FamShared|localStorage|sessionStorage/);
});
