/* Local HTML account/permission integration tests. These exercise supported UI
   and operation entry points, not a claim of protection against DevTools. */
const {test,before,beforeEach,afterEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),password='1109';
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
  await page.locator('#auth-username').fill('admin');
  await page.locator('#auth-password').fill(password);
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

test('preset admin gate, password hashing, failed login, reload session and logout',async()=>{
  assert.equal(await page.locator('#layout').isVisible(),false);
  assert.equal(await page.locator('#auth-password').getAttribute('type'),'password');
  assert.equal(await page.locator('#auth-confirm').count(),0);
  assert.doesNotMatch(await page.locator('#auth-screen').innerText(),/1109/);
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
    await page.waitForFunction(()=>{const e=document.querySelector('.brand-sub');return e.scrollWidth<=e.clientWidth+1;});
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
  for(const [module,ext,tag] of [['local-access','css','style'],['local-access','js','script'],['province-records','js','script']]){
    const matches=[...html.matchAll(new RegExp(`<${tag} id="fam-${module}-${ext}">\\n([\\s\\S]*?)</${tag}>`,'g'))];
    assert.equal(matches.length,1);assert.equal(matches[0][1],fs.readFileSync(path.join(root,`src/${module}.${ext}`),'utf8'));
  }
  assert.equal(await page.locator('script[src]').count(),0);
});

async function provincialFixture(){
  await page.evaluate(()=>importValidatedSheets(['استان تهران','فارس'],{
    'استان تهران':{rows:[['شاخص',null,'نام','IP'],['T1',null,'OLD-BRANCH','10.0.0.1'],['شبکه خودپرداز'],['LEGACY-ATM',null,'PRESERVED'],['جمع']],merges:[]},
    'فارس':{rows:[['کد','نام فارس'],['F1','FARS-UNCHANGED']],merges:[]}
  },'provincial.xlsx',true));
}
async function beginProvincial(name,section){
  await page.evaluate(()=>switchView('panel'));await page.locator('#cp-c16').selectOption(name);
  await page.locator('#fold-ops [data-arg="modAddRecord.StartAddWizard"]').click();
  await page.locator(`[data-p="${section}"]`).click();
}
async function finishProvincial(values){
  for(let i=0;i<values.length;i++)await page.locator(`.wizard-fields input[data-i="${i}"]`).fill(values[i]);
  await page.locator('[data-a="ok"]').click();await modal(6).click();await modal(1).click();
  await page.waitForFunction(()=>!document.querySelector('#modal-overlay.show'));
}

test('province Add routes Branch and ATM into distinct sheets with matching headers, no historic data splitting',async()=>{
  await setup();await provincialFixture();
  const original=await page.evaluate(()=>JSON.stringify(WB.sheets['استان تهران']));
  await beginProvincial('استان تهران','atm');
  assert.deepEqual(await page.locator('.wizard-fields label').allTextContents(),['شاخص','نام','IP']);
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  await finishProvincial(['ATM-NEW','ATM-ONLY','10.0.0.2']);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['استان تهران'])),original);
  assert.deepEqual(await page.evaluate(()=>WB.sheets['خودپرداز تهران'].rows),[['شاخص',null,'نام','IP'],['ATM-NEW',null,'ATM-ONLY','10.0.0.2']]);
  assert.deepEqual(await page.evaluate(()=>state.provinceView),{province:'2-1',section:'atm'});
  assert.match(await page.locator('#sheet-title').innerText(),/خودپرداز/);
  assert.equal(await page.evaluate(()=>modMapping.GetMatchRows('FULLTEXT','ATM-ONLY','خودپرداز تهران').length),1);
  // Repeated ATM adds use the existing destination, not another sheet or header.
  await beginProvincial('استان تهران','atm');await finishProvincial(['ATM-SECOND','ATM-SECOND','10.0.0.3']);
  assert.equal(await page.evaluate(()=>WB.order.filter(n=>n==='خودپرداز تهران').length),1);
  assert.equal(await page.evaluate(()=>WB.sheets['خودپرداز تهران'].rows.length),3);
  const atm=await page.evaluate(()=>JSON.stringify(WB.sheets['خودپرداز تهران']));
  // Selecting the ATM source but choosing Branch still routes back to Branch.
  await beginProvincial('خودپرداز تهران','branch');await finishProvincial(['BR-NEW','BRANCH-ONLY','10.0.0.4']);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['خودپرداز تهران'])),atm);
  assert.deepEqual(await page.evaluate(()=>WB.sheets['استان تهران'].rows.filter(r=>r[0]!=='BR-NEW')),JSON.parse(original).rows);
  assert.equal(await page.evaluate(()=>WB.sheets['استان تهران'].rows.at(-1)[0]),'جمع');
  assert.deepEqual(await page.evaluate(()=>WB.sheets['فارس'].rows),[['کد','نام فارس'],['F1','FARS-UNCHANGED']]);
  await page.evaluate(()=>openProvinceSection('2-1','atm',false));assert.match(await page.locator('#sheet-body').innerText(),/ATM-ONLY/);assert.doesNotMatch(await page.locator('#sheet-body').innerText(),/BRANCH-ONLY/);
  await page.evaluate(()=>{saveState();saveUIState();return flushDeepSave();});await page.reload();await page.locator('#stat-line').waitFor();
  assert.deepEqual(await page.evaluate(()=>state.provinceView),{province:'2-1',section:'atm'});
  assert.match(await page.locator('#sheet-body').innerText(),/ATM-SECOND/);
});

