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
  assert.equal(await page.evaluate(()=>Access.can('global-history')),true);
  assert.equal(await page.evaluate(()=>{WriteChangeLog('IMPORT','-','-','SUCCESS','رویداد سراسری');renderLogView();return document.querySelector('#log-body').innerText.includes('IMPORT');}),true);
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
  const themeControls=await page.evaluate(()=>{FamTheme.set('light');const c=getComputedStyle(document.getElementById('user-cancel')),d=getComputedStyle(document.getElementById('user-delete')),done=getComputedStyle(document.getElementById('users-done'));const b=document.getElementById('user-delete').getBoundingClientRect(),p=document.querySelector('.category-editor').getBoundingClientRect();return {cancel:c.backgroundColor,done:done.backgroundColor,deleteBg:d.backgroundColor,deleteColor:d.color,compact:b.width<p.width};});
  assert.notEqual(themeControls.cancel,'rgba(0, 0, 0, 0)');assert.notEqual(themeControls.done,'rgba(0, 0, 0, 0)');assert.equal(themeControls.deleteColor,'rgb(17, 17, 17)');assert.equal(themeControls.compact,true);
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

test('add/remove-only user receives scoped operation lists without Search permission',async()=>{
  // A new browser-local account must not inherit previous account selections.
  await page.evaluate(async()=>{try{await flushDeepSave();await idbDelete();}catch(e){}localStorage.clear();sessionStorage.clear();});
  await page.goto(url);await page.locator('#auth-password').waitFor();await login();
  await page.evaluate(()=>{importValidatedSheets(['شبکه آزمایشی'],{'شبکه آزمایشی':{rows:[['ID','Name'],['N1','TEST RECORD']],merges:[]}},'ops.csv',true);modMapping.RefreshSearchIndex(false);});
  await manager();await page.locator('#user-new').click();
  await page.locator('#user-username').fill('ops-only');await page.locator('#user-name').fill('فقط عملیات');await page.locator('#user-password').fill('1109');
  await page.locator('[data-user-category="services"]').check();
  await page.locator('[data-user-permission="add-record"]').check();await page.locator('[data-user-permission="remove-record"]').check();
  await page.locator('#user-save').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fam.accounts.v1')).users.some(u=>u.username==='ops-only'));
  await page.locator('#users-done').click();await page.locator('#stat-line').click();await page.locator('#account-logout').click();await page.locator('#auth-username').waitFor();await login('ops-only');
  const lists=await page.evaluate(()=>({add:[...document.querySelector('#cp-c16').options].map(o=>o.value),remove:[...document.querySelector('#cp-c23').options].map(o=>o.value),search:[...document.querySelector('#cp-c7').options].map(o=>o.value)}));
  assert.deepEqual(lists.add,['شبکه آزمایشی']);assert.deepEqual(lists.remove,['ALL','شبکه آزمایشی']);assert.deepEqual(lists.search,['ALL']);
  await page.locator('#cp-c16').selectOption('شبکه آزمایشی');await page.evaluate(()=>void modAddRecord.StartAddWizard());await page.locator('.wizard-fields').waitFor();await page.locator('[data-a="cancel"]').click();
  await page.locator('#cp-c23').selectOption('شبکه آزمایشی');await page.locator('#cp-c25').selectOption({index:0});await page.locator('#cp-c27').fill('N1');await page.evaluate(()=>void modRemoveRecord.StartRemoveWizard());await page.locator('#remove-match-number').waitFor();
  await page.locator('#modal-overlay button[data-id="2"]').click();
  assert.deepEqual(errors,[]);
});

test('each denied dashboard operation hides its fields and displays only the access notice',async()=>{
  // Remove all capabilities from the active account while retaining the current
  // revision/session, then reload as that account.
  await page.evaluate(()=>{const all=JSON.parse(localStorage.getItem('fam.accounts.v1'));const user=all.users.find(u=>u.username==='ops-only');user.permissions=[];user.categories=[];user.regions=[];localStorage.setItem('fam.accounts.v1',JSON.stringify(all));});
  await page.reload();await page.waitForFunction(()=>Access.current()&&Access.current().username==='ops-only');
  const denied=await page.evaluate(()=>[...document.querySelectorAll('#fold-ops .grid-add > .card')].map(card=>({title:card.querySelector('h3')?.textContent,note:card.querySelector('.access-denied-note')?.textContent,visibleInputs:[...card.querySelectorAll('.card-body input,.card-body select,.card-body button')].filter(node=>node.getClientRects().length>0).length})));
  assert.equal(denied.length,3);for(const card of denied){assert.equal(card.note,'شما دسترسی به این بخش ندارید.');assert.equal(card.visibleInputs,0,card.title);}
  const panels=await page.evaluate(()=>({categories:document.querySelector('#fold-cats .access-denied-note')?.textContent,navigation:document.querySelector('#fold-nav .access-denied-note')?.textContent,tools:document.querySelector('#fold-tools .access-denied-note')?.textContent,events:document.querySelector('#fold-status .grid-2 > .card:first-child .access-denied-note')?.textContent}));
  assert.deepEqual(panels,{categories:'شما دسترسی به این بخش ندارید.',navigation:'شما دسترسی به این بخش ندارید.',tools:'شما دسترسی به این بخش ندارید.',events:'شما دسترسی به این بخش ندارید.'});
  assert.deepEqual(errors,[]);
});

