/* npm ci && npm test. Chromium is supplied by npm; no browser download or
   production dependency is needed. Set CHROMIUM_PATH to use a local browser. */
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const binary = require('@sparticuz/chromium');
let browser, server, page;
const errors = [];
const root = path.resolve(__dirname, '..');
const folds = ['cats', 'ops', 'tools', 'nav', 'status'];
const menu = () => page.locator('[data-act="toggle-sidebar"]');
const modal = id => page.locator(`#modal-overlay.show button[data-id="${id}"]`);
async function assertMenu(open) {
  assert.deepEqual(await page.evaluate(() => ({
    open: document.getElementById('sidebar').classList.contains('open'),
    layout: document.documentElement.classList.contains('menu-open'),
    inert: document.getElementById('sidebar').inert,
    expanded: document.querySelector('[data-act="toggle-sidebar"]').getAttribute('aria-expanded')
  })), { open, layout: open, inert: !open, expanded: String(open) });
}
async function panel() { await page.evaluate(() => switchView('panel')); }

before(async () => {
  // Minimal Linux images lack NSS/NSPR; use the libraries shipped with Chromium.
  const libDir = path.join(root, '.cache', 'chromium-libs');
  if (process.platform === 'linux' && !process.env.CHROMIUM_PATH) {
    fs.mkdirSync(libDir, { recursive: true });
    const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../..');
    const tar = zlib.brotliDecompressSync(fs.readFileSync(path.join(packageRoot, 'bin', 'al2023.tar.br')));
    execFileSync('tar', ['xf', '-', '-C', libDir], { input: tar });
    process.env.LD_LIBRARY_PATH = [path.join(libDir, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, process.env.FAM_FILE || 'FAM.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || await binary.executablePath(),
    args: binary.args.filter(a => a !== '--disable-web-security'), headless: true
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/FAM.html`);
  await page.locator('#auth-password').fill('1109');
  await page.locator('#auth-username').fill('admin');
  await page.locator('#auth-submit').click();
  await page.waitForFunction(() => document.querySelector('#cp-c9 option') && document.getElementById('st-user').textContent.length > 0);
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(r => server.close(r)); });

beforeEach(async () => {
  await panel();
  if (await page.locator('#sidebar').evaluate(e => e.classList.contains('open'))) await menu().click();
  for (const id of folds) {
    const b = page.locator(`[data-fold="fold-${id}"]`);
    if (await b.getAttribute('aria-expanded') === 'false') await b.click();
  }
});

test('menu changes only with its button, not navigation, outside clicks or Escape', async () => {
  await assertMenu(false);
  await menu().click();
  for (let i = 0; i < 2; i++) {
    for (const view of ['sheet', 'results', 'log', 'panel']) {
      await page.locator(`#sidebar [data-view="${view}"]`).click();
      assert.equal(await page.locator(`#view-${view}`).evaluate(e => e.classList.contains('active')), true);
      await assertMenu(true);
    }
  }
  await page.evaluate(() => { switchView('macros'); switchView('panel'); });
  await page.locator('.hero h1').click();
  await page.keyboard.press('Escape');
  await assertMenu(true);
  await menu().click();
  await assertMenu(false);
  await page.locator('[data-view="sheet"]').filter({ hasText: 'مشاهده همه' }).click();
  await assertMenu(false);
  await panel();
});

test('all dashboard folds share aligned frames and preserve their fields', async () => {
  await page.locator('#cp-c11').fill('عبارت آزمایشی');
  for (const id of folds) {
    const btn = page.locator(`[data-fold="fold-${id}"]`);
    const body = page.locator(`#fold-${id}`);
    assert.equal(await btn.getAttribute('aria-controls'), `fold-${id}`);
    assert.equal(await body.evaluate(e => e.parentElement.matches('#view-panel > .content > .dashboard-section')), true);
    await btn.click();
    await page.waitForFunction(id => document.getElementById(id).getBoundingClientRect().height < 1, `fold-${id}`);
    assert.equal(await btn.getAttribute('aria-expanded'), 'false');
    assert.equal(await body.evaluate(e => e.inert), true);
    const geometry = await body.evaluate(e => {
      const card = e.parentElement.getBoundingClientRect(), header = e.previousElementSibling.getBoundingClientRect();
      return { card: card.height, header: header.height, border: getComputedStyle(e.parentElement).borderRadius };
    });
    assert.ok(Math.abs(geometry.card - geometry.header - 2) < 1, JSON.stringify(geometry));
    assert.notEqual(geometry.border, '0px');
  }
  await page.evaluate(() => { switchView('sheet'); switchView('panel'); });
  for (const id of folds) {
    assert.equal(await page.locator(`[data-fold="fold-${id}"]`).getAttribute('aria-expanded'), 'false');
    await page.locator(`[data-fold="fold-${id}"]`).click();
    assert.equal(await page.locator(`#fold-${id}`).evaluate(e => e.inert), false);
  }
  assert.equal(await page.locator('#cp-c11').inputValue(), 'عبارت آزمایشی');
  const boxes = await page.locator('.dashboard-section').evaluateAll(es => es.map(e => {
    const r = e.getBoundingClientRect(); return [r.left, r.width];
  }));
  assert.ok(boxes.every(b => Math.abs(b[0] - boxes[0][0]) < 1 && Math.abs(b[1] - boxes[0][1]) < 1));
});

test('header, frames and menu fit desktop/tablet/mobile, open and closed', async () => {
  for (const width of [1920, 1440, 1280, 1024, 800, 768, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const open of [false, true]) {
      if (open) await menu().click();
      await assertMenu(open);
      // ResizeObserver must have propagated the measured header height.
      await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.getElementById('main-wrap')).paddingTop)
        - document.getElementById('topbar').getBoundingClientRect().height) <= 1);
      const problems = await page.evaluate(() => {
        const bad = [];
        const bar = document.getElementById('topbar').getBoundingClientRect();
        const controls = [...document.querySelectorAll('#topbar button,#topbar input,#topbar .stat-pill,#topbar .user-chip')];
        const frames = [...document.querySelectorAll('.dashboard-section,.dashboard-section .inp,.grid-add .btn')];
        for (const e of [...controls, ...frames]) {
          const r = e.getBoundingClientRect();
          if (r.left < -1 || r.right > innerWidth + 1) bad.push('outside: ' + (e.id || e.className));
        }
        for (const e of controls) {
          const r = e.getBoundingClientRect();
          if (r.top < 0 || r.bottom > bar.bottom + 1) bad.push('outside header: ' + e.id);
        }
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) bad.push('overlap: ' + controls[i].id + '/' + controls[j].id);
        }
        if (document.documentElement.scrollWidth > innerWidth) bad.push('horizontal page overflow');
        if (document.getElementById('sidebar').getBoundingClientRect().top < bar.bottom) bad.push('menu behind header');
        return bad;
      });
      assert.deepEqual(problems, [], `width=${width}, menu=${open}`);
    }
    // Navigation on small screens also leaves the menu open.
    await page.locator('#sidebar [data-view="sheet"]').click();
    await assertMenu(true);
    await page.locator('#sidebar [data-view="panel"]').click();
    await menu().click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('collapsed titles have identical typography and every arrow shares the same vertical axis', async () => {
  for (const id of folds) await page.locator(`[data-fold="fold-${id}"]`).click();
  for (const width of [1485, 1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const open of [false, true]) {
      if (open) await menu().click();
      await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-section > .fold-panel')]
        .every(e => e.getBoundingClientRect().height < 1));
      const headers = await page.locator('.dashboard-section > .card-head').evaluateAll(es => es.map(e => {
        const title = e.querySelector('h3'), style = getComputedStyle(title);
        const t = title.getBoundingClientRect(), arrow = e.querySelector('.fold-btn').getBoundingClientRect();
        const icon = e.querySelector('.ico').getBoundingClientRect();
        return {
          font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, style.color],
          axis: arrow.x + arrow.width / 2, titleRight: t.right,
          arrowWidth: arrow.width, arrowHeight: arrow.height,
          centerDelta: Math.abs(arrow.y + arrow.height / 2 - icon.y - icon.height / 2)
        };
      }));
      assert.equal(headers.length, 5);
      for (const h of headers) {
        assert.deepEqual(h.font, headers[0].font);
        assert.ok(Math.abs(h.axis - headers[0].axis) < 0.5, `arrow alignment: ${width}/${open}`);
        assert.ok(Math.abs(h.titleRight - headers[0].titleRight) < 0.5, `title alignment: ${width}/${open}`);
        assert.equal(h.arrowWidth, 40);
        assert.equal(h.arrowHeight, 40);
        assert.ok(h.centerDelta < 0.5);
      }
    }
    await menu().click();
  }
  await page.setViewportSize({ width: 1485, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'fam-ui-02-folded.png') });
});

