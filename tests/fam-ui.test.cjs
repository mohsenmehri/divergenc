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
    res.end(fs.readFileSync(path.join(root, 'FAM.html')));
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
  await page.waitForFunction(() => document.getElementById('stat-line').textContent.includes('رکورد'));
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
      document.getElementById('stat-line').textContent.includes('رکورد'));
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
  await page.waitForFunction(() => document.querySelector('#cp-c9 option') && document.getElementById('stat-line').textContent.includes('رکورد'));
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

test('no uncaught browser errors or duplicate IDs', async () => {
  assert.deepEqual(errors, []);
  const duplicates = await page.locator('[id]').evaluateAll(es => {
    const ids = es.map(e => e.id); return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  assert.deepEqual(duplicates, []);
});
