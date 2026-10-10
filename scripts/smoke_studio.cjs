/* Exercise the redesigned Studio workspace in an isolated browser profile.
   FAM_URL defaults to http://127.0.0.1:3002/FAM-Studio.html (test runner only).
   CHROMIUM_PATH + CHROMIUM_MODULE can select a separately installed browser.
   Uses synthetic data only; never changes another browser's local database. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const binary=require(process.env.CHROMIUM_MODULE?path.resolve(process.env.CHROMIUM_MODULE):'@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),url=process.env.FAM_URL||'http://127.0.0.1:3002/FAM-Studio.html';
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
    const ready=()=>page.waitForFunction(()=>Access.current()&&document.querySelector('#cp-c9 option')&&!document.querySelector('#auth-screen'));
    await page.goto(url);await page.locator('#auth-password').waitFor();
    await page.screenshot({path:'test-results/studio-login.png'});
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await ready();
    await page.waitForFunction(()=>!document.querySelector('#toasts .toast'));
    await page.screenshot({path:'test-results/studio-empty.png'});
    assert.equal(await page.evaluate(()=>{
      const sheets={};for(const name of ['تهران','فارس','خراسان رضوی','تجهیزات شبکه'])sheets[name]={rows:[['شناسه','نام','IP','وضعیت'],...Array.from({length:12},(_,i)=>['DEMO-'+(i+1),'رکورد آزمایشی '+(i+1),'192.0.2.'+(i+1),'آزمایشی'])],merges:[]};
      sheets[ARCHIVE_MAIN]={rows:[['شناسه','نام','IP','وضعیت']],merges:[]};
      return importValidatedSheets(Object.keys(sheets),sheets,'studio-test.xlsx',true);
    }),true);
    await page.waitForFunction(()=>!document.querySelector('#toasts .toast'));
    await page.screenshot({path:'test-results/studio-desktop.png',fullPage:true});
    for(const width of [800,390,320]){
      await page.setViewportSize({width,height:1000});
      await page.screenshot({path:'test-results/studio-'+width+'.png',fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);
    }
    report.checks.push('Login, distinct Studio shell, 48 synthetic records, desktop/tablet/mobile without page overflow');
    await page.setViewportSize({width:1440,height:1000});
    const modal=id=>page.locator(`#modal-overlay.show button[data-id="${id}"]`);
    const home=()=>page.locator('.studio-nav [data-view="panel"]').click();
    await page.locator('#cp-c11').fill('DRAFT');
    await page.locator('#studio-tab-add').click();
    assert.equal(await page.locator('#cp-c11').isVisible(),false);
    await page.locator('#studio-tab-add').press('ArrowLeft');
    assert.equal(await page.locator('#studio-tab-remove').getAttribute('aria-selected'),'true');
    await page.locator('#cp-c27').fill('DELETE DRAFT');
    await page.locator('#studio-tab-search').click();
    assert.equal(await page.locator('#cp-c11').inputValue(),'DRAFT');
    assert.equal(await page.locator('#cp-c27').inputValue(),'DELETE DRAFT');
    await page.locator('#cp-c7').selectOption('تجهیزات شبکه');await page.locator('#cp-c9').selectOption('FULLTEXT');
    await page.locator('#cp-c11').fill('DEMO-9');await page.locator('#cp-c11').press('Enter');
    await page.locator('#results-body .match-block').waitFor();
    if(await modal(1).isVisible())await modal(1).click(); // Enter can also acknowledge the focused success button.
    assert.equal(await page.locator('#results-body input.cell-in[data-ci="0"]').first().inputValue(),'DEMO-9');
    await page.screenshot({path:'test-results/studio-results.png'});
    await home();await page.locator('#studio-tab-add').click();await page.locator('#cp-c16').selectOption('تجهیزات شبکه');
    await page.locator('#studio-panel-add [data-arg="modAddRecord.StartAddWizard"]').click();
    for(const [i,value] of ['STUDIO-NEW','آزمایش افزودن','192.0.2.199','آزمایشی'].entries())await page.locator(`.wizard-fields input[data-i="${i}"]`).fill(value);
    await page.screenshot({path:'test-results/studio-add.png'});
    await page.setViewportSize({width:390,height:844});
    const dialog=await page.locator('.mbox:has(.wizard-fields)').boundingBox();
    assert.ok(dialog.x>=0&&dialog.x+dialog.width<=390);
    await page.screenshot({path:'test-results/studio-add-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-a="ok"]').click();await modal(6).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تجهیزات شبکه'].rows.some(r=>r[0]==='STUDIO-NEW')),true);
    await home();await page.locator('#studio-tab-remove').click();await page.locator('#cp-c23').selectOption('تجهیزات شبکه');await page.locator('#cp-c25').selectOption('FULLTEXT');await page.locator('#cp-c27').fill('STUDIO-NEW');
    await page.locator('#studio-panel-remove [data-arg="modRemoveRecord.StartRemoveWizard"]').click();
    await page.locator('#modal-input').fill('ALL');await modal(1).click();await page.locator('#modal-input').fill('1');await modal(1).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تجهیزات شبکه'].rows.some(r=>r[0]==='STUDIO-NEW')),false);
    await home();await page.locator('#studio-tab-remove').click();await page.locator('#studio-panel-remove [data-arg="modUndo.UndoLastRemove"]').click();await modal(6).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تجهیزات شبکه'].rows.some(r=>r[0]==='STUDIO-NEW')),true);
    report.checks.push('Real tab clicks, RTL keyboard navigation, draft preservation, Enter search, add/delete/undo through visible forms');
    await page.locator('.studio-nav [data-view="sheet"]').click();
    await page.locator('#cat-bar [data-cat="equipment"]').click();
    await page.locator('#sheet-catalog [data-act="open-sheet"][data-name="تجهیزات شبکه"]').click();
    const cell=page.locator('#sheet-body td[data-r="2"][data-c="2"]');await cell.fill('STUDIO-EDIT');await cell.blur();
    await page.evaluate(()=>{window.scrollTo(0,0);document.body.scrollTop=0;});
    await page.screenshot({path:'test-results/studio-library.png'});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'library overflow '+width);
    }
    await page.screenshot({path:'test-results/studio-library-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    const download=page.waitForEvent('download');await page.evaluate(()=>ExportWorkbookXlsx());
    assert.ok(fs.statSync(await (await download).path()).size>0);
    const menu=page.locator('[data-act="toggle-sidebar"]');await menu.click();
    await home();assert.equal(await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')),true);await menu.click();
    await page.reload();await ready();assert.equal(await page.evaluate(()=>WB.sheets['تجهیزات شبکه'].rows[1][1]),'STUDIO-EDIT');
    assert.equal(await page.locator('#cp-c27').inputValue(),'STUDIO-NEW');
    report.checks.push('Master/detail catalogue opens real sheet, edit survives reload, Excel export, click-only menu');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('script[src],link[rel="stylesheet"]').length),0);
    assert.equal(await page.locator('#fx-stage').isVisible(),false);
    assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size;}),true);
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(root,'test-results/studio-smoke-'+report.browser.split('.')[0]+'.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