test('menu preference survives a full reload in both states', async () => {
  for (const open of [true, false]) {
    await menu().click();
    await assertMenu(open);
    assert.equal(await page.evaluate(() => localStorage.getItem('fam.ui.menu-open')), String(open));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#cp-c9 option') &&
      document.querySelector('#cp-c9 option') && document.getElementById('st-user').textContent.length > 0);
    await assertMenu(open);
    await page.evaluate(() => { switchView('sheet'); switchView('panel'); });
    await assertMenu(open);
  }
});

test('CSV import, direct navigation, search and add/remove launch still work', async () => {
  await page.locator('#import-file-input').setInputFiles({
    name: 'شبکه آزمایشی.csv', mimeType: 'text/csv',
    buffer: Buffer.from('شاخص,نام,IP\n101,رکورد آزمایشی,10.0.0.1\n102,نمونه دوم,10.0.0.2\n')
  });
  await page.waitForFunction(() => !!WB.sheets['شبکه آزمایشی']);
  await menu().click();
  await page.locator('#cp-c41').selectOption('شبکه آزمایشی');
  await page.locator('#fold-nav [data-arg="modUI.NavigateToSheet"]').click();
  await page.waitForFunction(() => state.currentView === 'sheet' && state.currentSheet === 'شبکه آزمایشی');
  await assertMenu(true);
  await page.locator('#sidebar [data-view="panel"]').click();
  await page.locator('#cp-c7').selectOption('شبکه آزمایشی');
  await page.locator('#cp-c9').selectOption('شاخص');
  await page.locator('#cp-c11').fill('101');
  await page.locator('#fold-ops [data-arg="modSearchEngine.SearchRecords"]').click();
  await modal(1).click();
  await page.waitForFunction(() => state.currentView === 'results' && state.results.length === 1);
  await assertMenu(true);
  await page.locator('#sidebar [data-view="panel"]').click();
  await page.locator('#cp-c16').selectOption('شبکه آزمایشی');
  await page.locator('#fold-ops [data-arg="modAddRecord.StartAddWizard"]').click();
  assert.equal(await page.locator('#modal-overlay .wizard-fields input').count(), 3);
  await page.locator('#modal-overlay [data-a="cancel"]').click();
  await panel();
  await page.locator('#cp-c23').selectOption('شبکه آزمایشی');
  await page.locator('#cp-c25').selectOption('شاخص');
  await page.locator('#cp-c27').fill('101');
  await page.locator('#fold-ops [data-arg="modRemoveRecord.StartRemoveWizard"]').click();
  await page.locator('#modal-input').waitFor();
  await modal(2).click();
  assert.equal(await page.evaluate(() => WB.sheets['شبکه آزمایشی'].rows.length), 3);
  await assertMenu(true);
  await menu().click();
});