test('cancelling provincial add, blank input and cancelled confirmation create no sheets or records',async()=>{
  await setup();await provincialFixture();const before=await page.evaluate(()=>JSON.stringify(WB.sheets['استان تهران']));
  await beginProvincial('استان تهران','atm');await page.locator('[data-a="cancel"]').click();
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  await beginProvincial('استان تهران','atm');await page.locator('[data-a="ok"]').click();await modal(1).click();
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  await beginProvincial('استان تهران','atm');await page.locator('.wizard-fields input').first().fill('CANCELLED');await page.locator('[data-a="ok"]').click();await modal(7).click();
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['استان تهران'])),before);
});

test('ATM routing survives JSON and Excel round trips and recognizes all province aliases',async()=>{
  await setup();await provincialFixture();await beginProvincial('فارس','atm');await finishProvincial(['FATM1','FARS-ATM']);
  const saved=await page.evaluate(()=>JSON.stringify(WB.sheets['خودپرداز فارس']));
  const roundtrip=await page.evaluate(()=>{
    const json={order:WB.order,sheets:WB.sheets,regionConfig:state.regionConfig,categoryConfig:state.categoryConfig};
    if(!applyJsonBackup('roundtrip.json',JSON.parse(JSON.stringify(json))))return false;
    const excel=BuildExportWorkbook();const buf=XLSX.write(excel,{type:'array',bookType:'xlsx'});
    return modImport.ImportExcel('roundtrip.xlsx',buf);
  });
  assert.equal(roundtrip,true);
  assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['خودپرداز فارس'])),saved);
  assert.deepEqual(await page.evaluate(()=>[provinceOf('خودپرداز فارس').id,categoryOf('خودپرداز فارس').id,provinceSheets('4-1','atm')]),['4-1','provinces',['خودپرداز فارس']]);
  assert.equal(await page.evaluate(()=>PROVINCES.every(p=>provinceSheetInfo('خودپرداز '+p.name)?.province.id===p.id&&('خودپرداز '+p.name).length<=31)),true);
  assert.equal(await page.evaluate(()=>provinceSheetInfo('خودپرداز کهکلویه').province.name),'کهگیلویه و بویراحمد');
});

test('level 3 can create an ATM destination only through confirmed record insertion; level 4 cannot inherit it',async()=>{
  await setup();await provincialFixture();await createUser(3);await createUser(4,'user4',['2'],['استان تهران']);await logout();await login('user3');
  await beginProvincial('استان تهران','atm');await finishProvincial(['LEVEL3ATM','RECORD','1.2.3.4']);
  assert.equal(await page.locator('#sheet-body [contenteditable]').count(),0);
  assert.equal(await page.evaluate(()=>WB.sheets[LOG_SHEET].rows.some(r=>r[1]==='ADD'&&r[2]==='خودپرداز تهران'&&r[4]==='کاربر 3')),true);
  await logout();await login('user4');await page.locator('#access-viewer').waitFor();
  assert.equal(await page.locator('[data-viewer-sheet="خودپرداز تهران"]').count(),0);
  assert.equal(await page.evaluate(()=>Access.can('read','خودپرداز تهران')),false);
  await page.evaluate(()=>startProvinceAdd('استان تهران'));assert.equal(await page.locator('[data-p="atm"]').count(),0);
});