test('full custom permission matrix exposes only each granted dashboard capability',async()=>{
  const permissions=['view-sheets','search','view-history','edit-cells','save-results','add-record','remove-record','undo-remove','refresh-panel','refresh-index','import-data','export-xlsx','backup-server','restore-data','empty-data','reset-data','manage-regions','manage-categories','manage-users'];
  const expectedTool={
    search:['modSearchEngine.OpenSearchResults','modSearchEngine.ClearSearchResults'],
    'save-results':['modSearchEngine.SaveChanges'],
    'refresh-panel':['modUI.RefreshPanel'],
    'refresh-index':['modSearchEngine.RefreshSearchIndexCore'],
    'import-data':['open-file'],'export-xlsx':['export-xlsx'],'backup-server':['backup'],'restore-data':['restore'],'empty-data':['reset-empty'],'reset-data':['reset-all']
  };
  for(const permission of permissions){
    await page.evaluate(permission=>{
      const accounts=JSON.parse(localStorage.getItem('fam.accounts.v1'));
      const user=accounts.users.find(u=>u.username==='ops-only');
      user.permissions=[permission];
      // Give every case the complete scope so the matrix tests the capability,
      // while the scoped-account test above separately proves scope filtering.
      user.categories=[...new Set([...defaultCategoryConfig().categories.map(category=>category.id),'other'])];
      user.regions=managedRegions().filter(r=>r.id!=='unassigned').map(r=>r.id);
      localStorage.setItem('fam.accounts.v1',JSON.stringify(accounts));
    },permission);
    await page.reload();await page.waitForFunction(()=>Access.current()?.username==='ops-only');
    const snapshot=await page.evaluate(()=>({
      permission:Access.current().permissions[0],
      cards:[...document.querySelectorAll('#fold-ops .grid-add > .card')].map(card=>!card.classList.contains('access-denied-card')),
      categories:!document.querySelector('#fold-cats .fold-inner').classList.contains('access-denied-card'),
      navigation:!document.querySelector('#fold-nav .fold-inner').classList.contains('access-denied-card'),
      events:!document.querySelector('#fold-status .grid-2 > .card:first-child').classList.contains('access-denied-card'),
      tools:[...document.querySelectorAll('#fold-tools [data-act]')].filter(node=>node.getClientRects().length).map(node=>node.dataset.act==='run-macro'?node.dataset.arg:node.dataset.act),
      quickUndo:document.querySelector('[aria-controls="quick-undo"]').getClientRects().length>0,
      sheetTab:document.querySelector('.tab-btn[data-view="sheet"]').getClientRects().length>0,
      resultTab:document.querySelector('.tab-btn[data-view="results"]').getClientRects().length>0,
      logTab:document.querySelector('.tab-btn[data-view="log"]').getClientRects().length>0,
      categoryManage:[...document.querySelectorAll('[data-act="manage-categories"]')].some(node=>node.getClientRects().length>0),
      usersManage:document.querySelector('[data-act="manage-users"]').getClientRects().length>0,
      directChecks:{
        edit:Access.can('manual','شبکه آزمایشی'),regions:Access.can('manage-regions'),source:Access.can('source'),users:Access.can('users'),
        import:Access.can('import'),export:Access.can('export','شبکه آزمایشی'),backup:Access.can('backup','شبکه آزمایشی'),restore:Access.can('restore'),empty:Access.can('empty-data'),reset:Access.can('reset')
      }
    }));
    assert.equal(snapshot.permission,permission);
    assert.deepEqual(snapshot.cards,[permission==='search',permission==='add-record',permission==='remove-record'],permission+' operation cards');
    assert.equal(snapshot.categories,permission==='view-sheets',permission+' categories');
    assert.equal(snapshot.navigation,permission==='view-sheets',permission+' direct navigator');
    assert.equal(snapshot.events,permission==='view-history',permission+' system events');
    assert.equal(snapshot.quickUndo,permission==='undo-remove',permission+' undo');
    assert.equal(snapshot.sheetTab,permission==='view-sheets',permission+' sheet tab');
    assert.equal(snapshot.resultTab,['search','remove-record'].includes(permission),permission+' results tab');
    assert.equal(snapshot.logTab,permission==='view-history',permission+' history tab');
    assert.equal(snapshot.categoryManage,permission==='manage-categories',permission+' category management');
    assert.equal(snapshot.usersManage,permission==='manage-users',permission+' user management');
    const capabilityKey={
      'import-data':'import', 'export-xlsx':'export','backup-server':'backup','restore-data':'restore','empty-data':'empty','reset-data':'reset',
      'edit-cells':'edit','manage-regions':'regions','manage-users':'users','source-code':'source'
    }[permission];
    if(capabilityKey)assert.equal(snapshot.directChecks[capabilityKey],true,permission+' direct permission');
    for(const key of Object.values(expectedTool).flat())assert.equal(snapshot.tools.includes(key),(expectedTool[permission]||[]).includes(key),permission+' tool '+key);
  }
  assert.deepEqual(errors,[]);
});