async function categoryManager() {
  await panel();
  await page.locator('#view-panel [data-act="manage-categories"]').click();
  await page.locator('#category-manager-title').waitFor();
}
async function categoryReload() {
  await page.evaluate(() => flushDeepSave());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#cp-c9 option') && document.querySelector('#cp-c9 option') && document.getElementById('st-user').textContent.length > 0);
}
async function businessSheets() {
  return page.evaluate(() => Object.fromEntries(WB.order.filter(IsDataSheet).map(n=>[n,WB.sheets[n]])));
}
let customCategoryId, savedCategoryName = 'دسته آزمایشی <b>متن</b>';

test('category manager creates, renames, moves sheets and cancels without changing data', async () => {
  await page.evaluate(() => importCsvText('تجهیزات آزمایشی.csv', 'شاخص,نام\n201,تجهیز آزمایشی\n'));
  const before = await businessSheets();
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').id),'equipment');
  await categoryManager();
  assert.equal(await page.locator('[data-category-id]').count(),6);
  await page.locator('#category-new').click();
  await page.locator('#category-name').fill(savedCategoryName);
  await page.locator('[data-category-sheet="تجهیزات آزمایشی"]').check();
  await page.locator('[data-category-sheet="شبکه آزمایشی"]').check();
  customCategoryId = await page.locator('.category-choice.active').getAttribute('data-category-id');
  // Changes are staged until Save.
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').id),'equipment');
  await page.locator('#category-save').click();
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').id),customCategoryId);
  assert.equal(await page.evaluate(()=>categoryOf('شبکه آزمایشی').id),customCategoryId);
  assert.deepEqual(await businessSheets(),before);
  assert.equal(await page.locator(`#dash-cats [data-cat="${customCategoryId}"] .ct-name`).textContent(),savedCategoryName);
  assert.equal(await page.locator(`#dash-cats [data-cat="${customCategoryId}"] .ct-name b`).count(),0);
  assert.equal(await page.locator('#cp-c7 optgroup').evaluateAll(es=>es.some(e=>e.label.includes('<b>متن</b>'))),true);
  await categoryReload();
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').id),customCategoryId);
  await categoryManager();
  await page.locator(`[data-category-id="${customCategoryId}"]`).click();
  await page.locator('#category-name').fill('تغییر لغوشده');
  await page.locator('[data-category-sheet="تجهیزات آزمایشی"]').uncheck();
  await page.locator('#category-cancel').click();
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').name),savedCategoryName);
  await categoryManager();
  await page.locator('[data-category-id="services"]').click();
  await page.locator('#category-name').fill('شبکه‌های سازمان');
  await page.locator('#category-save').click();
  assert.equal(await page.evaluate(()=>managedCategories().find(c=>c.id==='services').name),'شبکه‌های سازمان');
});

test('category names validate; membership filtering and mobile management work', async () => {
  await categoryManager();
  await page.locator('#category-name').fill('   ');
  await page.locator('#category-save').click();
  assert.equal(await page.locator('#modal-overlay.show').count(),1);
  assert.match(await page.locator('#category-error').textContent(),/خالی/);
  await page.locator('#category-name').fill(savedCategoryName);
  await page.locator('#category-save').click();
  assert.match(await page.locator('#category-error').textContent(),/تکراری/);
  await page.locator('#category-cancel').click();
  await page.setViewportSize({width:390,height:844});
  await categoryManager();
  await page.locator(`[data-category-id="${customCategoryId}"]`).click();
  await page.locator('#category-sheet-search').fill('تجهیزات');
  assert.equal(await page.locator('[data-category-sheet]').count(),1);
  await page.locator('#category-remove-visible').click();
  await page.locator('#category-save').click();
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات آزمایشی').id),'other');
  assert.equal(await page.evaluate(()=>categoryOf('شبکه آزمایشی').id),customCategoryId);
  await categoryManager();
  const bounds=await page.locator('.category-manager').boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
  assert.equal(await page.locator('[data-category-sheet="CONTROL_PANEL"]').count(),0);
  await page.screenshot({path:path.join(root,'test-results','category-manager-mobile.png')});
  await page.locator('#category-cancel').click();
  await page.setViewportSize({width:1485,height:1000});
});

test('JSON backup and both restore routes preserve category names and memberships', async () => {
  const expected=await page.evaluate(()=>state.categoryConfig);
  const downloaded=page.waitForEvent('download');
  await page.evaluate(()=>backupAll());
  const download=await downloaded;
  const file=await download.path();
  const content=fs.readFileSync(file);
  assert.deepEqual(JSON.parse(content).categoryConfig,expected);
  await page.evaluate(()=>{state.categoryConfig=null;refreshCategoryUI();});
  await page.locator('#import-file-input').setInputFiles({name:'categories.json',mimeType:'application/json',buffer:content});
  await page.waitForFunction(()=>state.categoryConfig!==null);
  assert.deepEqual(await page.evaluate(()=>state.categoryConfig),expected);
  await page.evaluate(()=>{state.categoryConfig=null;refreshCategoryUI();});
  const chooserPromise=page.waitForEvent('filechooser');
  await page.evaluate(()=>restoreAll());
  const chooser=await chooserPromise;
  await chooser.setFiles({name:'categories.json',mimeType:'application/json',buffer:content});
  await page.waitForFunction(()=>state.categoryConfig!==null);
  assert.deepEqual(await page.evaluate(()=>state.categoryConfig),expected);
  await categoryReload();
  assert.deepEqual(await page.evaluate(()=>state.categoryConfig),expected);
  // Old backups with no category field use the original defaults.
  assert.equal(await page.evaluate(()=>normalizeCategoryConfig(undefined)),null);
  assert.equal(await page.evaluate(()=>normalizeCategoryConfig({version:1,categories:[{id:'system',name:'bad'}],assignments:[]})),null);
});