test('UI-09 account migration sets the requested admin once and preserves other users and later password changes',async()=>{
  await setup();await fixture();await createUser(3);
  await page.evaluate(()=>{
    const accounts=JSON.parse(localStorage.getItem('fam.accounts.v1'));delete accounts.adminPresetVersion;
    const a=accounts.users.find(u=>u.role===1);a.username='old-owner';a.name='old-owner';a.hash='0'.repeat(64);
    localStorage.setItem('fam.accounts.v1',JSON.stringify(accounts));
  });
  await page.reload();await page.locator('#auth-password').waitFor();await login('admin');
  assert.equal(await page.evaluate(()=>Access.current().role),1);assert.equal(await page.locator('#st-user').innerText(),'admin');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.some(u=>u.username==='user3')),true);
  await manager();await page.locator('#user-password').fill('changed-admin-secret');await page.locator('#user-save').click();await page.locator('#users-done').click();
  await logout();await login('admin','changed-admin-secret');await page.reload();await page.locator('#stat-line').waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).adminPresetVersion),1);
  assert.equal(await page.evaluate(()=>WB.sheets['Network Test'].rows[1][1]),'ALPHA');
});

test('ATM template preserves header columns and header merges without copying records or data merges',async()=>{
  await setup();await page.evaluate(()=>importValidatedSheets(['استان تهران'],{
    'استان تهران':{rows:[['شاخص','نام',null,'IP'],['OLD','KEEP',null,'1.1.1.1'],[null,'KEEP2']],merges:[{r1:1,r2:1,c1:2,c2:3},{r1:2,r2:3,c1:1,c2:1}]}
  },'merges.xlsx',true));
  await beginProvincial('استان تهران','atm');await finishProvincial(['NEW','ATM','2.2.2.2']);
  assert.deepEqual(await page.evaluate(()=>WB.sheets['خودپرداز تهران']),{rows:[['شاخص','نام',null,'IP'],['NEW','ATM',null,'2.2.2.2']],merges:[{r1:1,r2:1,c1:2,c2:3}]});
  assert.equal(await page.locator('#sheet-body td[data-r="1"][data-c="2"]').getAttribute('colspan'),'2');
});

test('provincial add rejects changed templates and rolls back a failed destination write',async()=>{
  await setup();await provincialFixture();
  await beginProvincial('استان تهران','atm');await page.locator('.wizard-fields input').first().fill('STALE');await page.locator('[data-a="ok"]').click();
  await page.evaluate(()=>{WB.sheets['استان تهران'].rows[0][0]='شناسه جدید';});await modal(6).click();
  await page.locator('#modal-overlay').getByText(/در حین ورود اطلاعات تغییر/).waitFor();await modal(1).click();
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  await beginProvincial('استان تهران','atm');await page.locator('.wizard-fields input').first().fill('ROLLBACK');await page.locator('[data-a="ok"]').click();
  await page.evaluate(()=>{window.originalSetCellVal=setCellVal;setCellVal=()=>{throw Error('injected write failure');};});await modal(6).click();
  await page.waitForFunction(()=>!document.querySelector('#modal-overlay.show'));
  assert.equal(await page.evaluate(()=>SheetExists('خودپرداز تهران')),false);
  await page.evaluate(()=>{setCellVal=window.originalSetCellVal;delete window.originalSetCellVal;});
  assert.equal(await page.evaluate(()=>WB.sheets[CFG_SHEET].rows.some(r=>r[0]==='خودپرداز تهران')),false);
});

test('UI-11 keeps the complete Persian brand on one line and category labels centered without reports',async()=>{
  await setup();await fixture();await page.locator('[data-act="toggle-sidebar"]').click();
  for(const width of [1440,800,390,320]){
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});
    await page.waitForFunction(()=>{const e=document.querySelector('.brand-name');return e.scrollWidth<=e.clientWidth+1;});
    const brand=await page.locator('.brand-name').evaluate(e=>{
      const range=document.createRange();range.selectNodeContents(e);
      return {width:e.clientWidth,scroll:e.scrollWidth,tops:[...range.getClientRects()].map(r=>Math.round(r.top)),height:e.clientHeight,line:parseFloat(getComputedStyle(e).lineHeight)};
    });
    assert.ok(brand.scroll<=brand.width+1,JSON.stringify({width,...brand}));
    assert.ok(brand.height<=brand.line+1,JSON.stringify({width,...brand}));
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-act="toggle-sidebar"]').click();
  assert.equal(await page.locator('#dash-cats .ct-meta').count(),0);
  assert.doesNotMatch(await page.locator('#dash-cats').innerText(),/رکورد|[a-z]/i);
  const cards=await page.locator('#dash-cats .cat-tile').evaluateAll(es=>es.map(e=>{
    const r=e.getBoundingClientRect(),g=e.querySelector('.ct-content').getBoundingClientRect(),i=e.querySelector('.ct-ico').getBoundingClientRect(),t=e.querySelector('.ct-name').getBoundingClientRect(),v=e.querySelector('.ct-val').getBoundingClientRect();
    return {name:e.dataset.cat,dx:Math.abs(g.x+g.width/2-r.x-r.width/2),dy:Math.abs(g.y+g.height/2-r.y-r.height/2),ix:Math.abs(i.x+i.width/2-r.x-r.width/2),tx:Math.abs(t.x+t.width/2-r.x-r.width/2),countLeft:v.left-r.left,countTop:v.top-r.top,title:e.title};
  }));
  for(const card of cards){
    assert.ok(card.dx<=1&&card.dy<=1&&card.ix<=1&&card.tx<=1,JSON.stringify(card));
    assert.ok(Math.abs(card.countLeft-9)<=1&&Math.abs(card.countTop-9)<=1,JSON.stringify(card));
    assert.doesNotMatch(card.title,/رکورد/);
  }
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.locator('#dash-cats').screenshot({path:path.join(root,'test-results/fam-categories-ui11.png'),animations:'disabled'});
  await page.locator('[data-act="toggle-sidebar"]').click();
  await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=innerWidth);
  await page.locator('.brand').screenshot({path:path.join(root,'test-results/fam-brand-ui11.png'),animations:'disabled'});
});

