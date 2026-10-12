/* Static contract tests for the standalone (browser-local) permission model.
   The HTML-only package is intentionally not represented as server security. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');

test('user form has dynamic scope before individually selected capabilities',()=>{
  const access=read('src/local-access.js');
  const scope=access.indexOf("id:'user-scopes'"),operations=access.indexOf("id:'user-permissions'");
  assert.ok(scope>=0&&operations>scope,'scope must precede operations');
  assert.match(access,/managedCategories\(\),CAT_OTHER/);
  assert.match(access,/data-user-category/);
  assert.match(access,/data-user-region/);
  assert.match(access,/id:'user-all-regions'/);
  assert.match(access,/data-user-permission/);
  assert.doesNotMatch(access,/id:'user-role'/);
  assert.doesNotMatch(access,/text:'سطح [۱-۴]'/);
  for(const capability of ['view-sheets','search','view-history','edit-cells','save-results','add-record','remove-record','undo-remove','refresh-panel','refresh-index','import-data','export-xlsx','backup-server','restore-data','empty-data','reset-data','manage-regions','manage-categories','manage-users']) assert.ok(access.includes("'"+capability+"'"),capability);
});

test('category identifiers and regions are persisted and missing categories fail closed',()=>{
  const access=read('src/local-access.js');
  assert.match(access,/categories:\[\.\.\.cs\]/);
  assert.match(access,/regions:cs\.has\('provinces'\)\?\[\.\.\.rs\]:\[\]/);
  assert.match(access,/const category=categoryOf\(sheet\)\?\.id\|\|'other'/);
  assert.match(access,/if\(!u\.categories\.includes\(category\)\)return false/);
  assert.match(access,/if\(category!==\'provinces\'\)return true/);
  assert.match(access,/deleted is deliberately fail-closed/);
  assert.match(access,/دسترسی به دستهٔ حذف‌شده مسدود است/);
  assert.match(access,/permissions:\[\.\.\.ps\]/);
});

test('standalone entry points check the capability and selected sheet scope',()=>{
  const html=read('FAM.html');
  assert.match(html,/Access\.can\(\"search-read\", n\)/);
  assert.match(html,/Access\.require\(\"manual\", name\)/);
  assert.match(html,/Access\.require\(\"save-results\", blk\.sheet\)/);
  assert.match(html,/Access\.require\(\"add\", sheetName\)/);
  assert.match(html,/Access\.can\(\"remove\", srcSheetName\)/);
  assert.match(html,/Access\.require\(\"remove\", dSheet\)/);
  assert.match(html,/Access\.can\(\"export\", name\)/);
  assert.match(html,/Access\.can\(\"backup\",name\)/);
  assert.match(html,/function canViewLogEntry\(row\)/);
  assert.match(html,/!!WB\.sheets\[sheet\] && IsDataSheet\(sheet\)/);
  assert.match(html,/Access\.can\(\"global-history\"\)/);
  assert.match(html,/Access\.require\(\"manage-regions\"\)/);
  assert.match(html,/Access\.require\(\"manage-categories\"\)/);
});

test('user-form buttons and requested theme-two/destructive styling are explicit',()=>{
  const access=read('src/local-access.js'),css=read('src/local-access.css'),light=read('src/light-palette.css');
  for(const id of ['user-save','user-cancel','user-save-new'])assert.ok(access.includes("id:'"+id+"'"),id);
  assert.match(access,/if\(original\)area\.appendChild\(button\('حذف کاربر'/);
  assert.match(css,/#user-delete\{display:inline-flex!important;width:max-content!important/);
  assert.match(css,/#user-delete\{[^}]*color:#111!important/);
  assert.match(light,/#user-cancel\{background-color:#dce8ef!important;background-image:none!important/);
  assert.match(light,/#user-delete\{background-color:#e55c66!important;background-image:none!important;color:#111!important/);
});