test('deleting custom/default categories preserves worksheets and resets a removed filter', async () => {
  const before=await businessSheets();
  await page.evaluate(id=>setCatFilter(id),customCategoryId);
  await categoryManager();
  await page.locator(`[data-category-id="${customCategoryId}"]`).click();
  await page.locator('#category-delete').click();
  await page.locator('#category-delete').click();
  await page.locator('#category-save').click();
  assert.equal(await page.evaluate(()=>state.catFilter),'all');
  assert.equal(await page.evaluate(()=>categoryOf('شبکه آزمایشی').id),'other');
  await categoryManager();
  await page.locator('[data-category-id="equipment"]').click();
  await page.locator('#category-delete').click();
  await page.locator('#category-delete').click();
  await page.locator('#category-save').click();
  assert.deepEqual(await businessSheets(),before);
  await categoryReload();
  assert.equal(await page.evaluate(()=>managedCategories().some(c=>c.id==='equipment')),false);
  assert.equal(await page.evaluate(()=>categoryOf('تجهیزات جدید واردشده').id),'other');
  assert.equal(await page.evaluate(()=>categoryOf('CONTROL_PANEL').id),'system');
  // Restore the tested starting preferences for subsequent interactive inspection.
  await page.evaluate(()=>{state.categoryConfig=null;saveState();refreshCategoryUI();});
});

test('category cards automatically fill a row up to twenty then wrap, including Other', async () => {
  const original=await page.evaluate(()=>state.categoryConfig);
  for (const width of [1920,1440,390]) {
    await page.setViewportSize({width,height:1000});
    for (const count of [1,7,20,21,40,41]) {
      await page.evaluate(count=>{
        state.categoryConfig={version:1,categories:Array.from({length:count},(_,i)=>({id:'test-'+i,name:'دسته '+i,sub:'',color:'#2fd4c4',icon:'layers'})),
          assignments:WB.order.filter(IsDataSheet).map(n=>[n,'test-0'])};
        renderDashCats();
      },count);
      const boxes=await page.locator('#dash-cats .cat-tile').evaluateAll(es=>es.map(e=>{
        const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};
      }));
      assert.equal(boxes.length,count);
      const cols=Math.min(count,20);
      boxes.forEach((b,i)=>{
        assert.ok(Math.abs(b.y-boxes[Math.floor(i/cols)*cols].y)<1);
        assert.ok(Math.abs(b.width-boxes[0].width)<1);
        if(i>=cols) assert.ok(b.y>boxes[i-cols].y);
      });
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
  }
  await page.evaluate(original=>{state.categoryConfig=original;renderDashCats();},original);
  await page.setViewportSize({width:1440,height:1000});
});

test('quick actions expand inline without executing and stay synchronized with dashboard', async () => {
  await menu().click();
  const before=await businessSheets();
  const currentView=await page.evaluate(()=>state.currentView);
  for(const key of ['search','add','remove','undo','nav']) {
    const trigger=page.locator(`[aria-controls="quick-${key}"]`);
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator(`#quick-${key}`).evaluate(e=>e.inert),false);
    assert.equal(await page.locator('#modal-overlay.show').count(),0);
    assert.equal(await page.evaluate(()=>state.currentView),currentView);
    await trigger.click();
    assert.equal(await page.locator(`#quick-${key}`).evaluate(e=>e.inert),true);
  }
  assert.deepEqual(await businessSheets(),before);
  await page.locator('[aria-controls="quick-add"]').click();
  await page.locator('#quick-cp-c16').selectOption('شبکه آزمایشی');
  assert.equal(await page.locator('#cp-c16').inputValue(),'شبکه آزمایشی');
  await page.locator('#quick-add [data-arg="modAddRecord.StartAddWizard"]').click();
  await page.locator('#modal-overlay .wizard-fields').waitFor();
  await page.locator('#modal-overlay [data-a="cancel"]').click();
  await page.locator('[aria-controls="quick-search"]').click();
  await page.locator('#quick-cp-c7').selectOption('شبکه آزمایشی');
  await page.locator('#quick-cp-c9').selectOption('شاخص');
  await page.locator('#quick-cp-c11').fill('101');
  assert.equal(await page.locator('#cp-c11').inputValue(),'101');
  const prev=await page.evaluate(()=>state.cp.B12);
  await page.locator('#quick-exact-toggle').click();
  assert.notEqual(await page.evaluate(()=>state.cp.B12),prev);
  await page.locator('#quick-search [data-arg="modSearchEngine.SearchRecords"]').click();
  await modal(1).click();
  await page.waitForFunction(()=>state.currentView==='results' && state.results.length===1);
  await assertMenu(true);
  await page.locator('[aria-controls="quick-remove"]').click();
  await page.locator('#quick-cp-c23').selectOption('شبکه آزمایشی');
  await page.locator('#quick-cp-c25').selectOption('شاخص');
  await page.locator('#quick-cp-c27').fill('101');
  await page.locator('#quick-remove [data-arg="modRemoveRecord.StartRemoveWizard"]').click();
  await page.locator('#modal-input').waitFor();await modal(2).click();
  await page.locator('[aria-controls="quick-nav"]').click();
  await page.locator('#quick-cp-c41').selectOption('شبکه آزمایشی');
  await page.locator('#quick-nav [data-arg="modUI.NavigateToSheet"]').click();
  await page.waitForFunction(()=>state.currentSheet==='شبکه آزمایشی' && state.currentView==='sheet');
  await assertMenu(true);
  await panel();
  await page.locator('#cp-c16').selectOption('تجهیزات آزمایشی');
  assert.equal(await page.locator('#quick-cp-c16').inputValue(),'تجهیزات آزمایشی');
  for(const width of [1440,800,390,320]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.locator('#quick-access').evaluate(root=>{
      const bounds=root.getBoundingClientRect();
      return [...root.querySelectorAll('input,select,button')].every(e=>{
        const r=e.getBoundingClientRect();return r.left>=bounds.left-1 && r.right<=bounds.right+1;
      });
    }),true);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(root,'test-results','quick-access-ui04.png')});
  assert.deepEqual(await businessSheets(),before);
  for(const key of ['search','add','remove','undo','nav']) {
    const trigger=page.locator(`[aria-controls="quick-${key}"]`);
    if(await trigger.getAttribute('aria-expanded')==='true')await trigger.click();
  }
  await menu().click();
});

