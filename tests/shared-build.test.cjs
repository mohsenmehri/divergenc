const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
test('central HTML contains server auth and sync, never restores a local workbook at boot',()=>{
 const html=read('server/www/FAM.html');
 assert.equal((html.match(/id="fam-shared-js"/g)||[]).length,1);
 assert.equal((html.match(/id="fam-local-access-js"/g)||[]).length,1);
 const access=html.match(/<script id="fam-local-access-js">([\s\S]*?)<\/script>/)[1];
 assert.ok(!access.includes('localStorage'));assert.ok(!access.includes('hashPassword'));
 assert.match(access,/FamShared.api\('users'/);assert.match(access,/FamShared.api\('password'/);
 assert.match(access,/function scopeAllowsSheet/);assert.match(access,/manage-category-sections/);
 assert.match(html,/function manageCategorySections\(categoryId\)/);assert.match(html,/sectionInitialized/);
 assert.match(html,/idbDelete=async\(\)=>true/);
 assert.match(html,/await Access.start\(\);\s+await FamShared.load\(\);/);
 assert.equal((html.match(/FamShared.ready\(\)/g)||[]).length,1);
 assert.ok(!html.includes('restore saved session (previously imported data), if any'));
 for(const [,js] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(js);
});
test('light theme only paints: no DOM relocation, box geometry or background shorthand resets',()=>{
 const css=read('src/light-palette.css'),html=read('FAM.html');
 assert.doesNotMatch(css,/(?:^|[;{])\s*(?:display|visibility|position|width|height|min-width|min-height|font|font-size|font-family|padding|margin|gap|order|grid-template-columns|background)\s*:/m);
 assert.doesNotMatch(read('src/ui-theme.js'),/FamOperationsLayout/);
 assert.doesNotMatch(html,/id="fam-operations-js"/);
 assert.match(css,/#fx-stage[^}]*opacity:0!important/);
});
test('central client announces remote server revisions without overwriting local work',()=>{
 const html=read('server/www/FAM.html'),sync=read('src/shared-sync.js');
 assert.match(sync,/live-update-notice/);assert.match(sync,/دریافت نسخهٔ جدید/);
 assert.match(sync,/function hasUnsavedWork\(\)/);assert.match(sync,/if\(signature\(\)!==clean\)/);
 assert.match(sync,/change\?\.actor/);assert.match(html,/id:'live-update-notice'/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modExport\.ExportSearchResults"/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modExport\.ExportChangeLog"/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modFixUnlock\.UnlockDataSheets"/);
});
test('central manual backup requests a verified private server snapshot',()=>{
 const html=read('server/www/FAM.html'),sync=read('src/shared-sync.js');
 assert.match(sync,/backupAll=async\(\)=>\{/);
 assert.match(sync,/if\(!Access\.require\('admin'\)\)return false/);
 assert.match(sync,/api\('backups',\{\}\)/);
 assert.match(sync,/پشتیبان کامل روی سرور ثبت شد/);
 assert.match(html,/api\('backups',\{\}\)/);
});
test('light sidebar clears the dark gradient and hides only theme-1 background controls',()=>{
 const palette=read('src/light-palette.css'),shared=read('src/ui-theme.css');
 assert.match(palette,/#sidebar\{[^}]*background-image:none/);
 assert.match(palette,/html\[data-ui-theme="light"\] select[^\{]*\{color-scheme:light!important;/);
 assert.match(palette,/\.inp option,.inp optgroup,#fx-theme option\{background-color:#fff!important;color:#233e53!important;color-scheme:light!important;\}/);
 assert.match(palette,/html\[data-ui-theme="light"\] select option:hover,/);
 assert.match(palette,/\.toast,#live-update-notice\{background-color:#fff!important;background-image:none!important;color:#203c52!important/);
 assert.match(palette,/\.mbox\{background-color:#fff!important;background-image:none!important;color:#203c52!important/);
 assert.match(shared,/html\[data-ui-theme="light"\] #sidebar \.side-foot > \.fx-bar\{display:none!important;\}/);
 for(const file of ['FAM.html']){
  const html=read(file);
  assert.ok(html.includes(palette));assert.ok(html.includes(shared));
  assert.equal((html.match(/id="fx-strength"/g)||[]).length,1);
  assert.equal((html.match(/id="fx-theme"/g)||[]).length,1);
 }
});
test('the twelve visible tools use a six-column desktop grid',()=>{
 const css=read('FAM.html');
 assert.match(css,/\.tools-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:10px;\}/);
 assert.match(css,/@media \(max-width:1280px\)\{\s*\.cat-tiles\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);\}\s*\.tools-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);\}/);
});
test('service selection buttons contain only the carrier name',()=>{
 const html=read('FAM.html');
 assert.doesNotMatch(html,/remove-service-detail|detail: "بایگانی/);
 assert.match(html,/name: "مخابرات" \}/);
 assert.match(html,/name: "مبین نت" \}/);
 assert.match(html,/name: "آسیاتک" \}/);
});
test('local accounts use dynamic category scope and per-user capabilities, not levels',()=>{
 const access=read('src/local-access.js'),html=read('FAM.html'),css=read('src/local-access.css'),palette=read('src/light-palette.css');
 assert.match(access,/const PERMISSION_GROUPS=/);
 for(const label of ['مشاهدهٔ شیت‌ها و داشبورد','جست‌وجو در داده‌ها','ویرایش مستقیم سلول‌ها','ذخیرهٔ تغییرات نتایج جست‌وجو','مدیریت کاربران و دسترسی‌ها'])assert.ok(access.includes(label),label);
 assert.match(access,/categories:\[\.\.\.new Set/);assert.match(access,/permissions:Array\.isArray/);
 assert.match(access,/managedCategories\(\),CAT_OTHER/);
 assert.match(access,/category!==\'provinces\'/);assert.match(access,/scopeAllowsSheet/);
 assert.match(access,/deleted is deliberately fail-closed/);
 assert.match(access,/id:'user-save'.*text:'ثبت'/);
 assert.match(access,/id:'user-cancel'.*text:'لغو'/);
 assert.match(access,/id:'user-save-new'.*text:'ثبت و ایجاد کاربر جدید'/);
 assert.doesNotMatch(access,/id:'user-role'/);
 assert.doesNotMatch(access,/text:'سطح [۱-۴]'/);
 assert.match(html,/Access\.can\("search-read", n\)/);
 assert.match(html,/Access\.require\("add", sheetName\)/);
 assert.match(html,/Access\.can\("remove", srcSheetName\)/);
 assert.match(html,/Access\.can\("export", name\)/);
 assert.match(css,/#user-delete\{display:inline-flex!important;width:max-content!important/);
 assert.match(palette,/#user-cancel\{background-color:#dce8ef!important/);
});

test('original XLSM bytes remain untouched',()=>{
 const sha=crypto.createHash('sha256').update(fs.readFileSync('Mohsen_FINAL_v5.xlsm')).digest('hex');
 assert.equal(sha,'bf1d5519e8e47b79212ef7bfbb7f0a6585faf6ae8604fd1f73a3af2a3b89ed66');
});
