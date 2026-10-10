/* Exercise the data-first Grid workspace in an isolated browser profile.
   FAM_URL defaults to http://127.0.0.1:3003/FAM-Grid.html (test runner only).
   CHROMIUM_PATH + CHROMIUM_MODULE can select a separately installed browser.
   Uses synthetic data only; never changes another browser's local database. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const binary=require(process.env.CHROMIUM_MODULE?path.resolve(process.env.CHROMIUM_MODULE):'@sparticuz/chromium');
const root=path.resolve(__dirname,'..'),url=process.env.FAM_URL||'http://127.0.0.1:3003/FAM-Grid.html';
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
    await page.screenshot({path:'test-results/grid-login.png'});
    await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();await ready();
    await page.waitForFunction(()=>state.currentView==='sheet');
    await page.screenshot({path:'test-results/grid-empty.png'});
    await page.locator('#grid-demo').click();
    await page.waitForFunction(()=>WB.sheets['تهران']?.rows.length===15);
    await page.waitForFunction(()=>!document.querySelector('#toasts .toast'));
    await page.screenshot({path:'test-results/grid-desktop.png'});
    for(const width of [800,390,320]){
      await page.setViewportSize({width,height:1000});
      await page.screenshot({path:'test-results/grid-'+width+'.png',fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.grid-view-btn').filter({hasText:'نمای کارت‌ها'}).click();
    await page.screenshot({path:'test-results/grid-gallery.png'});
    await page.locator('.grid-record-card').first().click();
    await page.screenshot({path:'test-results/grid-record.png'});
    report.checks.push('Data-first landing, guarded sample loader, desktop/tablet/mobile, table and card views');
    await page.locator('#grid-record-2').fill('GRID-EDIT');await page.locator('#grid-record-save').click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows[1][1]),'GRID-EDIT');
    await page.locator('.grid-view-btn').filter({hasText:'نمای جدولی'}).click();
    const before=await page.evaluate(()=>JSON.stringify(WB.sheets['تهران']));
    await page.locator('#grid-sort-toggle').click();await page.locator('#grid-sort-field').selectOption('1');await page.locator('#grid-sort-direction').selectOption('desc');await page.locator('#grid-sort-apply').click();
    assert.equal(await page.locator('#sheet-body tbody tr:not(.grid-header-row):not(.grid-trailing-row)').first().getAttribute('data-r'),'15');
    assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets['تهران'])),before);
    await page.locator('#sheet-filter').fill('GRID-EDIT');await page.locator('.grid-filter [data-act="filter-rows"]').click();
    assert.match(await page.locator('#grid-row-count').innerText(),/^۱ رکورد/);
    await page.locator('.grid-view-btn').filter({hasText:'نمای کارت‌ها'}).click();assert.equal(await page.locator('.grid-record-card').count(),1);
    await page.locator('.grid-record-card').click();await page.locator('#grid-record-2').fill('GRID-AFTER-SORT');await page.locator('#grid-record-save').click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows[1][1]),'GRID-AFTER-SORT');
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows[14][0]),'DEMO-1-14');
    await page.locator('#sheet-filter').fill('');await page.locator('.grid-filter [data-act="filter-rows"]').click();
    await page.locator('.grid-view-btn').filter({hasText:'نمای جدولی'}).click();await page.locator('#grid-raw').check();
    assert.equal(await page.locator('#sheet-body tr[data-r="1"]').isVisible(),true);await page.locator('#grid-raw').uncheck();
    assert.equal(await page.locator('#sheet-body tr[data-r="1"]').isVisible(),false);
    report.checks.push('Record drawer saves, sorting is view-only, filtering covers table/cards, edit maps to correct original row, raw header view');
    const modal=id=>page.locator(`#modal-overlay.show button[data-id="${id}"]`);
    await page.locator('#grid-add-record').click();await page.locator('[data-p="branch"]').click();
    for(const [i,value] of ['GRID-NEW','رکورد آزمایشی جدید','192.0.2.201','VPN','فعال','ساختگی'].entries())await page.locator(`.wizard-fields input[data-i="${i}"]`).fill(value);
    await page.locator('[data-a="ok"]').click();await modal(6).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows.some(row=>row[0]==='GRID-NEW')),true);
    await page.locator('.grid-global-nav [data-view="panel"]').click();
    await page.locator('#cp-c23').selectOption('تهران');await page.locator('#cp-c25').selectOption('FULLTEXT');await page.locator('#cp-c27').fill('GRID-NEW');
    await page.locator('#fold-ops [data-arg="modRemoveRecord.StartRemoveWizard"]').click();
    await page.locator('#modal-input').fill('ALL');await modal(1).click();await page.locator('#modal-input').fill('1');await modal(1).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows.some(row=>row[0]==='GRID-NEW')),false);
    await page.locator('.grid-global-nav [data-view="panel"]').click();await page.locator('#fold-ops [data-arg="modUndo.UndoLastRemove"]').click();await modal(6).click();await modal(1).click();
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows.some(row=>row[0]==='GRID-NEW')),true);
    const download=page.waitForEvent('download');await page.evaluate(()=>ExportWorkbookXlsx());assert.ok(fs.statSync(await (await download).path()).size>0);
    await page.reload();await ready();await page.waitForFunction(()=>state.currentView==='sheet');
    assert.equal(await page.evaluate(()=>WB.sheets['تهران'].rows[1][1]),'GRID-AFTER-SORT');
    assert.equal(await page.locator('#cp-c27').inputValue(),'GRID-NEW');
    report.checks.push('Visible add/delete/undo flow, Excel export, saved record and delete draft survive reload');
    const emptyBefore=await page.evaluate(()=>JSON.stringify(WB.sheets));await page.evaluate(()=>document.getElementById('grid-demo').click());
    assert.equal(await page.evaluate(()=>JSON.stringify(WB.sheets)),emptyBefore);
    await page.locator('.grid-row-open').first().click();await page.setViewportSize({width:390,height:844});
    const bounds=await page.locator('#grid-record-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
    await page.screenshot({path:'test-results/grid-record-mobile.png'});await page.locator('.grid-record-close').click();
    assert.equal(await page.evaluate(()=>document.querySelectorAll('script[src],link[rel="stylesheet"]').length),0);
    assert.equal(await page.locator('#fx-stage').isVisible(),false);
    assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size;}),true);
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(root,'test-results/grid-smoke-'+report.browser.split('.')[0]+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