test('workbook coordinate badges are absent from user-facing forms and descriptions', async () => {
  assert.equal(await page.locator('.ref').count(),0);
  const text=await page.locator('#view-panel').innerText();
  assert.doesNotMatch(text,/\b(?:B12|C7|C9|C11|C16|C23|C25|C27|C41)\b/);
  await menu().click();
  await page.locator('[aria-controls="quick-remove"]').click();
  await page.locator('#quick-cp-c27').fill('');
  await page.locator('#quick-remove [data-arg="modRemoveRecord.StartRemoveWizard"]').click();
  assert.doesNotMatch(await page.locator('#modal-overlay.show').innerText(),/C27/);
  await modal(1).click();
  await page.locator('[aria-controls="quick-remove"]').click();
  await menu().click();
});

test('UI-05 branding and header show only the editable identity', async () => {
  assert.equal(await page.title(), (process.env.FAM_FILE === 'FAM-Operations.html' ? 'میزکار عملیاتی — ' : '') + 'تجارت الکترونیک و فناوری اطلاعات ملل (فام)');
  assert.equal(await page.locator('.brand-name').textContent(), 'تجارت الکترونیک و فناوری اطلاعات ملل (فام)');
  assert.equal((await page.locator('.hero-tag').innerText()).trim(), 'اداره‌ی ارتباطات و شبکه');
  assert.equal(await page.locator('.hero h1').innerText(), 'سامانه مدیریت اطلاعات شبکه‌ی LAN, WAN، سراسری شعب و خودپردازها، مراکز داده و ...');
  assert.doesNotMatch(await page.locator('#topbar').innerText(), /رکورد ایندکس|بخش •|Network Admin/);
  assert.equal(await page.locator('#st-user').count(), 1);
  assert.equal(await page.locator('#st-user').innerText(), 'admin');
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({width, height:1000});
    assert.equal(await page.locator('#st-user').isVisible(), true);
    await page.locator('#stat-line').click();
    assert.equal(await page.locator('#account-manage').isVisible(), true);
    assert.equal(await page.locator('#account-logout').isVisible(), true);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440, height:1000});
});

async function enterSecret(value) {
  const input = page.locator('#modal-input');
  await input.waitFor();
  assert.equal(await input.getAttribute('type'), 'password');
  await input.fill(value);
  assert.doesNotMatch(await page.locator('#modal-overlay').innerText(), /1109|12346?/);
  await modal(1).click();
}

test('account manager protects identity and preserves it independently of workbook backups', async () => {
  const initial = await page.evaluate(() => state.user);
  await page.locator('#stat-line').click();
  await page.locator('#account-manage').click();
  await page.locator('#user-'+await page.evaluate(()=>Access.current().id)).click();
  await page.locator('#user-name').fill('لغوشده');
  await page.locator('#users-done').click();
  assert.equal(await page.evaluate(() => state.user), initial);
  await page.locator('#stat-line').click();
  await page.locator('#account-manage').click();
  await page.locator('#user-'+await page.evaluate(()=>Access.current().id)).click();
  assert.equal(await page.locator('#user-password').getAttribute('type'), 'password');
  assert.equal(await page.locator('#user-password').inputValue(), '');
  const name = 'مدیر ارتباطات <b>شبکه</b>';
  await page.locator('#user-name').fill(name);
  await page.locator('#user-save').click();
  await page.waitForFunction(name => document.getElementById('st-user').textContent === name, name);
  assert.equal(await page.locator('#st-user b').count(), 0);
  await page.locator('#users-done').click();
  await page.evaluate(() => flushDeepSave());
  await page.reload();
  await page.waitForFunction(name => document.getElementById('st-user').textContent === name, name);
  assert.equal(await page.evaluate(() => applyJsonBackup('identity-test.json', {
    order: WB.order, sheets: WB.sheets, categoryConfig: state.categoryConfig, user: 'unapproved'
  })), true);
  assert.equal(await page.evaluate(() => state.user), name);
  await page.locator('#stat-line').click();
  await page.locator('#account-manage').click();
  await page.locator('#user-'+await page.evaluate(()=>Access.current().id)).click();
  await page.locator('#user-name').fill('WEB USER');
  await page.locator('#user-save').click();
  await page.waitForFunction(() => state.user === 'WEB USER');
  await page.locator('#users-done').click();
});

