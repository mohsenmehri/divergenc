/* Five isolated browser contexts against an explicitly designated test backend.
Never point this at production: imports a synthetic workbook and test users. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const url=process.env.FAM_SHARED_TEST_URL||'http://127.0.0.1:8765/FAM.html';
(async()=>{
 const dir=path.resolve('.cache/chromium-libs');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync('test-results',{recursive:true});
 const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');execFileSync('tar',['xf','-','-C',dir],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});process.env.LD_LIBRARY_PATH=dir+'/lib';
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args.filter(a=>!['--single-process','--disable-web-security','--allow-running-insecure-content'].includes(a)),headless:true});
 const report={browser:browser.version(),checks:[],errors:[]};let pages=[];
 const ready=p=>p.waitForFunction(()=>typeof Access!=='undefined'&&typeof FamShared!=='undefined'&&Access.current()&&!document.querySelector('#auth-screen')&&!document.querySelector('#shared-block')&&(Access.current().role===4?document.querySelector('#access-viewer'):document.querySelector('#cp-c9 option')));
 async function enter(name){const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(e.message));await p.goto(url);await p.locator('#auth-username').fill(name);await p.locator('#auth-password').fill('1109');await p.locator('#auth-submit').click();await ready(p);pages.push(p);return p;}
 const settled=p=>p.waitForFunction(()=>!FamShared.pending()&&!document.querySelector('#shared-block'));
 const show=p=>p.evaluate(()=>{switchView('sheet');renderSheetView('Network');});
 const value=p=>p.evaluate(()=>WB.sheets.Network.rows[1][1]);
 const cell=p=>p.locator('#sheet-body td[data-r="2"][data-c="2"]');
 async function edit(p,text){await show(p);await cell(p).fill(text);await p.locator('#sheet-title').click();}
 async function commit(p,text){await edit(p,text);await settled(p);}
 async function allSee(text){for(const p of pages)await p.waitForFunction(t=>WB.sheets.Network?.rows[1][1]===t,text,{timeout:18000});}
 try{
  const a=await enter('admin');
  await a.evaluate(()=>importValidatedSheets(['Network','تهران','فارس',ARCHIVE_MAIN],Object.fromEntries(['Network','تهران','فارس',ARCHIVE_MAIN].map(n=>[n,{rows:[['ID','Name','IP'],...(n===ARCHIVE_MAIN?[]:[[1,n==='Network'?'BASE':n,'192.0.2.1']])],merges:[]}])), 'central-synthetic.xlsx',true));await settled(a);
  const suffix=String(Date.now()).slice(-6);
  const usernames=await a.evaluate(async suffix=>{
   const users=await FamShared.api('users');
   users.users=users.users.filter(u=>u.username==='admin');
   const names=[2,3,4,2].map((role,i)=>'central'+suffix+'_'+i);
   [2,3,4,2].forEach((role,i)=>users.users.push({id:crypto.randomUUID(),username:names[i],name:'Test '+i,role,enabled:true,regions:role===4?['2']:[],sheets:role===4?['Network','تهران']:[],password:'1109'}));
   await FamShared.api('users',users);return names;
  },suffix);
  const b=await enter(usernames[0]),c=await enter(usernames[1]),d=await enter(usernames[2]),e=await enter(usernames[3]);
  assert.equal(pages.length,5);await allSee('BASE');
  await commit(a,'FROM-ADMIN');await allSee('FROM-ADMIN');
  await commit(b,'FROM-USER2');await allSee('FROM-USER2');
  assert.equal(await d.evaluate(()=>!!WB.sheets['فارس']),false);
  assert.equal(await d.evaluate(()=>FamShared.api('state').then(r=>!!r.state.sheets['فارس'])),false);
  report.checks.push('Five isolated authenticated browsers: central edits converge automatically; level-4 workbook/API redacted');
  // Two pending edits from the same revision: never silently overwrite.
  await show(e);await cell(e).fill('STALE-EDIT');
  await commit(a,'WINNER');
  await e.locator('#sheet-title').click();await e.locator('#shared-reload').waitFor();
  assert.match(await e.locator('#shared-error').innerText(),/کاربر دیگری/);
  assert.equal(await a.evaluate(()=>FamShared.api('state').then(r=>r.state.sheets.Network.rows[1][1])),'WINNER');
  e.once('dialog',dialog=>dialog.accept());await e.locator('#shared-reload').click();await ready(e);await allSee('WINNER');
  report.checks.push('Conflicting edit rejected with recovery/discard choice; winning data preserved');
  // Lost ACK: server commits, transport drops response, retry uses same request ID.
  const before=await b.evaluate(()=>FamShared.revision());
  await b.route('**/api/state',async route=>{if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}else await route.continue();});
  await edit(b,'ACK-LOST');await b.locator('#shared-retry').waitFor();
  assert.match(await b.locator('#save-indicator').innerText(),/ثبت نشده/);
  await a.waitForFunction(()=>WB.sheets.Network.rows[1][1]==='ACK-LOST');
  await b.unroute('**/api/state');await b.locator('#shared-retry').click();await settled(b);
  assert.equal(await b.evaluate(()=>FamShared.revision()),before+1);await allSee('ACK-LOST');
  // Offline write never says saved and never reaches the central workbook.
  await b.route('**/api/state',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
  await edit(b,'OFFLINE');await b.locator('#shared-retry').waitFor();
  assert.equal(await a.evaluate(()=>FamShared.api('state').then(r=>r.state.sheets.Network.rows[1][1])),'ACK-LOST');
  await b.unroute('**/api/state');await b.locator('#shared-retry').click();await settled(b);await allSee('OFFLINE');
  report.checks.push('Offline write not acknowledged; lost-ACK retry is idempotent (exactly one revision)');
  // Original level-3 wizard still inserts into the shared model.
  await c.evaluate(()=>{switchView('panel');state.cp.C16='Network';document.getElementById('cp-c16').value='Network';RunMacro('modAddRecord.StartAddWizard');});
  await c.locator('.wizard-fields').waitFor();
  for(const [i,v] of ['ADD3','THIRD-USER','192.0.2.3'].entries())await c.locator(`.wizard-fields input[data-i="${i}"]`).fill(v);
  await c.locator('[data-a="ok"]').click();
  // Form confirmation uses the original native macro dialogs.
  const yes=c.locator('#modal-overlay.show button[data-id="6"]');if(await yes.count())await yes.click();
  await c.waitForFunction(()=>!FamShared.pending()&&WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  const ok=c.locator('#modal-overlay.show button[data-id="1"]');if(await ok.count())await ok.click();
  for(const p of [a,b,d,e])await p.waitForFunction(()=>WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  assert.equal(await c.evaluate(async()=>{const p=await FamShared.api('state');p.state.sheets.Network.rows[1][1]='FORGED';try{await FamShared.api('state',{...p,requestId:crypto.randomUUID()});return 200;}catch(e){return e.status;}}),403);
  report.checks.push('Real level-3 Add wizard writes centrally; forged manual edit rejected by server');
  await c.evaluate(()=>{state.cp.C23='Network';state.cp.C25='FULLTEXT';state.cp.C27='ADD3';RunMacro('modRemoveRecord.StartRemoveWizard');});
  await c.locator('#modal-overlay #remove-match-number').waitFor();await c.locator('#modal-overlay button[data-id="10"]').click();
  await c.locator('#modal-overlay button[data-id="101"]').click();
  await c.waitForFunction(()=>!FamShared.pending()&&!WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  await c.locator('#modal-overlay button[data-id="1"]').click();
  for(const p of [a,b,d,e])await p.waitForFunction(()=>!WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  assert.equal(await a.evaluate(()=>WB.sheets[ARCHIVE_MAIN].rows.some(r=>r[0]==='ADD3')),true);
  await a.evaluate(()=>{RunMacro('modUndo.UndoLastRemove');});
  await a.locator('#modal-overlay button[data-id="6"]').click();
  await a.waitForFunction(()=>!FamShared.pending()&&WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  for(const p of [b,c,d,e])await p.waitForFunction(()=>WB.sheets.Network.rows.some(r=>r[0]==='ADD3'));
  assert.equal(await a.evaluate(()=>WB.sheets[ARCHIVE_MAIN].rows.some(r=>r[0]==='ADD3')),false);
  report.checks.push('Level-3 real delete wizard archives centrally; administrator restores trusted last server snapshot across all five browsers');
  const rollback=await a.evaluate(async()=>{
    const before=JSON.stringify({sheet:WB.sheets.Network,locks:state.lockedSheets}),rev=FamShared.revision();
    withTransactionSync(()=>{WB.sheets.Network.rows[1][1]='ROLLBACK';state.lockedSheets.Network=true;saveState();throw Error('synthetic transaction rollback');});
    await FamShared.flush();return {same:before===JSON.stringify({sheet:WB.sheets.Network,locks:state.lockedSheets}),revisionUnchanged:rev===FamShared.revision()};
  });assert.deepEqual(rollback,{same:true,revisionUnchanged:true});
  await b.locator('#stat-line').click();await b.locator('#account-password').click();
  await b.locator('#password-current').fill('1109');await b.locator('#password-new').fill('1109');await b.locator('#password-confirm').fill('1109');await b.locator('#password-save').click();
  await b.waitForFunction(()=>!document.getElementById('password-form'));await b.evaluate(()=>FamShared.poll());
  assert.equal(await b.evaluate(()=>Access.current().role),2);assert.equal(await b.locator('#shared-block').count(),0);
  report.checks.push('Workbook + metadata rollback produces no server revision; own-password form keeps profile and current session');
  // Exact structural parity between original and light themes.
  await a.bringToFront();await a.evaluate(()=>{switchView('panel');FamTheme.set('original');});await a.evaluate(()=>document.fonts.ready);await a.waitForTimeout(650);
  const geometry=()=>a.evaluate(()=>Object.fromEntries(['#topbar','#view-panel .hero','#fold-ops','#fold-cats','#cp-c11','#cp-c16','#cp-c27'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height].map(x=>Math.round(x))];})));
  await a.evaluate(()=>{for(const anim of document.getAnimations())if(Number.isFinite(anim.effect.getComputedTiming().endTime))anim.finish();});
  const first=await geometry();await a.screenshot({path:'test-results/shared-theme-original.png'});
  await a.evaluate(()=>FamTheme.set('light'));const second=await geometry();assert.deepEqual(second,first);
  await a.waitForFunction(()=>getComputedStyle(document.getElementById('fx-stage')).opacity==='0');
  assert.equal(await a.evaluate(()=>getComputedStyle(document.getElementById('cp-c16')).backgroundSize),'6px 6px, 6px 6px');
  assert.equal(await a.locator('#operations-demo,.operations-nav').count(),0);
  await a.screenshot({path:'test-results/shared-theme-light.png'});
  for(const width of [800,390,320]){await a.setViewportSize({width,height:1000});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await a.setViewportSize({width:1440,height:1000});
  // Account management still uses the existing UI, but commits to server.
  await a.locator('#stat-line').click();await a.locator('#account-manage').click();await a.locator('#user-new').click();
  await a.locator('#user-username').fill('created'+suffix);await a.locator('#user-name').fill('Created via UI');await a.locator('#user-password').fill('1109');await a.locator('#user-role').selectOption('3');await a.locator('#user-save').click();
  await a.waitForFunction(()=>document.getElementById('users-status').textContent.includes('ساخته شد'));await a.locator('#users-done').click();
  report.checks.push('Theme geometry identical; mobile has no page overflow; original user-management UI saves centrally');
  await b.reload();await ready(b);assert.equal(await value(b),'OFFLINE');
  assert.equal(await b.evaluate(()=>localStorage.getItem('Mohsen_FINAL_v5_state_v2')),null);
  assert.equal(await b.evaluate(()=>localStorage.getItem('fam.accounts.v1')),null);
  await a.evaluate(()=>resetAll());await a.locator('#modal-overlay button[data-id="6"]').click();await settled(a);
  for(const p of pages)await p.waitForFunction(()=>WB.order.filter(IsDataSheet).length===0);
  assert.equal(await a.evaluate(()=>FamShared.api('users').then(p=>p.users.length)),6);
  await a.evaluate(()=>{RunMacro('modUndo.UndoLastRemove');});await a.locator('#modal-overlay button[data-id="6"]').click();await settled(a);await allSee('OFFLINE');
  report.checks.push('Explicit central reset clears shared data, not accounts or legacy browser DB; server Undo restores the shared workbook');
  assert.deepEqual(report.errors,[]);
  fs.writeFileSync('test-results/shared-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
