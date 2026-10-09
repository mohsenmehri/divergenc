/* Local HTML account/permission integration tests. These exercise supported UI
   and operation entry points, not a claim of protection against DevTools. */
const {test,before,beforeEach,afterEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),password='local-test-1109';
let browser,server,page,context,url,errors=[];
before(async()=>{
  const dir=path.join(root,'.cache/chromium-libs');fs.mkdirSync(dir,{recursive:true});
  if(!process.env.CHROMIUM_PATH){
    const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
    execFileSync('tar',['xf','-','-C',dir],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
    process.env.LD_LIBRARY_PATH=[path.join(dir,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'FAM.html')));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/FAM.html`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>a!=='--disable-web-security'),headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
});
beforeEach(async()=>{
  errors=[];
  if(page.url().startsWith(url))await page.evaluate(async()=>{await flushDeepSave();await idbDelete();localStorage.clear();sessionStorage.clear();});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(url);await page.locator('#auth-password').waitFor();
});
afterEach(async()=>{for(const tab of context.pages())if(tab!==page)await tab.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function setup(){
  await page.locator('#auth-name').fill('مدیر اولیه');
  await page.locator('#auth-password').fill(password);await page.locator('#auth-confirm').fill(password);
  await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.querySelector('#cp-c9 option')&&Access.current()?.role===1);
}
async function fixture(){
  assert.equal(await page.evaluate(()=>{
    const sheets={
      'تهران':{rows:[['کد','نام'],['T1','TEHRAN-ONLY']],merges:[]},
      'فارس':{rows:[['کد','نام'],['F1','FARS-SECRET']],merges:[]},
      'Network Test':{rows:[['ID','Name'],['A1','ALPHA']],merges:[]},
      [ARCHIVE_MAIN]:{rows:[['ID','Name']],merges:[]}
    };
    return importValidatedSheets(Object.keys(sheets),sheets,'test.xlsx',true);
  }),true);
  await page.evaluate(()=>flushDeepSave());
}
async function manager(){await page.locator('#stat-line').click();await page.locator('#account-manage').click();}
async function createUser(role,username='user'+role,regions=[],sheets=[]){
  await manager();await page.locator('#user-new').click();
  await page.locator('#user-username').fill(username);await page.locator('#user-name').fill('کاربر '+role);
  await page.locator('#user-password').fill(password);await page.locator('#user-role').selectOption(String(role));
  for(const id of regions)await page.locator(`[data-user-region="${id}"]`).check();
  for(const name of sheets)await page.locator(`[data-user-sheet="${name}"]`).check();
  await page.locator('#user-save').click();
  await page.waitForFunction(name=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.some(u=>u.username===name),username);
  await page.locator('#users-done').click();
}
async function logout(){
  if(await page.locator('#access-viewer').count())await page.getByRole('button',{name:'حساب کاربری / خروج'}).click();
  else await page.locator('#stat-line').click();
  await page.locator('#account-logout').click();await page.locator('#auth-username').waitFor();
}
async function login(username,secret=password){
  await page.locator('#auth-username').fill(username);await page.locator('#auth-password').fill(secret);await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>Access.current()&&!document.documentElement.classList.contains('auth-pending'));
  if(username!=='user4')await page.waitForFunction(()=>document.querySelector('#cp-c9 option'));
}
const modal=id=>page.locator(`#modal-overlay.show button[data-id="${id}"]`);

test('first-run gate, password hashing, failed login, reload session and logout',async()=>{
  assert.equal(await page.locator('#layout').isVisible(),false);
  assert.equal(await page.locator('#auth-password').getAttribute('type'),'password');
  await page.locator('#auth-password').fill(password);await page.locator('#auth-confirm').fill('different');await page.locator('#auth-submit').click();
  await page.locator('#auth-error').filter({hasText:'مطابقت'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('fam.accounts.v1')),null);
  await setup();
  const stored=await page.evaluate(()=>localStorage.getItem('fam.accounts.v1'));assert.ok(!stored.includes(password));
  const account=JSON.parse(stored).users[0];assert.equal(account.hash.length,64);assert.equal(account.salt.length,32);
  assert.equal(account.role,1);
  await page.reload();await page.locator('#stat-line').waitFor();assert.equal(await page.locator('#auth-screen').count(),0);
  await logout();assert.equal(await page.locator('#layout').isVisible(),false);
  await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('wrong');await page.locator('#auth-submit').click();
  await page.locator('#auth-error').filter({hasText:'نادرست'}).waitFor();assert.equal(await page.locator('#layout').isVisible(),false);
  await login('admin');
  const tab=await context.newPage();await tab.goto(url);await tab.locator('#auth-password').waitFor();assert.equal(await tab.locator('#layout').isVisible(),false);await tab.close();
});

test('user manager rejects duplicates and loss of last administrator, no passwords in data backups',async()=>{
  await setup();await manager();
  await page.locator('#user-role').selectOption('2');await page.locator('#user-save').click();
  await page.locator('#user-error').filter({hasText:'حداقل یک مدیر'}).waitFor();
  await page.locator('#user-role').selectOption('1');await page.locator('#user-enabled').uncheck();await page.locator('#user-save').click();
  await page.locator('#user-error').filter({hasText:'حداقل یک مدیر'}).waitFor();
  page.once('dialog',d=>d.accept());await page.locator('#user-delete').click();
  await page.locator('#user-error').filter({hasText:'حداقل یک مدیر'}).waitFor();
  await page.locator('#user-new').click();await page.locator('#user-username').fill(' ADMIN ');await page.locator('#user-name').fill('duplicate');await page.locator('#user-password').fill(password);await page.locator('#user-save').click();
  await page.locator('#user-error').filter({hasText:'قبلاً ثبت'}).waitFor();
  await page.locator('#users-done').click();
  const download=page.waitForEvent('download');await page.evaluate(()=>backupAll());const d=await download;
  const payload=fs.readFileSync(await d.path(),'utf8');assert.doesNotMatch(payload,/fam\.accounts|"hash"|"salt"/);assert.ok(!payload.includes(password));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.length),1);
});

test('level 2 edits cells and results, imports/exports, but cannot manage users',async()=>{
  await setup();await fixture();await createUser(2);await logout();await login('user2');
  await page.locator('#stat-line').click();assert.equal(await page.locator('#account-manage').count(),0);await modal(1).click();
  await page.evaluate(()=>Access.manageUsers());assert.equal(await page.locator('#user-form').count(),0);
  assert.deepEqual(await page.evaluate(()=>['manual','admin','export','users'].map(p=>Access.can(p))),[true,true,true,false]);
  await page.evaluate(()=>{switchView('sheet');renderSheetView('Network Test');});
  const cell=page.locator('#sheet-body td[data-r="2"][data-c="2"]');await cell.fill('LEVEL-TWO');await cell.blur();
  assert.equal(await page.evaluate(()=>cellVal('Network Test',2,2,true)),'LEVEL-TWO');
  await page.evaluate(()=>{state.cp.C7='Network Test';state.cp.C9='FULLTEXT';state.cp.C11='LEVEL-TWO';void modSearchEngine.SearchRecords();});
  await page.locator('#results-body input.cell-in').first().waitFor();
  await page.locator('#results-body input.cell-in[data-ci="1"]').fill('RESULT-EDIT');
  await page.evaluate(()=>{void modSearchEngine.SaveChanges();});await modal(1).click();
  assert.equal(await page.evaluate(()=>cellVal('Network Test',2,2,true)),'RESULT-EDIT');
  assert.equal(await page.evaluate(()=>modImport.ImportCsv('level2.csv','ID,Name\n1,Works')),true);
  const download=page.waitForEvent('download');await page.evaluate(()=>ExportWorkbookXlsx());assert.ok((await download).suggestedFilename().endsWith('.xlsx'));
});

test('level 3 can search, insert and delete records but cannot manually edit or administer',async()=>{
  await setup();await fixture();await createUser(3);await logout();await login('user3');
  await page.evaluate(()=>{switchView('sheet');renderSheetView('Network Test');});
  assert.equal(await page.locator('#sheet-body [contenteditable]').count(),0);
  const before=await page.evaluate(()=>JSON.stringify(WB.sheets['Network Test']));
  await page.evaluate(async()=>{
    await modSearchEngine.SaveChanges();await modUndo.UndoLastRemove();manageCategories();manageRegions();Access.manageUsers();
    importValidatedSheets(['Bad'],{Bad:{rows:[['x'],['y']],merges:[]}},'bad.csv',true);
    applyJsonBackup('bad.json',{sheets:{},order:[]});resetToEmptyData(true);backupAll();ExportWorkbookXlsx();
    RunMacro('modConstantsTools.UnhideSystemSheets');RunMacroIndex('modUI','ProtectControlPanel');
    await modUI.UnprotectControlPanel();await modFixUnlock.UnlockDataSheets();
  });
  assert.equal(await page.locator('#modal-overlay.show').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['Network Test'])),before);
  assert.equal(await page.locator('[data-act="manage-categories"]:visible').count(),0);
  assert.equal(await page.locator('[data-act="open-file"]:visible').count(),0);
  await page.evaluate(()=>{state.cp.C7='Network Test';state.cp.C9='FULLTEXT';state.cp.C11='ALPHA';void modSearchEngine.SearchRecords();});
  await page.locator('#results-body .match-block[data-match]').waitFor();
  assert.equal(await page.locator('#results-body input').count(),0);
  await page.evaluate(()=>{state.cp.C16='Network Test';void modAddRecord.StartAddWizard();});
  await page.locator('.wizard-fields input[data-i="0"]').fill('A2');await page.locator('.wizard-fields input[data-i="1"]').fill('BETA');
  await page.locator('[data-a="ok"]').click();await modal(6).click();await modal(1).click();
  assert.equal(await page.evaluate(()=>WB.sheets['Network Test'].rows.some(r=>r[1]==='BETA')),true);
  await page.evaluate(()=>{state.cp.C23='Network Test';state.cp.C25='FULLTEXT';state.cp.C27='BETA';void modRemoveRecord.StartRemoveWizard();});
  await page.locator('#modal-input').fill('ALL');await modal(1).click();await page.locator('#modal-input').fill('1');await modal(1).click();await modal(1).click();
  assert.equal(await page.evaluate(()=>WB.sheets['Network Test'].rows.some(r=>r[1]==='BETA')),false);
  assert.equal(await page.evaluate(()=>WB.sheets[ARCHIVE_MAIN].rows.some(r=>r[1]==='BETA')),true);
  const persisted=await page.evaluate(async()=>{await flushDeepSave();return JSON.stringify(WB.sheets['Network Test']);});
  await page.reload();await page.locator('#stat-line').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['Network Test'])),persisted);
});

