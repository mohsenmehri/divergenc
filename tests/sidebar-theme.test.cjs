/* UI-only regression on both generated HTML editions. The central edition uses
   an isolated real Flask test backend, never an existing server or database. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const root=path.resolve(__dirname,'..');
let browser,local,backend,temp,centralURL,localURL;
before(async()=>{
  const libs=path.join(root,'.cache/chromium-libs');fs.mkdirSync(libs,{recursive:true});
  const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
  execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
  process.env.LD_LIBRARY_PATH=[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args.filter(a=>!['--single-process','--disable-web-security','--allow-running-insecure-content'].includes(a)),headless:true});
  local=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'FAM.html')));});
  await new Promise(resolve=>local.listen(0,'127.0.0.1',resolve));localURL=`http://127.0.0.1:${local.address().port}/FAM.html`;
  temp=fs.mkdtempSync(path.join(root,'.cache/sidebar-theme-'));
  backend=spawn(path.join(root,'.venv/bin/python'),['-u','-c',`
import os
from werkzeug.serving import make_server
from server.app import create_app
server=make_server('127.0.0.1',0,lambda e,s: [])
origin='http://127.0.0.1:'+str(server.server_port)
server.app=create_app({'DB_PATH':os.environ['SIDEBAR_TEST_DB'],'PUBLIC_ORIGIN':origin,'TESTING':True,'COOKIE_SECURE':False})
print('READY '+origin,flush=True)
server.serve_forever()
`],{cwd:root,env:{...process.env,SIDEBAR_TEST_DB:path.join(temp,'test.sqlite3')},stdio:['ignore','pipe','pipe']});
  centralURL=await new Promise((resolve,reject)=>{
    let output='',error='';const timer=setTimeout(()=>reject(Error('Test backend startup timeout: '+error)),15000);
    backend.stderr.on('data',s=>error+=s);
    backend.once('error',e=>{clearTimeout(timer);reject(e);});
    backend.once('exit',code=>{clearTimeout(timer);reject(Error('Test backend exited '+code+': '+error));});
    backend.stdout.on('data',s=>{output+=s;const m=output.match(/READY (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]+'/FAM.html');}});
  });
});
after(async()=>{
  await browser?.close();if(local)await new Promise(resolve=>local.close(resolve));
  if(backend&&backend.exitCode===null){const exited=new Promise(resolve=>backend.once('exit',resolve));backend.kill();await exited;}
  if(temp)fs.rmSync(temp,{recursive:true,force:true});
});
for(const edition of ['local','central'])test(`${edition}: light sidebar and theme-1-only background controls on desktop/mobile`,{timeout:90000},async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  try{
    await page.goto(edition==='central'?centralURL:localURL);
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
    await page.waitForFunction(()=>typeof Access!=='undefined'&&Access.current()&&!document.querySelector('#auth-screen')&&document.querySelector('#cp-c9 option')&&!document.querySelector('#shared-block'));
    await page.locator('#topbar [data-act="toggle-sidebar"]').click();
    const appearance=()=>page.evaluate(()=>{
      const s=getComputedStyle(document.getElementById('sidebar')),n=getComputedStyle(document.querySelector('.nav-item.active'));
      return {color:s.backgroundColor,image:s.backgroundImage,border:s.borderColor,shadow:s.boxShadow,activeImage:n.backgroundImage};
    });
    const state=()=>page.evaluate(()=>({workbook:JSON.stringify(WB),user:Access.current().id,fx:document.getElementById('fx-theme').value,strength:document.getElementById('fx-strength').value,savedFX:localStorage.getItem('fam.fx.theme'),savedStrength:localStorage.getItem('fam.fx.strength')}));
    await page.locator('#fx-theme').selectOption('horizon');
    await page.locator('#fx-strength').evaluate(input=>{input.value='65';input.dispatchEvent(new Event('input',{bubbles:true}));});
    const original=await appearance(),saved=await state();
    assert.match(original.image,/linear-gradient/);
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      await page.evaluate(()=>{FamTheme.set('light');document.getElementById('sidebar-scroll').scrollTop=0;});
      await page.waitForTimeout(450);
      await page.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();});
      assert.equal((await appearance()).image,'none');assert.equal((await appearance()).color,'rgb(255, 255, 255)');
      assert.equal((await appearance()).activeImage,'none');
      assert.equal(await page.locator('#fx-strength').isVisible(),false);assert.equal(await page.locator('#fx-theme').isVisible(),false);
      assert.equal(await page.locator('#sidebar .side-foot > .fx-bar').count(),2);
      assert.equal(await page.evaluate(()=>{document.getElementById('fx-strength').focus();return document.activeElement.id==='fx-strength';}),false);
      assert.equal(await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')),true);
      const rect=await page.locator('#sidebar').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width+1,JSON.stringify({viewport,rect,style:await page.locator("#sidebar").evaluate(e=>({right:getComputedStyle(e).right,innerWidth:innerWidth,open:e.className}))}));
      assert.deepEqual(await state(),saved);
      // Navigation and quick sections remain usable; theme changes do not close the menu.
      await page.locator('#sidebar [data-view="log"]').click();
      assert.equal(await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')),true);
      await page.locator('#sidebar [data-view="panel"]').click();
      const quick=page.locator('[aria-controls="quick-search"]');await quick.click();
      assert.equal(await quick.getAttribute('aria-expanded'),'true');await quick.click();
      await page.evaluate(()=>document.getElementById('sidebar-scroll').scrollTop=0);
      fs.mkdirSync(path.join(root,'.cache/sidebar-screens'),{recursive:true});
      await page.locator('#sidebar').screenshot({path:path.join(root,`.cache/sidebar-screens/${edition}-light-${viewport.width}.png`),animations:'disabled'});
      await page.evaluate(()=>FamTheme.set('original'));await page.waitForTimeout(450);
      await page.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();});
      assert.equal(await page.locator('#fx-strength').isVisible(),true);assert.equal(await page.locator('#fx-theme').isVisible(),true);
      assert.deepEqual(await appearance(),original);assert.deepEqual(await state(),saved);
    }
    await page.evaluate(()=>FamTheme.set('light'));await page.reload();
    await page.waitForFunction(()=>Access.current()&&!document.querySelector('#auth-screen')&&!document.querySelector('#shared-block'));
    assert.equal(await page.evaluate(()=>FamTheme.current()),'light');
    assert.equal(await page.locator('#fx-theme').isVisible(),false);
    assert.equal((await appearance()).image,'none');assert.deepEqual(await state(),saved);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

for(const edition of ['local','central'])test(`${edition}: light focus/pressed states in login, quick panels, forms and cells`,{timeout:90000},async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  async function lightField(field){
    await field.focus();
    const styles=await field.evaluate(e=>{
      for(const a of e.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();
      const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,image:s.backgroundImage,id:e.id};
    });
    assert.equal(styles.background,'rgb(255, 255, 255)',JSON.stringify(styles));
    assert.equal(styles.color,'rgb(32, 60, 82)',JSON.stringify(styles));
  }
  try{
    await page.goto(edition==='central'?centralURL:localURL);
    await page.evaluate(()=>FamTheme.set('light'));
    await lightField(page.locator('#auth-username'));await lightField(page.locator('#auth-password'));
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
    await page.waitForFunction(()=>Access.current()&&!document.querySelector('#auth-screen')&&document.querySelector('#cp-c9 option')&&!document.querySelector('#shared-block'));
    await page.evaluate(async()=>{
      importValidatedSheets(['Focus Test'],{'Focus Test':{rows:[['ID','Name'],['1','FOCUS']],merges:[]}},'focus-test.xlsx',true);
      await flushDeepSave();if(typeof FamShared!=='undefined')await FamShared.flush();
    });
    await lightField(page.locator('#cp-c11'));
    await page.locator('#topbar [data-act="toggle-sidebar"]').click();
    for(const id of ['quick-search','quick-add','quick-remove']){
      const trigger=page.locator(`[aria-controls="${id}"]`);await trigger.click();
      const fields=page.locator(`#${id} .inp`);assert.ok(await fields.count()>0);
      for(const field of await fields.all())if(await field.isVisible())await lightField(field);
      if(id==='quick-search'){
        const text=page.locator('#quick-search input.inp').first();await text.click();
        await page.mouse.down();await lightField(text);await page.mouse.up();
        await page.locator('#sidebar').screenshot({path:path.join(root,`.cache/sidebar-screens/${edition}-light-focused.png`),animations:'disabled'});
      }
      await trigger.click();
    }
    await page.locator('#topbar [data-act="toggle-sidebar"]').click();
    await page.locator('#stat-line').click();await page.locator('#account-manage').click();await page.locator('#user-new').click();
    for(const id of ['user-username','user-name','user-password','user-role'])await lightField(page.locator('#'+id));
    await page.locator('#users-done').click();
    await page.evaluate(()=>{state.cp.C16='Focus Test';document.getElementById('cp-c16').value='Focus Test';RunMacro('modAddRecord.StartAddWizard');});
    await page.locator('.wizard-fields').waitFor();
    for(const field of await page.locator('.wizard-fields input').all())await lightField(field);
    await page.locator('[data-a="cancel"]').click();
    await page.evaluate(()=>{state.lockedSheets['Focus Test']=false;switchView('sheet');renderSheetView('Focus Test');});
    const cell=page.locator('#sheet-body td[contenteditable][data-r="2"][data-c="2"]');await cell.focus();
    const cellStyle=await cell.evaluate(e=>{for(const a of e.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();return {bg:getComputedStyle(e).backgroundColor,focus:e.matches(':focus'),active:document.activeElement.outerHTML.slice(0,400),html:e.outerHTML.slice(0,300)};});
    assert.equal(cellStyle.bg,'rgb(239, 249, 246)',JSON.stringify(cellStyle));
    // Less frequently used field templates, using their production selectors.
    await page.evaluate(()=>{
      const box=document.createElement('div');box.id='focus-fixture';box.innerHTML='<div class="field"><textarea class="inp"></textarea></div><div class="mbox"><input class="m-in"></div>';
      document.body.appendChild(box);
    });
    for(const field of await page.locator('#focus-fixture input,#focus-fixture textarea').all())await lightField(field);
    await page.locator('#focus-fixture').evaluate(e=>e.remove());
    await page.evaluate(()=>{switchView('panel');FamTheme.set('original');});
    await page.locator('#cp-c11').focus();
    const original=await page.locator('#cp-c11').evaluate(e=>{for(const a of e.getAnimations())a.finish();return getComputedStyle(e).backgroundColor;});
    assert.equal(original,'rgba(2, 10, 27, 0.8)'); // Original theme deliberately unchanged.
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