test('all web unlock paths use the new masked password and reject old passwords', async () => {
  assert.deepEqual(await page.evaluate(async () => Promise.all(
    ['1109','۱۱۰۹','١١٠٩','1234','12346','',null].map(verifyLocalPassword)
  )), [true,true,true,false,false,false,false]);
  for (const method of ['modUI.UnprotectControlPanel', 'modLayout.UnprotectCP', 'modFixUnlock.UnlockDataSheets', 'toggleSheetLock']) {
    const sheet = await page.evaluate(() => {
      const name = WB.order.find(IsDataSheet);
      state.currentSheet = name; state.lockedSheets[name] = true; state.panelProtected = true;
      return name;
    });
    for (const value of [null, '1234', '12346', '1109']) {
      await page.evaluate(method => { void ({
        'modUI.UnprotectControlPanel': () => modUI.UnprotectControlPanel(),
        'modLayout.UnprotectCP': () => modLayout.UnprotectCP(),
        'modFixUnlock.UnlockDataSheets': () => modFixUnlock.UnlockDataSheets(),
        'toggleSheetLock': () => toggleSheetLock()
      })[method](); }, method);
      await page.locator('#modal-input').waitFor();
      if (value === null) { await modal(2).click(); }
      else {
        await enterSecret(value);
        if (value !== '1109') {
          await page.locator('#modal-overlay.show').getByText('رمز عبور نادرست است.').waitFor();
          await modal(1).click();
        } else if (method === 'modFixUnlock.UnlockDataSheets') {
          await modal(1).click();
        }
      }
      const isPanel = method.includes('ControlPanel') || method.includes('UnprotectCP');
      await page.waitForFunction(({sheet,isPanel,locked}) =>
        (isPanel ? state.panelProtected : !!state.lockedSheets[sheet]) === locked,
        {sheet,isPanel,locked:value !== '1109'});
      assert.equal(await page.evaluate(() => ModalBox.lastValue), undefined);
    }
  }
  await panel();
});

test('macro descriptions, source viewer and source exports do not reveal passwords', async () => {
  await page.evaluate(() => switchView('macros'));
  assert.doesNotMatch(await page.locator('#view-macros').innerText(), /\b(?:1109|1234|12346)\b/);
  await page.evaluate(() => { showVbaSource('modConstants.bas'); });
  const text = await page.locator('#modal-overlay.show').innerText();
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /\b(?:1109|1234|12346)\b/);
  await modal(1).click();
  const exported = await page.evaluate(() => {
    const original = DownloadFile; let content;
    try { DownloadFile = (name, text) => { content = text; }; modExportAllModules.DownloadModule('modConstants.bas'); }
    finally { DownloadFile = original; }
    return content;
  });
  assert.match(exported, /\[REDACTED\]/);
  assert.doesNotMatch(exported, /\b(?:1109|1234|12346)\b/);
  await panel();
  await menu().click();
  await page.screenshot({path:path.join(root,'test-results','branding-ui05.png')});
  await menu().click();
});

test('four regions contain the exact 31 provinces and recognize legacy worksheet names', async () => {
  const expected = [
    ['خراسان رضوی','خراسان شمالی','خراسان جنوبی','سیستان و بلوچستان','گلستان'],
    ['تهران'],
    ['اردبیل','آذربایجان غربی','آذربایجان شرقی','خوزستان','قم','کردستان','لرستان','همدان','مرکزی','کرمانشاه','قزوین','زنجان','البرز','کهگیلویه و بویراحمد'],
    ['فارس','ایلام','اصفهان','بوشهر','چهارمحال و بختیاری','سمنان','یزد','گیلان','مازندران','هرمزگان','کرمان']
  ];
  assert.deepEqual(await page.evaluate(() => PROVINCE_REGIONS.map(r => r.names)),expected);
  const mapped = await page.evaluate(() => PROVINCIAL_SHEETS.map(n => provinceOf(n)?.name));
  assert.equal(mapped.length,31);
  assert.equal(new Set(mapped).size,31);
  assert.ok(mapped.every(n => expected.flat().includes(n)));
  assert.deepEqual(await page.evaluate(() => ['مرکز داده تهران','تجهیزات شبکه خودپرداز','شعب','شعب ادغامی'].map(provinceOf)),[null,null,null,null]);
  assert.equal(await page.evaluate(() => provinceOf('استان آذربایجان شرقی').region),'3');
});

test('province navigation keeps all rows in Branch and ATMs empty without editing the workbook', async () => {
  await page.evaluate(() => {
    state.categoryConfig = null;
    for (const name of PROVINCIAL_SHEETS) {
      const sheet = ensureSheet(name,true);
      sheet.rows = [['شاخص','نام'],['101','داده شعبه'],['شبکه خودپرداز',''],['202','داده قدیمی خودپرداز']];
      sheet.merges = [{r1:2,c1:1,r2:2,c2:1}];
    }
    ensureSheet('شعب',true).rows = [['نام'],['شیت تجمیعی']];
    saveState(); initUIFromState();
    openCategory('provinces');
  });
  const before = await businessSheets();
  assert.equal(await page.locator('.region-choice').count(),4);
  for (const [i,count] of [[1,5],[2,1],[3,14],[4,11]]) {
    await page.locator(`[data-region="${i}"]`).click();
    assert.equal(await page.locator('.province-card').count(),count);
    assert.equal(await page.locator('.province-sections button').count(),count*2);
  }
  await page.locator('[data-region="3"]').click();
  await page.locator('[data-province="3-14"][data-section="branch"]').click();
  await page.waitForFunction(() => state.currentSheet === 'کهکلویه');
  assert.equal(await page.locator('#sheet-title').innerText(),'کهگیلویه و بویراحمد — شعبه');
  assert.match(await page.locator('#sheet-body').innerText(),/داده شعبه/);
  assert.match(await page.locator('#sheet-body').innerText(),/داده قدیمی خودپرداز/);
  await categoryReload();
  assert.equal(await page.evaluate(() => state.provinceView.section),'branch');
  assert.equal(await page.locator('#sheet-title').innerText(),'کهگیلویه و بویراحمد — شعبه');
  await page.locator('[data-province="3-14"][data-section="atm"]').click();
  assert.equal(await page.evaluate(() => state.currentSheet),null);
  assert.equal(await page.locator('#sheet-body table').count(),0);
  assert.equal(await page.locator('#sheet-body').innerText(),'');
  assert.equal(await page.locator('#sheet-title').innerText(),'کهگیلویه و بویراحمد — خودپرداز');
  await categoryReload();
  assert.equal(await page.locator('#sheet-title').innerText(),'کهگیلویه و بویراحمد — خودپرداز');
  assert.equal(await page.locator('#sheet-body table').count(),0);
  assert.deepEqual(await businessSheets(),before);
  // Aggregate sheets remain accessible, not misclassified as a province.
  await page.locator('.province-other [data-name="شعب"]').click();
  assert.equal(await page.evaluate(() => state.currentSheet),'شعب');
  assert.equal(await page.locator('#sheet-title').innerText(),'شعب');
  // Explicit category assignments continue to take precedence.
  await page.evaluate(() => {
    state.categoryConfig = defaultCategoryConfig();
    state.categoryConfig.assignments.push(['استان تهران','other']);
    openCategory('provinces');
  });
  await page.locator('[data-region="2"]').click();
  await page.locator('[data-province="2-1"][data-section="branch"]').click();
  assert.equal(await page.evaluate(() => state.currentSheet),null);
  assert.match(await page.locator('#sheet-body').innerText(),/موجود نیست/);
  assert.deepEqual(await businessSheets(),before);
  await page.evaluate(() => { state.categoryConfig = null; state.provinceView = null; state.currentSheet = null; initUIFromState(); });
});

