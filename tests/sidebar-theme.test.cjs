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