test('UI-12 Persian controls, removed captions and new glass logo retain working actions',async()=>{
  await setup();await fixture();
  assert.equal(await page.locator('#view-panel .eyebrow').count(),0);
  assert.equal(await page.locator('#fold-ops .dash-note').count(),0);
  assert.equal(await page.locator('#quick-search .dash-note').count(),0);
  const expected=[['modSearchEngine.SearchRecords','جستجو'],['modAddRecord.StartAddWizard','اضافه کردن داده'],['modRemoveRecord.StartRemoveWizard','پاک کردن داده'],['modUndo.UndoLastRemove','برگشت']];
  for(const [action,label] of expected)assert.equal((await page.locator(`#fold-ops [data-arg="${action}"]`).innerText()).trim(),label);
  assert.equal(await page.locator('#fold-ops h3').nth(1).innerText(),'افزودن داده');
  for(const e of await page.locator('[data-act="export-xlsx"], [data-arg^="modExport."]').all())assert.doesNotMatch(await e.innerText(),/export/i);
  await page.evaluate(()=>{state.cp.B12='ON';renderExactToggle();});
  assert.equal(await page.locator('#exact-toggle .txt').innerText(),'روشن');
  await page.locator('#exact-toggle').click();assert.equal(await page.evaluate(()=>state.cp.B12),'OFF');
  assert.equal(await page.locator('#exact-toggle .txt').innerText(),'خاموش');
  assert.equal(await page.locator('#quick-exact-toggle .txt').textContent(),'خاموش');
  await page.locator('#exact-toggle').click();assert.equal(await page.evaluate(()=>state.cp.B12),'ON');
  await page.locator('#cp-c7').selectOption('Network Test');await page.locator('#cp-c9').selectOption('FULLTEXT');await page.locator('#cp-c11').fill('ALPHA');
  await page.locator('#fold-ops [data-arg="modSearchEngine.SearchRecords"]').click();await page.locator('#results-body .match-block[data-match]').waitFor();
  assert.equal(await page.locator('#results-body input.cell-in[data-ci="1"]').inputValue(),'ALPHA');
  await modal(1).click();
  await page.evaluate(()=>switchView('panel'));
  const logo=await page.locator('.brand-logo img').getAttribute('src');assert.deepEqual(Buffer.from(logo.split(',')[1],'base64'),fs.readFileSync(path.join(root,'assets/fam-1-glass.png')));
  await page.locator('[data-act="toggle-sidebar"]').click();
  for(const width of [1440,800,390,320]){
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>{const e=document.querySelector('.brand-sub');return e.scrollWidth<=e.clientWidth+1;});
    const g=await page.evaluate(()=>{
      const p=document.querySelector('.brand-name').getBoundingClientRect(),en=document.querySelector('.brand-sub').getBoundingClientRect(),logo=document.querySelector('.brand-logo').getBoundingClientRect();
      return {under:en.top>=p.bottom,aligned:Math.abs(en.right-p.right)<1,notUnderLogo:en.right<logo.left,persian:document.querySelector('.brand-name').scrollWidth<=document.querySelector('.brand-name').clientWidth+1};
    });
    assert.ok(g.under&&g.aligned&&g.notUnderLogo&&g.persian,JSON.stringify({width,...g}));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=innerWidth);
  await page.locator('.brand').screenshot({path:path.join(root,'test-results/fam-brand-ui12.png'),animations:'disabled'});
  await page.locator('[data-act="toggle-sidebar"]').click();
  await page.locator('#fold-ops').screenshot({path:path.join(root,'test-results/fam-operations-ui12.png'),animations:'disabled'});
});