test('dashboard buttons and sheet toolbar align side by side and stay within mobile bounds', async () => {
  for (const width of [1920,1440,1024,800,390,320]) {
    await page.setViewportSize({width,height:1000});
    await panel();
    const header = page.locator('.cat-header-actions');
    const dashboard = await header.locator('button').evaluateAll(es => es.map(e => {
      const r = e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    }));
    assert.ok(Math.abs(dashboard[0].top-dashboard[1].top)<1);
    assert.ok(dashboard[0].left >= dashboard[1].right, 'Manager is to the right of View all');
    await page.evaluate(() => openCategory('provinces'));
    await page.locator('[data-region="3"]').click();
    const dims = await page.locator('.sheet-toolbar').evaluate(root => {
      const es=[...root.querySelectorAll('button,input')];
      const rs=es.map(e=>({id:e.id||e.dataset.act,...Object.fromEntries(['left','right','top','bottom','height'].map(k=>[k,e.getBoundingClientRect()[k]]))}));
      const pairs=[];
      for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++)if(Math.min(rs[i].right,rs[j].right)>Math.max(rs[i].left,rs[j].left)+1 && Math.min(rs[i].bottom,rs[j].bottom)>Math.max(rs[i].top,rs[j].top)+1)pairs.push([rs[i].id,rs[j].id]);
      return {rs,pairs,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.deepEqual(dims.pairs,[],`width=${width}`);
    assert.equal(dims.overflow,false,`width=${width}`);
    assert.ok(dims.rs.every(r=>r.left>=0&&r.right<=width&&r.height===40));
    const [manager,dash,input] = dims.rs;
    const filterButton = dims.rs.find(r=>r.id==='filter-rows');
    assert.ok(Math.abs(input.top-filterButton.top)<1, 'Filter stays on the same row as its input');
    assert.ok(Math.abs(input.left-filterButton.right-8)<1, 'Filter gap is exactly 8px, including mobile');
    assert.equal(manager.top,dash.top);
    assert.ok(manager.left>=dash.right);
    if(width>540) { assert.equal(dash.top,input.top);assert.ok(dash.left>=input.right); }
    if(width>=1024) assert.equal(new Set(dims.rs.map(r=>r.top)).size,1);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(root,'test-results','regions-ui06.png')});
  await panel();
  await page.screenshot({path:path.join(root,'test-results','buttons-ui06.png')});
});

async function regionManager() {
  await page.evaluate(()=>openCategory('provinces'));
  await page.locator('[data-act="manage-regions"]').click();
  await page.locator('#region-manager-title').waitFor();
}
let regionId;
test('region manager stages renames, additions, province moves and removals without changing rows', async () => {
  await page.evaluate(()=>{
    state.regionConfig=null;state.categoryConfig=null;
    ensureSheet('استان تهران',true).rows=[['شاخص','نام'],['77','اطلاعات محفوظ']];
    saveState();initUIFromState();
  });
  const before=await businessSheets();
  await regionManager();
  await page.locator('#region-name').fill('منطقه شمال <b>نام</b>');
  await page.locator('[data-region-province="2-1"]').check();
  await page.locator('[data-region-province="1-1"]').uncheck();
  assert.equal(await page.evaluate(()=>state.regionConfig),null);
  await page.locator('#region-new').click();
  regionId=await page.locator('.category-choice.active').getAttribute('data-region-id');
  await page.locator('#region-name').fill('منطقه آزمایشی');
  await page.locator('#region-province-search').fill('گلستان');
  assert.equal(await page.locator('[data-region-province]').count(),1);
  await page.locator('[data-region-province="1-5"]').check();
  await page.locator('#region-save').click();
  assert.equal(await page.evaluate(()=>provinceOf('استان تهران').region),'1');
  assert.equal(await page.evaluate(()=>provinceOf('خراسان رضوی').region),'unassigned');
  assert.equal(await page.evaluate(()=>provinceOf('گلستان').region),regionId);
  assert.equal(await page.locator('[data-region="1"] b').innerText(),'منطقه شمال <b>نام</b>');
  assert.equal(await page.locator('[data-region="1"] b b').count(),0);
  const expected=await page.evaluate(()=>state.regionConfig);
  await regionManager();
  await page.locator('#region-name').fill('لغوشده');
  await page.locator('[data-region-province="2-1"]').uncheck();
  await page.locator('#region-cancel').click();
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  await regionManager();await page.locator('#region-new').click();await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  await categoryReload();
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  assert.deepEqual(await businessSheets(),before);
});

test('region metadata survives all save and backup paths; legacy JSON restores defaults', async () => {
  const expected=await page.evaluate(()=>state.regionConfig);
  assert.ok(expected);
  assert.equal(await page.evaluate(()=>buildStateAttempts().attempts.every(p=>JSON.stringify(p.regionConfig)===JSON.stringify(state.regionConfig))),true);
  const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>backupAll());
  const download=await downloadPromise;const bytes=fs.readFileSync(await download.path());
  assert.deepEqual(JSON.parse(bytes).regionConfig,expected);
  await page.evaluate(()=>{state.regionConfig=null;});
  await page.locator('#import-file-input').setInputFiles({name:'regions.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>state.regionConfig!==null);
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  await page.evaluate(()=>{state.regionConfig=null;});
  const chooserPromise=page.waitForEvent('filechooser');await page.evaluate(()=>restoreAll());
  await (await chooserPromise).setFiles({name:'regions.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>state.regionConfig!==null);
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  await categoryReload();assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  // CSV data import retains the region metadata, while an old full backup uses defaults.
  await page.evaluate(()=>importCsvText('منطقه تست.csv','نام\nنمونه\n'));
  assert.deepEqual(await page.evaluate(()=>state.regionConfig),expected);
  const legacy=JSON.parse(bytes);delete legacy.regionConfig;
  await page.evaluate(p=>applyJsonBackup('legacy.json',p),legacy);
  assert.equal(await page.evaluate(()=>state.regionConfig),null);
  assert.deepEqual(await page.evaluate(()=>managedRegions().map(r=>r.names.length)),[5,1,14,11]);
  await page.evaluate(p=>applyJsonBackup('regions.json',p),JSON.parse(bytes));
});

test('region validation, mobile dialog and deleting all regions preserve all 31 provinces', async () => {
  const before=await businessSheets();
  await regionManager();
  for(const invalid of ['','منطقه دو','بدون منطقه']){
    await page.locator('#region-name').fill(invalid);await page.locator('#region-save').click();
    assert.match(await page.locator('#region-error').innerText(),/نام منطقه/);
    assert.equal(await page.locator('#region-manager-title').isVisible(),true);
  }
  await page.locator('#region-cancel').click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:900});await regionManager();
    assert.equal(await page.locator('.category-manager').evaluate(box=>box.scrollWidth<=box.clientWidth+1),true);
    await page.locator('#region-close').click();
  }
  await page.setViewportSize({width:1440,height:1000});await regionManager();
  await page.locator('[data-region-id="1"]').click();
  await page.locator('#region-delete').click();
  assert.equal(await page.locator('[data-region-id="1"]').count(),1);
  await page.locator('#region-delete').click();await page.locator('#region-save').click();
  assert.equal(await page.evaluate(()=>provinceOf('استان تهران').region),'unassigned');
  await page.locator('[data-region="unassigned"]').click();
  await page.locator('[data-province="2-1"][data-section="branch"]').click();
  assert.equal(await page.evaluate(()=>state.currentSheet),'استان تهران');
  assert.match(await page.locator('#sheet-body').innerText(),/اطلاعات محفوظ/);
  await regionManager();
  while(await page.locator('[data-region-id]').count()){
    await page.locator('#region-delete').click();await page.locator('#region-delete').click();
  }
  await page.locator('#region-save').click();
  assert.deepEqual(await page.evaluate(()=>managedRegions().map(r=>[r.id,r.names.length])),[['unassigned',31]]);
  assert.equal(await page.locator('.province-card').count(),31);
  assert.deepEqual(await businessSheets(),before);
  const validation=await page.evaluate(()=>{
    const r=defaultRegionConfig();r.assignments.push(['2-1','3']);
    return normalizeRegionConfig(r);
  });
  assert.equal(validation,null);
  // Reassign from the unassigned group after deleting every region.
  await regionManager();await page.locator('#region-new').click();
  await page.locator('#region-name').fill('منطقه بازسازی‌شده');
  await page.locator('[data-region-province="2-1"]').check();
  await page.screenshot({path:path.join(root,'test-results','region-manager-ui07.png')});
  await page.locator('#region-save').click();
  assert.notEqual(await page.evaluate(()=>provinceOf('استان تهران').region),'unassigned');
  assert.deepEqual(await businessSheets(),before);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(root,'test-results','filter-ui07.png')});
});

