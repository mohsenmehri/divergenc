const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
const CENTRAL='server/private_ui/FAM.html';
test('central HTML contains server auth and sync, never restores a local workbook at boot',()=>{
 const html=read(CENTRAL);
 assert.equal((html.match(/id="fam-shared-js"/g)||[]).length,1);
 assert.equal((html.match(/id="fam-local-access-js"/g)||[]).length,1);
 const access=html.match(/<script id="fam-local-access-js">([\s\S]*?)<\/script>/)[1];
 assert.ok(!access.includes('localStorage'));assert.ok(!access.includes('hashPassword'));
 assert.match(access,/FamShared.api\('users'/);assert.match(access,/FamShared.api\('password'/);
 assert.match(access,/function scopeAllowsSheet/);assert.match(access,/manage-category-sections/);
 assert.match(access,/const PERMISSION_GROUPS=/);assert.match(access,/categories:\[\.\.\.cs\]/);assert.match(access,/permissions:\[\.\.\.ps\]/);assert.match(access,/Do not silently broaden a retained legacy account/);
 assert.doesNotMatch(access,/id:'user-role'/);assert.doesNotMatch(access,/سطح [۱-۴]/);
 assert.match(html,/function manageCategorySections\(categoryId\)/);assert.match(html,/sectionInitialized/);
 assert.match(html,/idbDelete=async\(\)=>true/);
 assert.match(html,/await Access.start\(\);\s+await FamShared.load\(\);/);
 assert.equal((html.match(/FamShared.ready\(\)/g)||[]).length,1);
 assert.ok(!html.includes('restore saved session (previously imported data), if any'));
 for(const [,js] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(js);
});
test('only a minimal login shell is static while the interactive client remains private',()=>{
 const login=read('server/www/login.html'),script=read('server/www/login.js');
 assert.ok(fs.existsSync(CENTRAL));assert.ok(!fs.existsSync('server/www/FAM.html'));
 assert.match(login,/id="login-form"/);assert.match(login,/login\.js/);
 assert.match(script,/fetch\('api\/login'/);assert.match(script,/location\.replace\('app'\)/);
 assert.doesNotMatch(login,/fam-shared-js/);assert.doesNotMatch(script,/Mohsen_FINAL|sqlite|private_ui/);
});
test('the deployed client has a verifiable release marker',()=>{
 const local=read('FAM.html'),central=read(CENTRAL);
 for(const html of [local,central]){
  assert.match(html,html===central?/<meta name="fam-release" content="FAM-EQUIPMENT-V2-SERVER-FIX-20261017">/:/<meta name="fam-release" content="FAM-UI-17-IIS-20261013\.1">/);
  assert.match(html,/FAM UI-17 · 2026-10-13/);
  assert.match(html,/operation-primary-action/);
  assert.match(html,/function manageCategorySections\(categoryId\)/);
 }
});
test('light theme only paints: no DOM relocation, box geometry or background shorthand resets',()=>{
 const css=read('src/light-palette.css'),html=read('FAM.html');
 assert.doesNotMatch(css,/(?:^|[;{])\s*(?:display|visibility|position|width|height|min-width|min-height|font|font-size|font-family|padding|margin|gap|order|grid-template-columns|background)\s*:/m);
 assert.doesNotMatch(read('src/ui-theme.js'),/FamOperationsLayout/);
 assert.doesNotMatch(html,/id="fam-operations-js"/);
 assert.match(css,/#fx-stage[^}]*opacity:0!important/);
});
test('central client announces remote server revisions without overwriting local work',()=>{
 const html=read(CENTRAL),sync=read('src/shared-sync.js');
 assert.match(sync,/live-update-notice/);assert.match(sync,/دریافت نسخهٔ جدید/);
 assert.match(sync,/function hasUnsavedWork\(\)/);assert.match(sync,/if\(signature\(\)!==clean\)/);
 assert.match(sync,/change\?\.actor/);assert.match(html,/id:'live-update-notice'/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modExport\.ExportSearchResults"/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modExport\.ExportChangeLog"/);
 assert.doesNotMatch(html,/data-act="run-macro" data-arg="modFixUnlock\.UnlockDataSheets"/);
});
test('central manual backup requests a verified private server snapshot',()=>{
 const html=read(CENTRAL),sync=read('src/shared-sync.js');
 assert.match(sync,/backupAll=async\(\)=>\{/);
 assert.match(sync,/if\(!Access\.require\('backup'\)\)return false/);
 assert.match(sync,/if\(!Access\.require\('undo'\)\)return false/);
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
 assert.match(access,/categories:\[\.\.\.new Set/);assert.match(access,/const permissions=Array\.isArray\(u\?\.permissions\)/);assert.match(access,/equipmentPolicyVersion:1,equipmentScope/);
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

test('new equipment workspace is flat, shared and contains no legacy scenario UI',()=>{
 const html=read(CENTRAL),local=read('FAM.html'),workspace=read('src/equipment-workspace.js');
 assert.match(html,/<meta name="fam-equipment-group-release" content="FAM-EQUIPMENT-GROUP-20261018">/);assert.equal((html.match(/id="fam-equipment-switch-picker-js"/g)||[]).length,1);
 for(const doc of [html,local]){assert.match(doc,/id="fam-equipment-workspace-js"/);assert.doesNotMatch(doc,/id="fam-equipment-local-preview-(?:js|css)"/);assert.ok(doc.includes(workspace));}
 assert.doesNotMatch(workspace,/runCheck|equipment-demo-scenario|credentials=/);assert.match(workspace,/equipmentTools.mount\(main,section\)/);
 const tools=read('src/equipment-tools.js');assert.doesNotMatch(tools,/simulateErr|سناریوی ساختگی|errdisabledUI|eq-tool-errdisabled/);
 const live=read('src/equipment-live-server.js');assert.match(live,/equipment\/inspect/);assert.match(live,/equipment\/group\/apply/);assert.doesNotMatch(live,/localStorage|sessionStorage|innerHTML/);
 assert.doesNotMatch(read('scripts/build_shared.py'),/needle_result|source.replace|needle_scan/);
});

test('SERVER manual-IP and description output use the scoped API and text-only rendering',()=>{
 const html=read(CENTRAL),live=html.match(/<script id="fam-equipment-management-js">([\s\S]*?)<\/script>/)[1];
 assert.doesNotMatch(live,/eq-live-manual-ip/);assert.match(live,/FamEquipmentSwitchPicker.mount/);assert.ok(html.includes(read('src/equipment-switch-picker.js')));assert.match(read('src/equipment-switch-picker.js'),/eq-live-search/);assert.match(live,/FamEquipmentInventory.privateIP/);assert.match(live,/equipment\/descriptions/);assert.match(live,/pre=el\('pre','eq-live-command-output',item.output\)/);assert.match(live,/whiteSpace:'pre'/);assert.doesNotMatch(live,/innerHTML|localStorage|sessionStorage/);
 const helper=read('server/equipment_probe.py');assert.match(helper,/DESCRIPTION_COMMANDS = \("terminal length 0", "show interfaces description", "exit"\)/);
});

test('SERVER inspection uses one combined request and no automatic second description read',()=>{
 const html=read(CENTRAL),live=html.match(/<script id="fam-equipment-management-js">([\s\S]*?)<\/script>/)[1];
 assert.match(live,/FamShared.api\(statusOnly\?'equipment\/check':'equipment\/inspect'/);assert.match(live,/statusOnly=statusOnly===true/);assert.match(live,/eq-live-status-only/);assert.match(live,/r.timings=data.timings/);
 assert.doesNotMatch(live,/await descriptionsRead\(results.filter/);assert.match(live,/SSH و اجرای دستورها/);
});

test('SERVER recovery errors stop the batch and invalidate remaining approvals',()=>{
 const live=read('src/equipment-live-server.js');
 assert.match(live,/data.rows.some\(row=>row.state==='still_errdisabled'\)\)throw Error/);
 assert.match(live,/r.groupTicket=''/);assert.match(live,/p.ticket=''/);assert.match(live,/message=r.groupOutcome;break;/);assert.match(live,/chosen.clear\(\)/);
});