test('level 4 sees only exact allowed sheets intersected with their current regions; no writes or global dashboard',async()=>{
  await setup();await fixture();await createUser(4,'user4',['2'],['تهران','فارس','Network Test']);
  await logout();await login('user4');await page.locator('#access-viewer').waitFor();
  assert.equal(await page.locator('#layout').isVisible(),false);
  assert.deepEqual(await page.locator('[data-viewer-sheet]').evaluateAll(es=>es.map(e=>e.dataset.viewerSheet)),['تهران','Network Test']);
  assert.deepEqual(await page.locator('[data-viewer-region]').evaluateAll(es=>es.map(e=>e.dataset.viewerRegion)),['2']);
  await page.locator('[data-viewer-sheet="تهران"]').click();assert.match(await page.locator('#viewer-sheet-body').innerText(),/TEHRAN-ONLY/);
  assert.doesNotMatch(await page.locator('body').innerText(),/FARS-SECRET|فارس/);
  assert.equal(await page.locator('#access-viewer [contenteditable], #access-viewer input').count(),0);
  const before=await page.evaluate(()=>JSON.stringify(WB.sheets));
  await page.evaluate(async()=>{switchView('panel');renderSheetView('فارس');await modAddRecord.StartAddWizard();await modRemoveRecord.StartRemoveWizard();await modSearchEngine.SearchRecords();await modSearchEngine.SaveChanges();await modUndo.UndoLastRemove();manageRegions();manageCategories();Access.manageUsers();modImport.OpenFile();resetToEmptyData(true);backupAll();});
  assert.equal(await page.locator('#modal-overlay.show').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets)),before);
  // Metadata reassignment immediately revokes a provincial grant; a future backend
  // must apply the same intersection on every data query.
  await page.evaluate(()=>{state.regionConfig=defaultRegionConfig();const p=provinceOf('تهران');state.regionConfig.assignments=state.regionConfig.assignments.map(([id,r])=>[id,id===p.id?'4':r]);Access.renderViewer();});
  assert.equal(await page.locator('[data-viewer-sheet="تهران"]').count(),0);
  assert.equal(await page.locator('#viewer-sheet-body').innerText(),'');
  await page.reload();await page.locator('#access-viewer').waitFor();
});

