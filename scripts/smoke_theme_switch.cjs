/* Exercise the two-theme main application in an isolated browser profile.
   FAM_URL defaults to http://127.0.0.1:3000/FAM.html (test runner only).
   CHROMIUM_PATH + CHROMIUM_MODULE can select a separately installed browser.
   Uses synthetic data only; never changes another browser's local database. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const binary=require(process.env.CHROMIUM_MODULE?path.resolve(process.env.CHROMIUM_MODULE):'@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),url=process.env.FAM_URL||'http://127.0.0.1:3000/FAM.html';
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
    await page.addInitScript(()=>{
      const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),pending=new Set();
      window.requestAnimationFrame=fn=>{let id=request(t=>{pending.delete(id);fn(t);});pending.add(id);return id;};
      window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
      window.__testPendingFrames=pending;
    });
    await page.goto(url);
    await page.locator('#auth-password').waitFor();
    assert.equal(await page.evaluate(()=>FamTheme.current()),'original');
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
    const ready=()=>page.waitForFunction(()=>Access.current()&&document.querySelector('#cp-c9 option')&&!document.querySelector('#auth-screen'));
    await ready();
    const frames=()=>page.evaluate(async()=>{
      await new Promise(r=>setTimeout(r,200));return window.__testPendingFrames.size;
    });
    const moves=()=>page.evaluate(async()=>{
      const c=document.getElementById('fx-stage'),before=c.toDataURL();
      await new Promise(r=>setTimeout(r,400));return c.toDataURL()!==before;
    });
    for(const theme of ['current','orbit','campus']){
      await page.locator('#topbar .fam-theme-toggle').evaluate(button=>{if(FamTheme.current()!=='original')button.click();});
      await page.evaluate(theme=>{const sel=document.getElementById('fx-theme');sel.value=theme;sel.dispatchEvent(new Event('change',{bubbles:true}));},theme);
      assert.equal(await frames(),1);assert.equal(await moves(),true);
      for(let i=0;i<3;i++){
        await page.locator('#topbar .fam-theme-toggle').click();
        assert.equal(await page.evaluate(()=>FamTheme.current()),'light');
        assert.equal(await frames(),0);assert.equal(await moves(),false);
        assert.equal(await page.locator('#fx-stage').isVisible(),false);
        assert.equal(await page.evaluate(()=>localStorage.getItem('fam.fx.theme')),theme);
        await page.locator('#topbar .fam-theme-toggle').click();
        assert.equal(await frames(),1);assert.equal(await moves(),true);
      }
      report.checks.push(theme+': repeated original/light switches stop and resume exactly one decorative frame chain');
    }
    await page.locator('#cp-c11').fill('THEME DRAFT');
    await page.locator('#topbar .fam-theme-toggle').click();await page.reload();await ready();
    assert.equal(await page.evaluate(()=>FamTheme.current()),'light');assert.equal(await frames(),0);
    assert.equal(await page.locator('#cp-c11').inputValue(),'THEME DRAFT');
    report.checks.push('Saved light theme starts with no Canvas loop; draft survives reload');
    for(const width of [1440,800,390,320]){
      await page.setViewportSize({width,height:1000});
      for(const theme of ['original','light']){
        await page.evaluate(theme=>FamTheme.set(theme),theme);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'width '+width+'/'+theme);
        const r=await page.locator('#topbar .fam-theme-toggle').boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width);
      }
    }
    report.checks.push('Both themes and the switch fit 1440, 800, 390 and 320px');
    await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await ready();
    await page.locator('#topbar .fam-theme-toggle').click();
    assert.equal(await frames(),0);assert.equal(await moves(),false);
    report.checks.push('Original theme still respects reduced-motion');
    await page.evaluate(()=>{
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='fam.ui.theme')throw new DOMException('test quota','QuotaExceededError');return set.call(this,key,value);};
      FamTheme.set('light');
      Storage.prototype.setItem=set;
    });
    assert.equal(await page.evaluate(()=>FamTheme.current()),'light');
    report.checks.push('Theme remains usable when preference storage fails');
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(root,'test-results/two-themes-motion-'+report.browser.split('.')[0]+'.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
