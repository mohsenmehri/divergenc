/* Exercise the independent UI B server in an isolated browser profile.
   FAM_URL defaults to http://127.0.0.1:3001/FAM-Operations.html (test runner only).
   CHROMIUM_PATH + CHROMIUM_MODULE can select a separately installed browser.
   Uses synthetic data only; never changes another browser's local database. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const binary=require(process.env.CHROMIUM_MODULE?path.resolve(process.env.CHROMIUM_MODULE):'@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),url=process.env.FAM_URL||'http://127.0.0.1:3001/FAM-Operations.html';
(async()=>{
  let browser;
  try{
    if(!process.env.CHROMIUM_PATH){
      const dir=path.join(root,'.cache/chromium-libs');fs.mkdirSync(dir,{recursive:true});
      const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
      execFileSync('tar',['xf','-','-C',dir],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
      process.env.LD_LIBRARY_PATH=[path.join(dir,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    }
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>!['--disable-web-security','--allow-running-insecure-content'].includes(a)),headless:true});
    const report={browser:browser.version(),platform:process.platform,url,checks:[],errors:[]};
    console.log('Browser:',report.browser);
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
    const ready=()=>page.waitForFunction(()=>document.querySelector('#cp-c9 option')&&Access.current()&&!document.querySelector('#auth-screen'));
    const response=await page.goto(url);assert.equal(response.status(),200);
    assert.equal(await page.locator('#layout').isVisible(),false);
    assert.equal(await page.evaluate(()=>isSecureContext&&!!crypto.subtle&&!!crypto.randomUUID),true);
    await page.screenshot({path:path.join(root,'test-results/operations-login.png')});
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await ready();
    report.checks.push('HTTP 200, secure-context APIs, login gate and successful login');
    const canvasChanges=()=>page.evaluate(async()=>{
      await new Promise(r=>setTimeout(r,150));
      const c=document.getElementById('fx-stage'),before=c.toDataURL();
      await new Promise(r=>setTimeout(r,700));return before!==c.toDataURL();
    });
    assert.equal(await page.locator('.operations-heading').textContent(),'میزکار مدیریت داده');
    assert.equal(await canvasChanges(),false);
    assert.equal(await page.locator('#fx-stage').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
    await page.locator('#operations-demo').click();
    await page.waitForFunction(()=>WB.sheets['تهران']?.rows.length===13);
    await page.locator('#operations-demo').click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows.length),13);
    await page.evaluate(()=>{setSidebarOpen(true);window.scrollTo(0,0);document.body.scrollTop=0;});
    await page.waitForFunction(()=>document.querySelectorAll('#toasts .toast').length===0);
    await page.screenshot({path:path.join(root,'test-results/operations-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>setSidebarOpen(false));
    await page.screenshot({path:path.join(root,'test-results/operations-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1440,height:1000});
    report.checks.push('Static UI, demo load/overwrite protection, desktop and mobile');
    assert.equal(await page.evaluate(()=>{
      const rows=[['ID','Name','IP']];for(let i=1;i<=5000;i++)rows.push(['R'+i,'Branch '+i,'10.'+(i%250)+'.'+Math.floor(i/250)+'.1']);
      return importValidatedSheets(['VM Test'],{'VM Test':{rows,merges:[]}},'vm-synthetic.xlsx',true);
    }),true);
    await page.evaluate(()=>flushDeepSave());
    const typing=await page.evaluate(()=>{
      let count=0;const original=packLZ;packLZ=function(...args){count++;return original(...args);};
      const times=[],e=document.getElementById('cp-c11');
      try{for(let i=1;i<=20;i++){e.value='VM network data test'.slice(0,i);const t=performance.now();e.dispatchEvent(new Event('input',{bubbles:true}));times.push(performance.now()-t);}}
      finally{packLZ=original;}
      times.sort((a,b)=>a-b);return {events:20,rows:5000,columns:3,fullCompressionCalls:count,medianMs:times[10],p95Ms:times[18],final:e.value};
    });
    assert.equal(typing.fullCompressionCalls,0);report.typing=typing;
    await page.reload();await ready();assert.equal(await page.locator('#cp-c11').inputValue(),typing.final);
    report.checks.push('5,000 synthetic rows: typing has no full compression and draft survives reload');
    await page.evaluate(()=>{state.cp.C7='VM Test';state.cp.C9='FULLTEXT';state.cp.C11='R4999';void modSearchEngine.SearchRecords();});
    await page.locator('#results-body .match-block[data-match]').waitFor();
    assert.equal(await page.locator('#results-body input.cell-in[data-ci="0"]').first().inputValue(),'R4999');
    await page.screenshot({path:path.join(root,'test-results/operations-results.png')});
    await page.locator('#modal-overlay.show button[data-id="1"]').click();
    await page.evaluate(()=>{switchView('sheet');renderSheetView('VM Test');});
    await page.screenshot({path:path.join(root,'test-results/operations-sheet.png')});
    const cell=page.locator('#sheet-body td[data-r="2"][data-c="2"]');await cell.fill('VM-EDIT');await cell.blur();
    await page.reload();await ready();assert.equal(await page.evaluate(()=>WB.sheets['VM Test'].rows[1][1]),'VM-EDIT');
    report.checks.push('Search finds late record; cell edit survives reload');
    const download=page.waitForEvent('download');await page.evaluate(()=>ExportWorkbookXlsx());const exported=await download;
    assert.ok(exported.suggestedFilename().endsWith('.xlsx'));assert.ok(fs.statSync(await exported.path()).size>0);
    report.checks.push('Excel export produces a nonempty XLSX file');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.evaluate(()=>{switchView('panel');setSidebarOpen(true);window.scrollTo(0,0);document.body.scrollTop=0;});
    await page.waitForFunction(()=>{const r=document.getElementById('topbar').getBoundingClientRect();return Math.abs(r.top)<1;});
    await page.waitForFunction(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});
    report.geometry=await page.evaluate(()=>({scrollY,bodyScroll:document.body.scrollTop,topbar:document.getElementById('topbar').getBoundingClientRect().toJSON()}));
    const tag=report.browser.split('.')[0];
    await page.screenshot({path:path.join(root,`test-results/operations-chromium-${tag}.png`)});
    await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await ready();
    const changed=await canvasChanges();assert.equal(changed,false);
    report.checks.push('Background remains static with reduced-motion preference');
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(root,`test-results/operations-chromium-${tag}.json`),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