test('processed fam-1 logo is embedded unchanged and fits the sidebar on desktop and mobile', async () => {
  const image=page.locator('.brand-logo img');
  const data=await image.getAttribute('src');
  assert.deepEqual(Buffer.from(data.split(',')[1],'base64'),fs.readFileSync(path.join(root,'assets/fam-1-glass.png')));
  assert.match(await image.getAttribute('alt'),/فام/);
  assert.equal(await page.locator('.brand-logo svg').count(),0);
  await page.waitForFunction(()=>document.querySelector('.brand-logo img').complete && document.querySelector('.brand-logo img').naturalWidth>0);
  for(const width of [1440,800,390,320]){
    await page.setViewportSize({width,height:1000});
    if(!await page.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await menu().click();
    await assertMenu(true);
    const fits=await image.evaluate(img=>{
      const r=img.getBoundingClientRect(),b=img.closest('.brand').getBoundingClientRect();
      return r.width>0 && r.height>0 && r.left>=b.left && r.right<=b.right && r.top>=b.top && r.bottom<=b.bottom && getComputedStyle(img).objectFit==='contain';
    });
    assert.equal(fits,true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#sidebar').evaluate(e=>e.scrollTop=0);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.waitForFunction(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;});
  await page.locator('.brand').screenshot({path:path.join(root,'test-results','fam-logo-ui08.png'),animations:'disabled'});
  await menu().click();
});

test('no uncaught browser errors or duplicate IDs', async () => {
  assert.deepEqual(errors, []);
  const duplicates = await page.locator('[id]').evaluateAll(es => {
    const ids = es.map(e => e.id); return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  assert.deepEqual(duplicates, []);
});