test('each ordinary category has region-like section management without deleting worksheet data',async()=>{
  await page.evaluate(async()=>{try{await flushDeepSave();await idbDelete();}catch(_){}localStorage.clear();sessionStorage.clear();});
  await page.goto(url);await page.locator('#auth-password').waitFor();await login();
  await page.evaluate(()=>{
    importValidatedSheets(['مرکز داده تهران','ساختمان مرکزی','شبکه اصلی'],{
      'مرکز داده تهران':{rows:[['ID','Name'],['DC-1','تهران']],merges:[]},
      'ساختمان مرکزی':{rows:[['ID','Name'],['HQ-1','مرکزی']],merges:[]},
      'شبکه اصلی':{rows:[['ID','Name'],['NET-1','شبکه']],merges:[]}
    },'sections.xlsx',true);
    state.categoryConfig=defaultCategoryConfig();state.catFilter='datacenters';switchView('sheet');renderSheetCatalog();
  });
  const manager=page.locator('[data-act="manage-category-sections"][data-category="datacenters"]');
  await manager.click();
  await page.locator('[data-section-id="__unassigned__"]').click();
  await page.locator('.category-sheet').filter({hasText:'مرکز داده تهران'}).getByText('ساخت بخش از این شیت').click();
  await page.locator('#section-name').fill('مرکزهای اصلی');await page.locator('#section-save').click();
  let saved=await page.evaluate(()=>({sections:state.categoryConfig.sections,assignments:state.categoryConfig.sectionAssignments,rows:WB.sheets['مرکز داده تهران'].rows}));
  assert.equal(saved.sections.length,1);assert.deepEqual(saved.sections[0],{id:saved.sections[0].id,category:'datacenters',name:'مرکزهای اصلی'});assert.deepEqual(saved.assignments,[['مرکز داده تهران',saved.sections[0].id]]);assert.deepEqual(saved.rows,[['ID','Name'],['DC-1','تهران']]);
  assert.equal(await page.locator('.category-subsection h4').first().textContent(),'مرکزهای اصلی');
  await manager.click();await page.locator('#section-name').fill('مرکز داده اصلی');await page.locator('#section-save').click();
  saved=await page.evaluate(()=>({sections:state.categoryConfig.sections,assignments:state.categoryConfig.sectionAssignments,rows:WB.sheets['مرکز داده تهران'].rows}));
  assert.equal(saved.sections[0].name,'مرکز داده اصلی');assert.deepEqual(saved.rows,[['ID','Name'],['DC-1','تهران']]);
  await manager.click();await page.locator('#section-delete').click();await page.locator('#section-delete').click();await page.locator('#section-save').click();
  const deleted=await page.evaluate(()=>({sections:state.categoryConfig.sections,assignments:state.categoryConfig.sectionAssignments,rows:WB.sheets['مرکز داده تهران'].rows}));
  assert.deepEqual(deleted.sections,[]);assert.deepEqual(deleted.assignments,[]);assert.deepEqual(deleted.rows,[['ID','Name'],['DC-1','تهران']]);
  assert.deepEqual(errors,[]);
});