test('empty level 4 grants mean no access, and another tab changing users revokes an existing session',async()=>{
  await setup();await fixture();await createUser(4);
  const admin=page;const reader=await context.newPage();await reader.goto(url);page=reader;await login('user4');
  await reader.locator('#access-viewer').waitFor();assert.equal(await reader.locator('[data-viewer-sheet]').count(),0);
  page=admin;await manager();const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.find(u=>u.username==='user4').id);
  await page.locator('#user-'+id).click();await page.locator('#user-enabled').uncheck();await page.locator('#user-save').click();
  await reader.locator('#auth-password').waitFor();assert.equal(await reader.locator('#access-viewer').count(),0);
  await reader.locator('#auth-username').fill('user4');await reader.locator('#auth-password').fill(password);await reader.locator('#auth-submit').click();
  await reader.locator('#auth-error').filter({hasText:'نادرست'}).waitFor();
});

test('corrupt account storage fails closed instead of replacing existing accounts',async()=>{
  await page.evaluate(()=>localStorage.setItem('fam.accounts.v1','{"version":1,"users":[]}'));await page.reload();
  await page.locator('#auth-screen').waitFor();assert.equal(await page.locator('#layout').isVisible(),false);
  assert.equal(await page.locator('#auth-submit').count(),0);assert.match(await page.locator('#auth-screen').innerText(),/قابل خواندن نیستند/);
});

