/* Focused browser checks for the standalone custom-permission release. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const root=path.resolve(__dirname,'..');let browser,server,page,url,errors=[];

async function login(user='admin',password='1109'){
  await page.locator('#auth-username').fill(user);await page.locator('#auth-password').fill(password);await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>Access.current()&&!document.documentElement.classList.contains('auth-pending'));
}
async function manager(){await page.locator('#stat-line').click();await page.locator('#account-manage').click();}

before(async()=>{
  const libs=path.join(root,'.cache/chromium-libs');fs.mkdirSync(libs,{recursive:true});
  if(!process.env.CHROMIUM_PATH){const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});process.env.LD_LIBRARY_PATH=[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');}
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'FAM.html')));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/FAM.html`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>a!=='--disable-web-security'),headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});

test('dynamic user form stores IDs, enforces scope, tracks category changes, and paints requested controls',async()=>{
  await page.goto(url);await page.locator('#auth-password').waitFor();await login();
  await page.evaluate(()=>importValidatedSheets(['شبکه آزمایشی','تهران','فارس'],{
    'شبکه آزمایشی':{rows:[['ID','Name'],['N1','NETWORK']],merges:[]},
    'تهران':{rows:[['ID','Name'],['T1','TEHRAN']],merges:[]},
    'فارس':{rows:[['ID','Name'],['F1','FARS']],merges:[]}
  },'scope.xlsx',true));
  const tehranRegion=await page.evaluate(()=>provinceOf('تهران').region);
  await manager();await page.locator('#user-new').click();
  assert.equal(await page.locator('#user-role').count(),0);
  assert.equal(await page.locator('#user-delete').count(),0);
  assert.ok(await page.locator('#user-scopes').evaluate(e=>e.compareDocumentPosition(document.getElementById('user-permissions'))&Node.DOCUMENT_POSITION_FOLLOWING));
  for(const category of ['provinces','datacenters','services','carriers','equipment','costs','other'])assert.equal(await page.locator(`[data-user-category="${category}"]`).count(),1,category);
  assert.equal(await page.locator(`[data-user-region="${tehranRegion}"]`).isDisabled(),true);
  await page.locator('[data-user-category="provinces"]').check();
  await page.locator(`[data-user-region="${tehranRegion}"]`).check();
  await page.locator('[data-user-category="services"]').check();
  for(const capability of ['view-sheets','search','edit-cells'])await page.locator(`[data-user-permission="${capability}"]`).check();
  await page.locator('#user-username').fill('scoped-user');await page.locator('#user-name').fill('کاربر محدوده');await page.locator('#user-password').fill('1109');await page.locator('#user-save').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.some(u=>u.username==='scoped-user'));
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.find(u=>u.username==='scoped-user'));
  assert.deepEqual(stored.categories.sort(),['provinces','services']);assert.deepEqual(stored.permissions.sort(),['edit-cells','search','view-sheets']);assert.deepEqual(stored.regions,[tehranRegion]);
  await page.locator('#user-'+stored.id).click();
  const themeControls=await page.evaluate(()=>{FamTheme.set('light');const c=getComputedStyle(document.getElementById('user-cancel')),d=getComputedStyle(document.getElementById('user-delete'));const b=document.getElementById('user-delete').getBoundingClientRect(),p=document.querySelector('.category-editor').getBoundingClientRect();return {cancel:c.backgroundColor,deleteBg:d.backgroundColor,deleteColor:d.color,compact:b.width<p.width};});
  assert.notEqual(themeControls.cancel,'rgba(0, 0, 0, 0)');assert.equal(themeControls.deleteColor,'rgb(17, 17, 17)');assert.equal(themeControls.compact,true);
  await page.locator('#users-done').click();await page.locator('#stat-line').click();await page.locator('#account-logout').click();await page.locator('#auth-password').waitFor();
  await login('scoped-user');
  assert.deepEqual(await page.evaluate(()=>[Access.can('read','شبکه آزمایشی'),Access.can('manual','شبکه آزمایشی'),Access.can('read','تهران'),Access.can('read','فارس')]),[true,true,true,false]);
  const dynamic=await page.evaluate(()=>{
    const config=defaultCategoryConfig();const services=config.categories.find(c=>c.id==='services');services.name='نام جدید سرویس‌ها';
    state.categoryConfig=config;const renamed=[categoryOf('شبکه آزمایشی').name,Access.can('read','شبکه آزمایشی')];
    config.assignments=[['شبکه آزمایشی','datacenters']];const moved=Access.can('read','شبکه آزمایشی');
    return {renamed,moved};
  });
  assert.deepEqual(dynamic,{renamed:['نام جدید سرویس‌ها',true],moved:false});
  assert.deepEqual(errors,[]);
});