test('brand stays frozen above the scrollable menu, English translation fits on one line',async()=>{
  await setup();await page.locator('[data-act="toggle-sidebar"]').click();
  assert.equal(await page.locator('.brand-sub').innerText(),'Melal E-Commerce & Information Technology (FAM)');
  for(const width of [1440,800,390,320]){
    await page.setViewportSize({width,height:650});
    await page.waitForFunction(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});
    const top=await page.locator('.brand').evaluate(e=>e.getBoundingClientRect().top);
    await page.locator('#sidebar-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);
    const geometry=await page.evaluate(()=>{
      const brand=document.querySelector('.brand'),sub=document.querySelector('.brand-sub'),scroll=document.getElementById('sidebar-scroll'),r=sub.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(sub);
      return {top:brand.getBoundingClientRect().top,scroll:scroll.scrollTop,lines:range.getClientRects().length,fit:sub.scrollWidth<=sub.clientWidth,all:document.documentElement.scrollWidth<=innerWidth};
    });
    assert.equal(geometry.top,top);assert.ok(geometry.scroll>0);assert.equal(geometry.lines,1);assert.ok(geometry.fit);assert.ok(geometry.all,JSON.stringify({width,...geometry}));
  }
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.setViewportSize({width:1440,height:900});await page.locator('#sidebar-scroll').evaluate(e=>e.scrollTop=200);
  await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=innerWidth);
  await page.locator('#sidebar').screenshot({path:path.join(root,'test-results/fam-sidebar-ui09.png'),animations:'disabled'});
});

test('administrator resets passwords, changes roles and deletes users without changing workbook rows',async()=>{
  await setup();await fixture();await createUser(3);
  const before=await page.evaluate(()=>JSON.stringify(WB.sheets['Network Test']));
  await manager();const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.find(u=>u.username==='user3').id);
  await page.locator('#user-'+id).click();await page.locator('#user-role').selectOption('2');await page.locator('#user-password').fill('replacement-1109');await page.locator('#user-save').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.find(u=>u.username==='user3').role===2);
  await page.locator('#users-done').click();await logout();
  await page.locator('#auth-username').fill('user3');await page.locator('#auth-password').fill(password);await page.locator('#auth-submit').click();await page.locator('#auth-error').filter({hasText:'نادرست'}).waitFor();
  await login('user3','replacement-1109');assert.equal(await page.evaluate(()=>Access.current().role),2);
  await logout();await login('admin');await manager();await page.locator('#user-'+id).click();
  page.once('dialog',d=>d.accept());await page.locator('#user-delete').click();
  assert.equal(await page.locator('#user-'+id).count(),0);await page.locator('#users-done').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['Network Test'])),before);
});

test('the deployed HTML embeds exactly one copy of each account source and remains standalone',async()=>{
  const html=fs.readFileSync(path.join(root,'FAM.html'),'utf8');
  for(const [ext,tag] of [['css','style'],['js','script']]){
    const matches=[...html.matchAll(new RegExp(`<${tag} id="fam-local-access-${ext}">\\n([\\s\\S]*?)</${tag}>`,'g'))];
    assert.equal(matches.length,1);assert.equal(matches[0][1],fs.readFileSync(path.join(root,`src/local-access.${ext}`),'utf8'));
  }
  assert.equal(await page.locator('script[src]').count(),0);
});
